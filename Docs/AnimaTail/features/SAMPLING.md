# Anima 샘플러와 스케줄러

AnimaUtil은 DiffSynth의 Anima 모델 로딩·프롬프트 처리·VAE 디코딩을 유지하고,
denoise 구간은 프로젝트 소유의 Flow Matching 샘플링 계층에서 실행한다. diffusers의
이름이 비슷한 스케줄러로 대체하지 않는다.

## 기본값과 UI

- 기본 샘플러: `er_sde`
- 기본 스케줄러: `simple`
- 싱글 생성 및 멀티 생성의 `고급 설정`을 펼쳐 두 값을 변경한다.
- 접힌 상태에서도 `샘플러 · 스케줄러` 조합을 표시한다.
- `karras` 및 DPM 계열은 지원 목록에 포함하지 않는다.
- `uni_pc`는 최소 2 Steps가 필요하다.

선택값은 큐 등록 시 작업별로 고정한다. 이후 UI 값을 변경해도 이미 대기 중이거나
실행 중인 작업에는 영향을 주지 않는다.

## 지원 샘플러

| 값 | 동작 |
|---|---|
| `er_sde` | Extended Reverse-Time SDE 3단 솔버. 고정 Seed의 단계별 난수까지 재현 |
| `res_multistep` | 이전 denoised 값을 사용하는 2차 multistep |
| `euler_a` | 일반 diffusion 공식이 아닌 CONST/Rectified Flow 전용 ancestral Euler |
| `euler` | 1차 Flow Euler |
| `uni_pc` | BH1 predictor-corrector, 최대 3차 및 마지막 단계 저차수 처리 |

DiffSynth AnimaDiT가 반환하는 값은 Flow velocity다. 각 샘플러에는
`denoised = latent - sigma * velocity`로 변환한 값을 전달한다.

## 지원 스케줄러

세 스케줄러는 모두 Anima의 1,000개 native sigma 표를 사용한다. 표는 `shift=3.0`인
Flow 시간표이며 UI의 Steps에 맞춰 다음 방식으로 추출한다.

| 값 | 동작 |
|---|---|
| `simple` | native 표 전체에서 실수 stride 기반 인덱스 선택 |
| `beta` | Beta(0.6, 0.6) PPF로 인덱스를 선택하고 중복 인덱스 제거 |
| `ddim_uniform` | native 표의 인덱스를 정수 간격으로 균일 선택 |

`ddim_uniform`은 DDIM 확산 솔버를 의미하지 않는다. 로컬 DiffSynth의
`DDIMScheduler`와 연결하거나 대체하지 않는다. `beta`의 PPF는 포터블 런타임에
SciPy를 추가하지 않는 순수 수치 구현이며, SciPy 기준 1~100 Steps의 최종 인덱스가
같은지 개발 검증했다.

## 기록과 복원

- 작업 목록의 `settings.sampler`, `settings.scheduler`
- PNG의 `AnimaUtil` JSON text chunk
- PNG의 호환용 `parameters` text
- 싱글 생성 및 멀티 생성의 `설정 불러오기`

필드가 없는 과거 schema v1 결과는 `er_sde · simple`로 복원한다.

## 구현 출처와 검증

- UniPC BH1 수식은 MIT 라이선스의
  [wl-zhao/UniPC](https://github.com/wl-zhao/UniPC)를 기준으로 Anima sigma 인터페이스에 맞게 작성했다.
- ER-SDE는 [ER-SDE-Solver 논문](https://arxiv.org/abs/2309.06169)의 solver와
  Anima CONST half-logSNR 변환을 사용한다.
- 동작 기준은 ComfyUI의 Anima `FLOW + CONST`, `shift=3.0` 설정 및 샘플러 결과다.

개발 검증에서는 고정 tensor와 동일한 denoiser를 사용해 로컬 ComfyUI와 비교했다.
`euler`, `euler_a`, `res_multistep`은 최대 오차 0, `er_sde`는 약 `2.4e-7`,
`uni_pc`는 약 `3.2e-6` 이하였다. 실제 CUDA 통합 검증은 1024×1024, 10 Steps,
`er_sde · simple`로 PNG 저장과 이미지 내장 `AnimaUtil` metadata 왕복까지 통과했다.
