from __future__ import annotations

import math
from collections.abc import Callable

import torch

from generation_profile import (
    DEFAULT_SAMPLER,
    DEFAULT_SCHEDULER,
    SAMPLERS,
    SCHEDULERS,
)

TensorModel = Callable[[torch.Tensor, torch.Tensor, int], torch.Tensor]
ProgressCallback = Callable[[int, int], None]


def _time_snr_shift(alpha: float, timestep: torch.Tensor) -> torch.Tensor:
    return alpha * timestep / (1.0 + (alpha - 1.0) * timestep)


def anima_native_sigmas() -> torch.Tensor:
    """Return the 1,000-point native Anima FLOW sigma table (shift=3)."""
    timesteps = torch.arange(1, 1001, dtype=torch.float64) / 1000.0
    return _time_snr_shift(3.0, timesteps)


def _continued_fraction_beta(a: float, b: float, x: float) -> float:
    # Modified Lentz method for the incomplete-beta continued fraction.
    maximum_iterations = 240
    epsilon = 3.0e-14
    minimum = 1.0e-300
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < minimum:
        d = minimum
    d = 1.0 / d
    result = d
    for iteration in range(1, maximum_iterations + 1):
        doubled = 2 * iteration
        coefficient = iteration * (b - iteration) * x / ((qam + doubled) * (a + doubled))
        d = 1.0 + coefficient * d
        if abs(d) < minimum:
            d = minimum
        c = 1.0 + coefficient / c
        if abs(c) < minimum:
            c = minimum
        d = 1.0 / d
        result *= d * c

        coefficient = -(a + iteration) * (qab + iteration) * x / (
            (a + doubled) * (qap + doubled)
        )
        d = 1.0 + coefficient * d
        if abs(d) < minimum:
            d = minimum
        c = 1.0 + coefficient / c
        if abs(c) < minimum:
            c = minimum
        d = 1.0 / d
        delta = d * c
        result *= delta
        if abs(delta - 1.0) <= epsilon:
            return result
    raise RuntimeError("Beta CDF 계산이 수렴하지 않았습니다.")


def _regularized_incomplete_beta(x: float, a: float, b: float) -> float:
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    log_term = (
        math.lgamma(a + b)
        - math.lgamma(a)
        - math.lgamma(b)
        + a * math.log(x)
        + b * math.log1p(-x)
    )
    term = math.exp(log_term)
    if x < (a + 1.0) / (a + b + 2.0):
        return term * _continued_fraction_beta(a, b, x) / a
    return 1.0 - term * _continued_fraction_beta(b, a, 1.0 - x) / b


def _beta_ppf(probability: float, a: float = 0.6, b: float = 0.6) -> float:
    if probability <= 0.0:
        return 0.0
    if probability >= 1.0:
        return 1.0
    low = 0.0
    high = 1.0
    for _ in range(72):
        midpoint = (low + high) * 0.5
        if _regularized_incomplete_beta(midpoint, a, b) < probability:
            low = midpoint
        else:
            high = midpoint
    return (low + high) * 0.5


def _simple_sigmas(native: torch.Tensor, steps: int) -> torch.Tensor:
    stride = len(native) / steps
    values = [float(native[-(1 + int(index * stride))]) for index in range(steps)]
    return torch.tensor([*values, 0.0], dtype=torch.float32)


def _ddim_uniform_sigmas(native: torch.Tensor, steps: int) -> torch.Tensor:
    index = 1
    values = [0.0]
    stride = max(len(native) // steps, 1)
    while index < len(native):
        values.append(float(native[index]))
        index += stride
    values.reverse()
    return torch.tensor(values, dtype=torch.float32)


def _beta_sigmas(native: torch.Tensor, steps: int) -> torch.Tensor:
    maximum_index = len(native) - 1
    indices: list[int] = []
    for index in range(steps):
        probability = 1.0 - index / steps
        # Python round uses bankers rounding, matching numpy.rint used by ComfyUI.
        selected = int(round(_beta_ppf(probability) * maximum_index))
        if not indices or selected != indices[-1]:
            indices.append(selected)
    values = [float(native[index]) for index in indices]
    return torch.tensor([*values, 0.0], dtype=torch.float32)


def make_sigmas(
    steps: int,
    scheduler: str = DEFAULT_SCHEDULER,
    sampler: str = DEFAULT_SAMPLER,
    *,
    device: torch.device | str | None = None,
) -> torch.Tensor:
    if sampler not in SAMPLERS:
        raise ValueError(f"지원하지 않는 샘플러입니다: {sampler}")
    if scheduler not in SCHEDULERS:
        raise ValueError(f"지원하지 않는 스케줄러입니다: {scheduler}")
    if steps < 1:
        raise ValueError("Steps는 1 이상이어야 합니다.")
    if sampler == "uni_pc" and steps < 2:
        raise ValueError("uni_pc 샘플러는 최소 2 Steps가 필요합니다.")

    schedule_steps = steps + 1 if sampler == "uni_pc" else steps
    native = anima_native_sigmas()
    if scheduler == "simple":
        sigmas = _simple_sigmas(native, schedule_steps)
    elif scheduler == "beta":
        sigmas = _beta_sigmas(native, schedule_steps)
    else:
        sigmas = _ddim_uniform_sigmas(native, schedule_steps)

    if sampler == "uni_pc":
        # UniPC evaluates one extra schedule step and discards the penultimate sigma.
        sigmas = torch.cat((sigmas[:-2], sigmas[-1:]))
    return sigmas.to(device=device)


def _expand(value: torch.Tensor, dimensions: int) -> torch.Tensor:
    return value[(...,) + (None,) * (dimensions - 1)]


def _noise_sampler(x: torch.Tensor, seed: int | None) -> Callable[[], torch.Tensor]:
    adjusted_seed = seed
    if adjusted_seed is not None and x.device.type == "cpu":
        adjusted_seed += 1
    generator = None
    if adjusted_seed is not None:
        generator = torch.Generator(device=x.device)
        generator.manual_seed(adjusted_seed)

    def sample() -> torch.Tensor:
        return torch.randn(
            x.size(),
            dtype=x.dtype,
            layout=x.layout,
            device=x.device,
            generator=generator,
        )

    return sample


def _notify(progress: ProgressCallback | None, index: int, total: int) -> None:
    if progress is not None:
        progress(index + 1, total)


@torch.no_grad()
def _sample_euler(
    model: TensorModel,
    x: torch.Tensor,
    sigmas: torch.Tensor,
    progress: ProgressCallback | None,
) -> torch.Tensor:
    total = len(sigmas) - 1
    for index in range(total):
        sigma = sigmas[index]
        denoised = model(x, sigma, index)
        derivative = (x - denoised) / sigma.to(dtype=x.dtype)
        x = x + derivative * (sigmas[index + 1] - sigma).to(dtype=x.dtype)
        _notify(progress, index, total)
    return x


@torch.no_grad()
def _sample_euler_ancestral_rf(
    model: TensorModel,
    x: torch.Tensor,
    sigmas: torch.Tensor,
    seed: int | None,
    progress: ProgressCallback | None,
) -> torch.Tensor:
    total = len(sigmas) - 1
    noise = _noise_sampler(x, seed)
    for index in range(total):
        sigma = sigmas[index]
        sigma_next = sigmas[index + 1]
        denoised = model(x, sigma, index)
        if float(sigma_next) == 0.0:
            x = denoised
        else:
            downstep_ratio = sigma_next / sigma
            sigma_down = sigma_next * downstep_ratio
            alpha_next = 1.0 - sigma_next
            alpha_down = 1.0 - sigma_down
            renoise_squared = sigma_next.square() - (
                sigma_down.square() * alpha_next.square() / alpha_down.square()
            )
            renoise = renoise_squared.clamp_min(0.0).sqrt().to(dtype=x.dtype)
            ratio = (sigma_down / sigma).to(dtype=x.dtype)
            x = ratio * x + (1.0 - ratio) * denoised
            x = (alpha_next / alpha_down).to(dtype=x.dtype) * x + noise() * renoise
        _notify(progress, index, total)
    return x


@torch.no_grad()
def _sample_res_multistep(
    model: TensorModel,
    x: torch.Tensor,
    sigmas: torch.Tensor,
    progress: ProgressCallback | None,
) -> torch.Tensor:
    total = len(sigmas) - 1
    old_sigma_down: torch.Tensor | None = None
    old_denoised: torch.Tensor | None = None

    def time(sigma: torch.Tensor) -> torch.Tensor:
        return -sigma.log()

    def phi1(value: torch.Tensor) -> torch.Tensor:
        return torch.expm1(value) / value

    for index in range(total):
        sigma = sigmas[index]
        sigma_next = sigmas[index + 1]
        denoised = model(x, sigma, index)
        if float(sigma_next) == 0.0 or old_denoised is None:
            derivative = (x - denoised) / sigma.to(dtype=x.dtype)
            x = x + derivative * (sigma_next - sigma).to(dtype=x.dtype)
        else:
            current_t = time(sigma)
            old_t = time(old_sigma_down)
            next_t = time(sigma_next)
            previous_t = time(sigmas[index - 1])
            h = next_t - current_t
            c2 = (previous_t - old_t) / h
            phi1_value = phi1(-h)
            phi2_value = (phi1_value - 1.0) / (-h)
            b1 = torch.nan_to_num(phi1_value - phi2_value / c2)
            b2 = torch.nan_to_num(phi2_value / c2)
            x = (
                torch.exp(-h).to(dtype=x.dtype) * x
                + h.to(dtype=x.dtype)
                * (b1.to(dtype=x.dtype) * denoised + b2.to(dtype=x.dtype) * old_denoised)
            )
        old_denoised = denoised
        old_sigma_down = sigma_next
        _notify(progress, index, total)
    return x


@torch.no_grad()
def _sample_er_sde(
    model: TensorModel,
    x: torch.Tensor,
    sigmas: torch.Tensor,
    seed: int | None,
    progress: ProgressCallback | None,
) -> torch.Tensor:
    total = len(sigmas) - 1
    sigmas = sigmas.clone()
    if float(sigmas[0]) >= 1.0:
        sigmas[0] = _time_snr_shift(3.0, sigmas.new_tensor(0.9999))

    # For a CONST flow model: half-logSNR = log((1-sigma) / sigma).
    half_log_snr = -torch.logit(sigmas.clamp(1.0e-12, 1.0 - 1.0e-12))
    er_lambda = torch.exp(-half_log_snr)
    noise = _noise_sampler(x, seed)
    integration_points = 200
    point_indices = torch.arange(integration_points, dtype=torch.float32, device=x.device)
    old_denoised: torch.Tensor | None = None
    old_derivative: torch.Tensor | None = None

    def scale(value: torch.Tensor) -> torch.Tensor:
        return value * (torch.exp(value.pow(0.3)) + 10.0)

    for index in range(total):
        sigma = sigmas[index]
        sigma_next = sigmas[index + 1]
        denoised = model(x, sigma, index)
        stage = min(3, index + 1)
        if float(sigma_next) == 0.0:
            x = denoised
        else:
            lambda_start = er_lambda[index]
            lambda_end = er_lambda[index + 1]
            alpha_start = sigma / lambda_start
            alpha_end = sigma_next / lambda_end
            alpha_ratio = alpha_end / alpha_start
            noise_ratio = scale(lambda_end) / scale(lambda_start)
            x = (
                (alpha_ratio * noise_ratio).to(dtype=x.dtype) * x
                + (alpha_end * (1.0 - noise_ratio)).to(dtype=x.dtype) * denoised
            )

            if stage >= 2 and old_denoised is not None:
                delta = lambda_end - lambda_start
                step_size = -delta / integration_points
                positions = lambda_end + point_indices * step_size
                scaled_positions = scale(positions)
                integral = torch.sum(1.0 / scaled_positions) * step_size
                denoised_derivative = (denoised - old_denoised) / (
                    lambda_start - er_lambda[index - 1]
                ).to(dtype=x.dtype)
                coefficient = alpha_end * (delta + integral * scale(lambda_end))
                x = x + coefficient.to(dtype=x.dtype) * denoised_derivative

                if stage >= 3 and old_derivative is not None:
                    weighted_integral = (
                        torch.sum((positions - lambda_start) / scaled_positions) * step_size
                    )
                    second_derivative = (denoised_derivative - old_derivative) / (
                        (lambda_start - er_lambda[index - 2]) / 2.0
                    ).to(dtype=x.dtype)
                    coefficient = alpha_end * (
                        delta.square() / 2.0 + weighted_integral * scale(lambda_end)
                    )
                    x = x + coefficient.to(dtype=x.dtype) * second_derivative
                old_derivative = denoised_derivative

            noise_variance = (
                lambda_end.square() - lambda_start.square() * noise_ratio.square()
            ).clamp_min(0.0)
            x = x + (
                alpha_end * noise_variance.sqrt()
            ).to(dtype=x.dtype) * noise()
        old_denoised = denoised
        _notify(progress, index, total)
    return x


class _UniPCNoiseSchedule:
    @staticmethod
    def log_alpha(sigma: torch.Tensor) -> torch.Tensor:
        return -0.5 * torch.log1p(sigma.square())

    @classmethod
    def alpha(cls, sigma: torch.Tensor) -> torch.Tensor:
        return torch.exp(cls.log_alpha(sigma))

    @classmethod
    def std(cls, sigma: torch.Tensor) -> torch.Tensor:
        return sigma * cls.alpha(sigma)

    @staticmethod
    def log_snr(sigma: torch.Tensor) -> torch.Tensor:
        return -torch.log(sigma)


def _tensor_dot_history(history: torch.Tensor, coefficients: torch.Tensor) -> torch.Tensor:
    return torch.tensordot(
        history,
        coefficients.to(dtype=history.dtype),
        dims=([1], [0]),
    )


@torch.no_grad()
def _unipc_bh_update(
    x: torch.Tensor,
    model: Callable[[torch.Tensor, torch.Tensor, int], torch.Tensor],
    model_history: list[torch.Tensor],
    time_history: list[torch.Tensor],
    target: torch.Tensor,
    order: int,
    step_index: int,
    *,
    correct: bool,
) -> tuple[torch.Tensor, torch.Tensor | None]:
    schedule = _UniPCNoiseSchedule
    dimensions = x.ndim
    previous = time_history[-1]
    lambda_previous = schedule.log_snr(previous)
    lambda_target = schedule.log_snr(target)
    model_previous = model_history[-1]
    sigma_previous = schedule.std(previous)
    sigma_target = schedule.std(target)
    alpha_target = schedule.alpha(target)
    h = lambda_target - lambda_previous

    ratios: list[torch.Tensor | float] = []
    differences: list[torch.Tensor] = []
    for history_index in range(1, order):
        historical_time = time_history[-(history_index + 1)]
        historical_model = model_history[-(history_index + 1)]
        ratio = ((schedule.log_snr(historical_time) - lambda_previous) / h)[0]
        ratios.append(ratio)
        differences.append((historical_model - model_previous) / ratio.to(dtype=x.dtype))
    ratios.append(1.0)
    ratio_tensor = torch.tensor(ratios, dtype=torch.float32, device=x.device)

    hh = -h[0]
    phi1 = torch.expm1(hh)
    phi_k = phi1 / hh - 1.0
    matrix_rows = []
    vector = []
    factorial = 1
    for power in range(1, order + 1):
        matrix_rows.append(ratio_tensor.pow(power - 1))
        vector.append(phi_k * factorial / hh)
        factorial *= power + 1
        phi_k = phi_k / hh - 1.0 / factorial
    matrix = torch.stack(matrix_rows)
    vector_tensor = torch.stack(vector)

    difference_tensor = torch.stack(differences, dim=1) if differences else None
    if difference_tensor is not None:
        if order == 2:
            predictor_weights = torch.tensor([0.5], device=x.device)
        else:
            predictor_weights = torch.linalg.solve(matrix[:-1, :-1], vector_tensor[:-1])
    else:
        predictor_weights = None

    if correct:
        if order == 1:
            corrector_weights = torch.tensor([0.5], device=x.device)
        else:
            corrector_weights = torch.linalg.solve(matrix, vector_tensor)
    else:
        corrector_weights = None

    base = (
        _expand(sigma_target / sigma_previous, dimensions).to(dtype=x.dtype) * x
        - _expand(alpha_target * phi1, dimensions).to(dtype=x.dtype) * model_previous
    )
    if predictor_weights is None:
        predicted = base
    else:
        predicted = base - _expand(alpha_target * hh, dimensions).to(dtype=x.dtype) * (
            _tensor_dot_history(difference_tensor, predictor_weights)
        )

    if not correct:
        return predicted, None

    model_target = model(predicted, target, step_index)
    historical_correction: torch.Tensor | int = 0
    if difference_tensor is not None:
        historical_correction = _tensor_dot_history(
            difference_tensor,
            corrector_weights[:-1],
        )
    latest_difference = model_target - model_previous
    corrected = base - _expand(alpha_target * hh, dimensions).to(dtype=x.dtype) * (
        historical_correction
        + corrector_weights[-1].to(dtype=x.dtype) * latest_difference
    )
    return corrected, model_target


@torch.no_grad()
def _sample_unipc(
    denoiser: TensorModel,
    noise: torch.Tensor,
    sigmas: torch.Tensor,
    progress: ProgressCallback | None,
) -> torch.Tensor:
    # UniPC reference implementation: wl-zhao/UniPC (MIT), BH1 predictor-corrector.
    timesteps = sigmas.clone()
    if float(timesteps[-1]) == 0.0:
        timesteps[-1] = 0.001
    schedule = _UniPCNoiseSchedule
    x = noise / torch.sqrt(1.0 + timesteps[0].square()).to(dtype=noise.dtype)
    total = len(timesteps) - 1
    order = min(3, len(timesteps) - 2)

    def data_model(value: torch.Tensor, sigma: torch.Tensor, step_index: int) -> torch.Tensor:
        original = value * torch.sqrt(1.0 + sigma.square()).to(dtype=value.dtype)
        return denoiser(original, sigma, step_index)

    model_history: list[torch.Tensor] = []
    time_history: list[torch.Tensor] = []
    for step_index in range(total):
        if step_index == 0:
            current = timesteps[0].expand(x.shape[0])
            model_history = [data_model(x, current, step_index)]
            time_history = [current]
        elif step_index < order:
            target = timesteps[step_index].expand(x.shape[0])
            x, model_target = _unipc_bh_update(
                x,
                data_model,
                model_history,
                time_history,
                target,
                step_index,
                step_index,
                correct=True,
            )
            if model_target is None:
                model_target = data_model(x, target, step_index)
            model_history.append(model_target)
            time_history.append(target)
        else:
            final_extra = 1 if step_index == total - 1 else 0
            for target_index in range(step_index, step_index + 1 + final_extra):
                target = timesteps[target_index].expand(x.shape[0])
                step_order = min(order, total + 1 - target_index)
                correct = target_index != total
                x, model_target = _unipc_bh_update(
                    x,
                    data_model,
                    model_history,
                    time_history,
                    target,
                    step_order,
                    target_index,
                    correct=correct,
                )
                for history_index in range(order - 1):
                    time_history[history_index] = time_history[history_index + 1]
                    model_history[history_index] = model_history[history_index + 1]
                time_history[-1] = target
                if target_index < total:
                    if model_target is None:
                        model_target = data_model(x, target, target_index)
                    model_history[-1] = model_target
        _notify(progress, step_index, total)

    return x / schedule.alpha(timesteps[-1]).to(dtype=x.dtype)


@torch.no_grad()
def sample(
    sampler: str,
    model: TensorModel,
    latents: torch.Tensor,
    sigmas: torch.Tensor,
    *,
    seed: int | None = None,
    progress: ProgressCallback | None = None,
) -> torch.Tensor:
    if sampler == "euler":
        return _sample_euler(model, latents, sigmas, progress)
    if sampler == "euler_a":
        return _sample_euler_ancestral_rf(model, latents, sigmas, seed, progress)
    if sampler == "res_multistep":
        return _sample_res_multistep(model, latents, sigmas, progress)
    if sampler == "er_sde":
        return _sample_er_sde(model, latents, sigmas, seed, progress)
    if sampler == "uni_pc":
        return _sample_unipc(model, latents, sigmas, progress)
    raise ValueError(f"지원하지 않는 샘플러입니다: {sampler}")


def apply_denoising_strength(
    full_sigmas: torch.Tensor,
    denoising_strength: float,
    has_input_image: bool,
) -> torch.Tensor:
    """Lower the starting noise while preserving the requested transition count."""
    if not has_input_image or denoising_strength >= 0.999:
        return full_sigmas
    strength = max(0.05, min(1.0, float(denoising_strength)))
    nonzero = full_sigmas[:-1].to(dtype=torch.float64)
    # Invert Anima's shift=3 curve, scale its raw FLOW time, then apply the shift again.
    raw_timesteps = nonzero / (3.0 - (2.0 * nonzero))
    scaled_timesteps = raw_timesteps * strength
    scaled_sigmas = _time_snr_shift(3.0, scaled_timesteps).to(dtype=full_sigmas.dtype)
    return torch.cat((scaled_sigmas, full_sigmas[-1:]))


def configure_inference_scheduler(scheduler, sigmas: torch.Tensor) -> None:
    """Expose the custom inference schedule through DiffSynth's scheduler contract."""
    scheduler.sigmas = sigmas[:-1].detach().cpu()
    scheduler.timesteps = scheduler.sigmas * 1000.0
    scheduler.training = False


@torch.no_grad()
def generate_image(
    pipe,
    *,
    prompt: str,
    negative_prompt: str,
    cfg_scale: float,
    width: int,
    height: int,
    seed: int,
    num_inference_steps: int,
    sampler: str = DEFAULT_SAMPLER,
    scheduler: str = DEFAULT_SCHEDULER,
    input_image=None,
    denoising_strength: float = 1.0,
    progress: ProgressCallback | None = None,
):
    """Run DiffSynth's Anima preparation/decoding around AnimaUtil samplers."""
    full_sigmas = make_sigmas(
        num_inference_steps,
        scheduler,
        sampler,
        device=pipe.device,
    )
    denoising_strength = max(0.05, min(1.0, float(denoising_strength)))
    sigmas = apply_denoising_strength(
        full_sigmas,
        denoising_strength,
        input_image is not None,
    )
    # Keep DiffSynth units that inspect the scheduler compatible with our schedule.
    configure_inference_scheduler(pipe.scheduler, sigmas)

    inputs_positive = {"prompt": prompt}
    inputs_negative = {"negative_prompt": negative_prompt}
    inputs_shared = {
        "cfg_scale": cfg_scale,
        "input_image": input_image,
        "denoising_strength": denoising_strength,
        "height": height,
        "width": width,
        "seed": seed,
        "rand_device": "cpu",
        "num_inference_steps": num_inference_steps,
    }
    for unit in pipe.units:
        inputs_shared, inputs_positive, inputs_negative = pipe.unit_runner(
            unit,
            pipe,
            inputs_shared,
            inputs_positive,
            inputs_negative,
        )

    pipe.load_models_to_device(pipe.in_iteration_models)
    models = {name: getattr(pipe, name) for name in pipe.in_iteration_models}

    def denoiser(latents: torch.Tensor, sigma: torch.Tensor, step_index: int) -> torch.Tensor:
        latents = latents.to(dtype=pipe.torch_dtype)
        inputs_shared["latents"] = latents
        timestep = sigma.reshape(-1).to(dtype=pipe.torch_dtype, device=pipe.device) * 1000.0
        velocity = pipe.cfg_guided_model_fn(
            pipe.model_fn,
            cfg_scale,
            inputs_shared,
            inputs_positive,
            inputs_negative,
            **models,
            timestep=timestep,
            progress_id=step_index,
        )
        sigma_shape = sigma.reshape(-1, *([1] * (latents.ndim - 1))).to(
            device=latents.device,
            dtype=latents.dtype,
        )
        return latents - velocity * sigma_shape

    latents = sample(
        sampler,
        denoiser,
        inputs_shared["latents"],
        sigmas,
        seed=seed,
        progress=progress,
    )
    pipe.load_models_to_device(("vae",))
    image = pipe.vae.decode(latents.unsqueeze(2), device=pipe.device).squeeze(2)
    image = pipe.vae_output_to_image(image)
    pipe.load_models_to_device(())
    return image
