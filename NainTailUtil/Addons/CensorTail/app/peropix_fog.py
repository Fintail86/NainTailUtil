"""Deterministic fog texture adapted from PeroPix's steam censor renderer.

PeroPix renders its steam effect in the browser with seeded 2D simplex noise.
This module keeps the same geometry and noise recipe so CensorTail previews and
saved images get a stable, continuous cloud instead of randomly placed lobes.
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image


_F2 = 0.5 * (math.sqrt(3.0) - 1.0)
_G2 = (3.0 - math.sqrt(3.0)) / 6.0
_GRADIENTS = np.asarray(
    [
        (1, 1),
        (-1, 1),
        (1, -1),
        (-1, -1),
        (1, 0),
        (-1, 0),
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
        (0, 1),
        (0, -1),
    ],
    dtype=np.float64,
)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def _simplex_permutation(seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Reproduce PeroPix's seeded Fisher-Yates permutation table."""
    values = np.arange(256, dtype=np.int32)
    state = int(seed)
    for index in range(255, 0, -1):
        state = (state * 16807 + 1) % 2147483647
        swap_index = state % (index + 1)
        values[index], values[swap_index] = values[swap_index], values[index]
    permutation = np.tile(values, 2)
    return permutation, permutation % 12


def _simplex_noise_2d(
    x: np.ndarray,
    y: np.ndarray,
    permutation: np.ndarray,
    permutation_mod12: np.ndarray,
) -> np.ndarray:
    skew = (x + y) * _F2
    cell_x = np.floor(x + skew).astype(np.int32)
    cell_y = np.floor(y + skew).astype(np.int32)
    unskew = (cell_x + cell_y) * _G2
    x0 = x - (cell_x - unskew)
    y0 = y - (cell_y - unskew)
    step_x = (x0 > y0).astype(np.int32)
    step_y = 1 - step_x
    x1 = x0 - step_x + _G2
    y1 = y0 - step_y + _G2
    x2 = x0 - 1.0 + 2.0 * _G2
    y2 = y0 - 1.0 + 2.0 * _G2
    wrapped_x = cell_x & 255
    wrapped_y = cell_y & 255

    def contribution(
        local_x: np.ndarray,
        local_y: np.ndarray,
        gradient_index: np.ndarray,
    ) -> np.ndarray:
        amount = 0.5 - local_x * local_x - local_y * local_y
        active = amount >= 0.0
        squared = np.where(active, amount * amount, 0.0)
        gradient = _GRADIENTS[gradient_index]
        dot = gradient[..., 0] * local_x + gradient[..., 1] * local_y
        return squared * squared * dot

    gradient0 = permutation_mod12[wrapped_x + permutation[wrapped_y]]
    gradient1 = permutation_mod12[
        wrapped_x + step_x + permutation[wrapped_y + step_y]
    ]
    gradient2 = permutation_mod12[wrapped_x + 1 + permutation[wrapped_y + 1]]
    noise = (
        contribution(x0, y0, gradient0)
        + contribution(x1, y1, gradient1)
        + contribution(x2, y2, gradient2)
    )
    return np.asarray(noise * 70.0, dtype=np.float32)


def _noise_grid(
    canvas_x: np.ndarray,
    canvas_y: np.ndarray,
    scale: float,
    permutation: np.ndarray,
    permutation_mod12: np.ndarray,
    offset: float = 0.0,
) -> np.ndarray:
    # The vectorized simplex calculation uses several temporary arrays. Work
    # in row bands so a large censor box cannot multiply those into a VRAM-like
    # spike in system memory.
    width = max(1, len(canvas_x))
    rows_per_band = max(1, min(len(canvas_y), 262_144 // width))
    result = np.empty((len(canvas_y), len(canvas_x)), dtype=np.float32)
    x = canvas_x[None, :] / max(scale, 1.0e-6) + offset
    for start in range(0, len(canvas_y), rows_per_band):
        end = min(len(canvas_y), start + rows_per_band)
        y = canvas_y[start:end, None] / max(scale, 1.0e-6) + offset
        result[start:end] = _simplex_noise_2d(
            x, y, permutation, permutation_mod12
        )
    return result


def render_peropix_fog(
    size: tuple[int, int],
    center: tuple[float, float],
    core_size: tuple[float, float],
    *,
    feather: float,
    brightness: float,
    opacity: float,
    density: float,
    color: tuple[int, int, int],
    seed: int,
) -> tuple[Image.Image, Image.Image]:
    """Render PeroPix's continuous steam pattern into a CensorTail crop."""
    width, height = size
    core_width = max(1.0, float(core_size[0]))
    core_height = max(1.0, float(core_size[1]))
    texture_width = max(1, math.ceil(core_width * 1.7))
    texture_height = max(1, math.ceil(core_height * 1.7))

    # Coordinates are relative to the complete PeroPix texture canvas. This
    # keeps the pattern stable when the effect crop is clipped by image edges.
    canvas_x = np.arange(width, dtype=np.float64) - center[0] + texture_width / 2.0
    canvas_y = np.arange(height, dtype=np.float64) - center[1] + texture_height / 2.0
    grid_x = np.asarray(canvas_x[None, :], dtype=np.float32)
    grid_y = np.asarray(canvas_y[:, None], dtype=np.float32)

    permutation, permutation_mod12 = _simplex_permutation(seed)
    feather_factor = 1.0 + _clamp(float(feather), 0.0, 50.0) / 25.0
    noise_scale = max(texture_width, texture_height) / 2.0 * feather_factor

    bright_noise = _noise_grid(
        canvas_x, canvas_y, noise_scale, permutation, permutation_mod12
    )
    bright_noise += _noise_grid(
        canvas_x, canvas_y, noise_scale / 2.0, permutation, permutation_mod12
    ) * 0.5
    bright_noise += _noise_grid(
        canvas_x, canvas_y, noise_scale / 4.0, permutation, permutation_mod12
    ) * 0.25
    bright_noise = (bright_noise / 1.75 + 1.0) / 2.0
    bright_noise = 0.5 + bright_noise * 0.5

    normalized_x = (grid_x - texture_width / 2.0) / max(core_width / 2.0, 1.0)
    normalized_y = (grid_y - texture_height / 2.0) / max(core_height / 2.0, 1.0)
    ellipse_distance = np.sqrt(normalized_x * normalized_x + normalized_y * normalized_y)

    edge_noise = _noise_grid(
        canvas_x, canvas_y, noise_scale * 0.5, permutation, permutation_mod12, 50.0
    ) * 0.5
    edge_noise += _noise_grid(
        canvas_x, canvas_y, noise_scale * 0.25, permutation, permutation_mod12, 150.0
    ) * 0.35
    edge_noise += _noise_grid(
        canvas_x, canvas_y, noise_scale * 0.12, permutation, permutation_mod12, 250.0
    ) * 0.15
    edge_noise_strength = 1.0 - _clamp(float(feather), 0.0, 50.0) / 62.5
    warped_distance = ellipse_distance + edge_noise * 0.25 * edge_noise_strength

    transition = np.clip((warped_distance - 0.6) / 0.55, 0.0, 1.0)
    transition = transition * transition * (3.0 - 2.0 * transition)
    alpha = np.where(warped_distance < 0.6, 1.0, 1.0 - transition)
    alpha = np.where(warped_distance < 1.15, alpha, 0.0)

    distance_from_edge = np.minimum(
        np.minimum(grid_x, texture_width - 1.0 - grid_x),
        np.minimum(grid_y, texture_height - 1.0 - grid_y),
    )
    safe_margin = min(core_width * 0.35, core_height * 0.35) * 0.25
    if safe_margin > 0.0:
        edge_fade = np.clip(
            (distance_from_edge - safe_margin) / (safe_margin * 3.0), 0.0, 1.0
        )
        alpha *= edge_fade
    inside_canvas = (
        (grid_x >= 0.0)
        & (grid_x <= texture_width - 1.0)
        & (grid_y >= 0.0)
        & (grid_y <= texture_height - 1.0)
    )
    alpha = np.where(inside_canvas, alpha, 0.0)

    # PeroPix has no density slider. Preserve CensorTail's contract while
    # making its default (70) identical to the source pattern.
    density_gain = 0.3 + _clamp(float(density), 0.0, 100.0) / 100.0
    alpha *= _clamp(float(opacity), 0.0, 1.0) * density_gain
    mask = Image.fromarray(np.uint8(np.clip(alpha * 255.0, 0.0, 255.0)), mode="L")

    brightness_ratio = _clamp(float(brightness), 0.0, 100.0) / 100.0
    base_brightness = math.floor(brightness_ratio * 230.0)
    brightness_range = math.floor(brightness_ratio * 25.0)
    intensity = base_brightness + np.floor(bright_noise * brightness_range)
    intensity = np.clip(intensity / 255.0, 0.0, 1.0)
    color_array = np.asarray(color, dtype=np.float32)
    rgb = np.uint8(
        np.clip(intensity[:, :, None] * color_array[None, None, :], 0.0, 255.0)
    )
    return Image.fromarray(rgb, mode="RGB"), mask
