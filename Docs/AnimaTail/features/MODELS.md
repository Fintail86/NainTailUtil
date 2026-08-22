# Models 폴더 구조

`Models/`는 사용자가 직접 준비한 생성 모델과 LoRA, 그리고 사용자가 설정 화면에서
명시적으로 다운로드한 고정 보조 자산을 보관한다. 앱/런타임 업데이트는 사용자 모델과
LoRA를 덮어쓰지 않는다.

```text
Models/
├─ censor/            # 자동검열 화면에서 사용자가 내려받은 고정 ONNX 모델
├─ diffusion_models/  # 사용자가 추가한 Anima 호환 모델
├─ loras/             # 사용자가 추가한 일반 LoRA
│  └─ turbo/          # Turbo 옵션 전용 LoRA
├─ text_encoders/     # Anima가 사용하는 Qwen text encoder
├─ vae/               # Qwen-Image VAE
└─ tokenizers/
   ├─ qwen3_0.6b/     # Qwen tokenizer 파일 묶음
   └─ t5_v1_1_xxl/    # T5 tokenizer 파일 묶음
```

초기 0.1.0 배포 도구가 생성한 `Models/checkpoints/`는 레거시 호환 경로로 함께 검색한다.
어느 경로에서 발견하더라도 카탈로그 ID는 `diffusion_models:<relativePath>`로 유지하며,
새 배포본은 `Models/diffusion_models/`를 기본 폴더로 생성한다.

## 관리 경계

- `Models/` 아래의 모든 파일은 사용자 소유다.
- 사용자 diffusion model과 LoRA는 다운로드, 업데이트 및 삭제 기능을 제공하지 않는다.
- 설정 화면은 앱 시작 시 필수·선택 보조 자산을 검사하고 누락되거나 크기가 맞지 않는
  항목의 다운로드 버튼만 활성화한다. 사용자의 버튼 입력 없이 자동 다운로드하지 않는다.
- 필수 보조 자산은 text encoder, VAE, Qwen tokenizer 묶음과 T5 tokenizer 묶음이다.
- 선택 보조 자산은 현재 자동검열 ONNX 모델이다.
- 모든 다운로드는 고정 revision의 원 배포처에서 직접 받으며 파일별 크기와 SHA-256을
  검증한 뒤 `Models/` 아래 정해진 위치로 이동한다. 실패한 `.part` 파일은 제거한다.
- 자동검열 모델은 앱 설치물이나 Git 저장소에 포함하지 않는다.
- 필수 보조 자산도 Git 저장소에 포함하지 않는다.
- 앱 shell이나 Python 런타임을 업데이트해도 `Models/`는 보존한다.

## 커스텀 파일 규칙

- 초기 대상 형식은 `.safetensors`다.
- `diffusion_models/`와 `loras/` 아래에 사용자가 자유롭게 하위 폴더를
  만들어 정리할 수 있게 한다.
- `loras/turbo/`는 Turbo 옵션 전용이다. 이 폴더의 LoRA는 일반 LoRA 추가 목록과
  분리되어 Turbo 체크박스를 켰을 때만 적용한다.
- text encoder와 VAE는 현재 검증된 파일명을 사용한다.
  - `text_encoders/qwen_3_06b_base.safetensors`
  - `vae/qwen_image_vae.safetensors`
- tokenizer는 개별 파일이 아니라 폴더 단위 자산으로 취급한다.
  - `tokenizers/qwen3_0.6b/`
  - `tokenizers/t5_v1_1_xxl/`
- 같은 이름의 미리보기나 메타데이터를 지원하게 되면 모델 파일 옆의 `.png`와
  `.json`을 선택적으로 인식한다.
- 파일을 발견했다고 바로 로드하지 않는다. AnimaDiT 필수 tensor key와 shape를 검사해
  호환성을 확인한 뒤 UI에 표시한다. 필수 구조가 완전하면 추가 키는 로드를 막지 않고
  워닝과 키 목록으로 보고한다.
- LoRA는 대상 베이스 모델과 key 호환성을 확인한 뒤 활성화한다.
- Anima LoRA는 DiffSynth의 `.lora_A/.lora_B` 키와 Kohya의
  `lora_unet_...lora_down/lora_up` 키 형식을 지원한다. Kohya 형식은 원본 파일을
  수정하지 않고 로딩 메모리에서 AnimaDiT 레이어 경로로 정규화하며 alpha를 보존한다.
- Kohya LoRA에 유효한 AnimaDiT weight 쌍이 하나 이상 있고 모든 인식 대상의 pair와
  shape가 정상이라면, AnimaDiT로 변환할 수 없는 나머지 Kohya 대상은 제외하고 `warning`
  상태로 부분 호환을 허용한다. 제외 개수와 최대 20개의 키 이름을 진단 결과에 기록한다.
- pair 누락, shape 불일치, 정규화 후 중복 대상, 적용 가능한 AnimaDiT 대상 0개는 계속
  `incompatible`로 처리한다. DiffSynth 형식의 미매칭 대상도 기존처럼 오류다.

현재 Electron UI는 체크포인트와 LoRA 폴더를 재귀 검색하고 `.safetensors` 파일을 선택 목록에
표시한다. 첫 로드 때 체크포인트 685개 tensor의 key/shape와 LoRA의 대상 레이어를
검사하며, 원본 파일은 변경하지 않는다. 체크포인트의 추가 키는 파일에 그대로 보존하고
현재 AnimaDiT가 사용하는 필수 키만 메모리 모델에 연결한다. 일반 LoRA는 여러 개를 등록할 수 있고 각
LoRA마다 강도 0~2를 지정한다. 동일 파일의 중복 적용은 허용하지 않으며 한 작업의
상한은 16개다. Turbo LoRA는 별도 체크박스·선택기·강도를 사용한다.

호환성 검사 결과는 `Models/diagnostics/compatibility.json`에 저장한다. 앱을 다시 실행하면
이 파일을 읽어 마지막 모델·LoRA 진단 상태와 검사 시각을 복원한다. `호환성 검사` 버튼을
누르면 현재 카탈로그를 다시 검사하고, 성공한 새 결과로 파일을 교체한다. 진단 중 오류가
발생하면 이전에 저장한 결과를 유지한다. 이 로컬 JSON은 `Models/` 데이터이므로 Git에는
포함하지 않는다.

text encoder, VAE와 tokenizer는 생성에 필요한 고정 역할 자산이라 UI에서 교체 선택지는
제공하지 않는다. 시작 시 전체 고정 파일의 존재 여부를 확인하고, 누락되면 생성을
비활성화한다. 설정의 다운로드 버튼은 다음 원본과 고정 revision을 사용한다.

- `circlestone-labs/Anima@fa1c61a99d95dbede6beda996c69c739512df290`
- `Qwen/Qwen3-0.6B@c1899de289a04d12100db370d81485cdf75e47ca`
- `google/t5-v1_1-xxl@3db67ab1af984cf10548a73467f0e5bca2aaaeb2`
- `01miku/anime-nsfw-segm-yolo26@1697d5d1827b6a818b350b44bf3ec27f08837a2a`

Anima에서 받는 text encoder와 VAE에는 원 저장소의 비상업 라이선스가 적용되고,
Qwen·T5 tokenizer는 Apache-2.0이다. 자동검열 모델의 저장소 라이선스와 포함 모델
라이선스 표기는 설정 화면에 함께 표시한다.

싱글 생성과 멀티 생성의 기본 모드는 모델이나 LoRA 조합이 바뀌면 안전하게 파이프라인을
다시 구성하는 DiffSynth fuse 방식이다. 멀티 생성의 실험적 `LoRA 교체` 모드는
DiffSynth hot-loading 래퍼로 공통+서브 LoRA 조합을 제거·재적용한다. 두 방식 모두
동일한 Anima LoRA 키 정규화와 구조 검사를 거친다.

## 향후 LoRA 호환성 확장 주의사항

LoRA 호환성은 다음 세 축을 분리해서 진단한다.

1. **대상 모델 구조**: 현재 대상은 `AnimaDiT`다.
2. **키 직렬화 형식**: 같은 일반 LoRA라도 DiffSynth, Kohya/A1111, PEFT/Diffusers
   등 저장 도구에 따라 레이어 경로와 행렬 이름이 달라질 수 있다.
3. **어댑터 알고리즘**: 일반 LoRA, LoCon, LoHa, LoKr, DoRA, IA3, DyLoRA 등은
   계산 방법 자체가 다를 수 있다.

`AnimaDiT`는 모델의 실제 레이어 구조이고 `Kohya`는 학습·저장 도구 생태계 및 키
표기 관례이므로, 둘을 같은 종류의 형식명으로 취급하지 않는다. 진단 UI와 내부
결과는 장기적으로 다음과 같이 개별 필드로 표현한다.

```text
targetArchitecture: AnimaDiT
keyFormat: kohya
adapterAlgorithm: lora
```

현재 구현이 지원하는 것은 **일반 LoRA 알고리즘**의 다음 두 키 형식이다.

- DiffSynth: `diffusion_model....lora_A/lora_B.weight`
- Kohya Anima: `lora_unet_....lora_down/lora_up.weight`와 선택적 `.alpha`

이 두 형식은 이름과 스케일 저장 방식이 다를 뿐, 유효한 대상 레이어와 tensor shape가
일치하면 같은 `B @ A` 형태의 일반 LoRA로 정규화할 수 있다. `lora_unet_` 접두사는
Kohya의 역사적 denoiser 명명 관례이며, 파일의 대상 모델이 실제 UNet이라는 의미로
판정해서는 안 된다.

Kohya 부분 호환은 미매칭 키를 성공으로 가장하는 규칙이 아니다. 실제 로딩용 state
dict에서 해당 키를 명시적으로 제외하고 UI에 `워닝 · 제외 N개`로 표시한다. 따라서
지원되는 AnimaDiT 부분만 적용되며, 원본 LoRA의 모든 학습 대상이 적용됐다고 보장하지
않는다. 결과 특성이 기대와 다르면 제외 키 목록과 학습 베이스·알고리즘을 확인해야 한다.

향후 개선 시 다음 원칙을 지킨다.

- `.safetensors`는 안전한 tensor 컨테이너일 뿐 LoRA 키 규격이나 알고리즘을 보장하지
  않는다. 확장자 또는 일부 접두사만으로 호환 판정하지 않는다.
- PEFT/Diffusers처럼 `base_model.model.`, `transformer.`, `unet.`, `text_encoder.`,
  `.default` 또는 사용자 adapter 이름이 포함된 형식은 별도의 키 정규화기로 처리한다.
- 키 형식 변환과 알고리즘 지원을 구분한다. LoHa, LoKr, DoRA 등의 파일은 이름만
  `lora_A/lora_B` 또는 `down/up`으로 바꿔 일반 LoRA 로더에 넣지 않는다.
- rank, alpha, 레이어별 alpha, 가중치 shape와 실제 대상 모듈을 모두 검증한다.
  `pairs=0` 또는 `matched=0`은 적용 가능한 AnimaDiT 대상이 없으므로 오류로 유지하되,
  진단에서는 미인식 키 형식 또는 미지원 알고리즘 여부를 함께 확인할 수 있게 한다.
- denoiser/DiT LoRA와 text encoder LoRA를 구분한다. 현재 `pipeline.dit`에만 적용하는
  경로에서 text encoder 키를 묵시적으로 무시하거나 적용 성공으로 표시하지 않는다.
- 새 형식 또는 알고리즘을 추가하면 fuse와 hot-loading 양쪽에서 단일·복수 LoRA,
  서로 다른 rank/alpha, 멀티 생성의 서브 프롬프트별 교체, 제거 후 원상복구를 각각
  검증한다. 적용 레이어 수가 0인 경우 성공으로 처리하지 않는다.
- Kohya `sd-scripts`에는 Anima 대상 LoHa/LoKr 학습 지원도 추가되어 있으므로 실제
  사용자 파일이 들어올 가능성이 있다. 해당 알고리즘은 샘플 파일 확보 후 계산식과
  키 구조를 확인하고 명시적으로 구현하며, 구현 전에는 `알고리즘 미지원`으로 표시한다.

참고 자료:

- [Kohya sd-scripts LoRA 고급 설정](https://github.com/kohya-ss/sd-scripts/blob/main/docs/train_network_advanced.md)
- [Kohya sd-scripts 릴리스](https://github.com/kohya-ss/sd-scripts/releases)
- [PEFT 체크포인트 형식](https://huggingface.co/docs/peft/developer_guides/checkpoint)
- [Diffusers LoRA 로더](https://huggingface.co/docs/diffusers/api/loaders/lora)
- [LyCORIS 알고리즘 목록](https://github.com/KohakuBlueleaf/LyCORIS)
