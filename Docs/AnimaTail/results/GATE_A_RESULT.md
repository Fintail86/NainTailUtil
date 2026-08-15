# AnimaUtil Gate A 검증 결과

- 검증일: 2026-07-19
- 결과: **통과**
- 범위: RTX 5090 CUDA 런타임, DiffSynth 직접 추론, 최소 다운로드 manifest, 오프라인 생성, 결정성, 진행률/취소, 워커 강제 종료 후 복구
- 제품 UI/포터블 패키징: 미착수

## 1. 결론

이 PC에서 ComfyUI 없이 DiffSynth `AnimaImagePipeline`을 사용해 Anima-Turbo v1.0을 직접 실행할 수 있다. 시스템 CUDA Toolkit을 사용하지 않고 PyTorch CUDA wheel의 사설 런타임만으로 RTX 5090의 `sm_120` 커널과 1024×1024 이미지 생성을 완료했다.

Gate A에서 발견된 두 호환성 문제도 제품 코드에서 통제 가능한 형태로 해결했다.

1. DiffSynth 예제의 SD3.5 T5 토크나이저 경로는 로그인하지 않으면 401로 차단된다. 핵심 `spiece.model`의 SHA-256이 완전히 같은 공개 `google/t5-v1_1-xxl` 토크나이저로 교체했고 오프라인 로드를 검증했다.
2. 현재 DiffSynth는 최신 `anima-turbo-v1.0.safetensors`의 구조 hash와 새 key prefix를 등록하지 않아 모델 유형을 감지하지 못한다. Turbo의 685개 tensor를 DiffSynth `AnimaDiT`와 대조한 결과 key와 shape가 모두 1:1로 일치했다. 원본 DiffSynth를 수정하지 않고 구조 검증+prefix 변환 adapter로 로드와 생성을 통과했다.

Gate A 당시에는 재현 가능한 검증을 위해 AnimaUtil 소유 manifest와 adapter를 정식
경계로 제안했다. 후속 제품 결정에 따라 이 manifest는 검증 자료로만 남기며,
제품은 모델 다운로드를 제공하지 않고 사용자가 배치한 로컬 파일만 검색한다.

## 2. 고정한 런타임

| 구성 | 고정값 |
|---|---|
| Python | 3.12.13 |
| PyTorch | 2.11.0+cu128 |
| torchvision | 0.26.0+cu128 |
| CUDA runtime | 12.8 wheel 내장 런타임 |
| DiffSynth | 2.0.17 |
| DiffSynth commit | `fb337fbb90945ff829de69dbd44ded618f73e889` |
| transformers | 5.14.1 |
| GPU | NVIDIA GeForce RTX 5090, capability 12.0 |
| NVIDIA driver | 610.62 |

PyTorch wheel SHA-256:

- `torch-2.11.0+cu128-cp312-cp312-win_amd64.whl`: `7c78215c3af4f62e63f2b2e360f1722fc719b0853c7ac22666483d9810613a4c`
- `torchvision-0.26.0+cu128-cp312-cp312-win_amd64.whl`: `8c0d1c4fbb2c9a4d5d41d0aaa87da20e525bcb2a154ce405725b0be59456804b`

`torch.cuda.get_arch_list()`에 `sm_120`이 포함됐고, BF16 4096×4096 행렬 곱을 0.066초에 완료했다. 결과 tensor는 유한값이었고 해당 테스트의 최고 CUDA 할당은 184.1MiB였다.

전체 환경은
원본 저장소의 `tools/gate-a/requirements.lock.txt`에
고정했다. `pip check`는 broken requirement 없이 통과했다. 설치된 71개 배포 패키지는
로컬 `.gate-a/dependency-inventory.json`에 버전과 라이선스 메타데이터를 기록했으며,
라이선스 메타데이터가 완전히 비어 있는 패키지는 없었다.

## 3. 다운로드 manifest

공식 저장소 revision을 고정하고 14개 파일만 allowlist로 받았다.

| 저장소 | revision | 용도 | 라이선스 |
|---|---|---|---|
| `circlestone-labs/Anima` | `fa1c61a99d95dbede6beda996c69c739512df290` | Turbo, text encoder, VAE, 모델 라이선스 | CircleStone Labs Non-Commercial License |
| `Qwen/Qwen3-0.6B` | `c1899de289a04d12100db370d81485cdf75e47ca` | Qwen tokenizer 파일과 라이선스 | Apache-2.0 |
| `google/t5-v1_1-xxl` | `3db67ab1af984cf10548a73467f0e5bca2aaaeb2` | 공개 T5 tokenizer 파일 | Apache-2.0 |

검증된 총 크기는 **5,644,879,290 bytes**(약 5.26GiB)다. Qwen 0.6B 모델 가중치와 Anima 전체 34.9GB 저장소는 받지 않았다.

핵심 가중치 SHA-256:

| 파일 | 크기 | SHA-256 |
|---|---:|---|
| `anima-turbo-v1.0.safetensors` | 4,182,230,656 | `c0b905034510750a505d21aa96c81718f4ffcc500777318421f58a88636e2174` |
| `qwen_3_06b_base.safetensors` | 1,192,135,096 | `cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba` |
| `qwen_image_vae.safetensors` | 253,806,246 | `a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f` |
| 공개 T5 `spiece.model` | 791,656 | `d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86` |

다운로드와 전체 파일 SHA-256 manifest 생성은
원본 저장소의 `tools/gate-a/download_assets.py`로 재현할
수 있다. 실제 manifest는 대용량 자산과 함께 gitignored
`.gate-a/asset-manifest.json`에 있다.

## 4. 1024×1024 추론 결과

설정:

- Anima-Turbo v1.0
- 1024×1024
- 10 steps
- CFG 1.0
- Seed `20260719`
- 네트워크 접근이 차단된 기본 샌드박스

| 측정 | 결과 |
|---|---:|
| pipeline 로드 | 3.115초 |
| 로드 최고 CUDA 할당 | 5,418.0MiB |
| 첫 생성 | 2.270초 |
| warm 생성 | 1.822초 |
| 생성 최고 CUDA 할당 | 9,469.6MiB |
| 생성 최고 CUDA reserved | 10,268.0MiB |
| 프로세스 최고 RSS | 2,730.8MiB |

같은 프로세스에서 동일 Seed와 설정으로 생성한 두 PNG의 SHA-256은 모두 다음 값으로 일치했다.

`4515643a388335ae7c786f3b5dd8b9ad303ccc99ce22a8e5b7979a2199280393`

따라서 이 검증 환경에서는 byte-level PNG 결정성까지 확인됐다. 실제 제품 메타데이터를 삽입한 뒤에는 이미지 pixel hash와 파일 hash를 구분해 테스트해야 한다.

## 5. 진행률과 취소/복구

### 협력적 취소

- 10-step 생성에서 2 step 완료 후 사용자 정의 progress iterator가 취소 예외를 발생시켰다.
- runner는 취소를 일반 실패와 구분해 기록했고 이미지 파일을 확정하지 않았다.
- 기대한 종료 코드 42를 반환했다.

### 워커 강제 종료와 재시작

- 별도 추론 프로세스에서 20-step 작업의 두 번째 step 시작을 관찰한 직후 프로세스를 강제 종료했다.
- 종료 코드는 비정상 종료를 나타내는 1이었다.
- 별도 대기 없이 새 워커를 시작해 512×512, 8-step 이미지를 정상 생성했다.
- 새 워커의 결과 코드는 0이었고 load+생성 포함 복구 검증은 8.710초 걸렸다.

검증기는
원본 저장소의 `tools/gate-a/test_worker_recovery.py`다.
이 결과는 UI와 CUDA 추론을 별도 프로세스로 나눈다는 PLAN의 결정을 지지한다.

## 6. Gate A 통과 판정

| 통과 조건 | 결과 |
|---|---|
| RTX 5090 CUDA 커널 | 통과 (`sm_120`, BF16 연산) |
| Anima-Turbo 이미지 생성 | 통과 |
| 고정 Seed 재현성 | 통과, 두 PNG hash 동일 |
| 정확한 다운로드 allowlist | 통과, 14개 파일/5,644,879,290 bytes |
| 오프라인 재생성 | 통과 |
| step 진행률 | 통과 |
| 협력적 취소 | 통과 |
| 강제 종료 후 새 워커 생성 | 통과 |
| 의존성 일관성 | 통과 (`pip check`) |

## 7. Gate B에 넘길 결정

1. 첫 포터블 후보는 CPython 3.12 + PyTorch 2.11.0 cu128 + 고정 DiffSynth commit으로 한다.
2. Gate A 검증은 고정 다운로드 manifest로 재현한다. 제품은 모델 다운로드를 제공하지 않고 `Models/`의 사용자 파일을 검사하며 DiffSynth에게 원격 `model_id`를 넘기지 않는다.
3. SD3.5 gated 저장소 대신 byte-identical SentencePiece 모델을 가진 공개 Google T5 v1.1 tokenizer를 사용한다.
4. Anima-Turbo adapter는 로드 전에 685개 tensor key/shape를 검증하고 알려진 prefix만 제거한다.
5. UI와 추론 워커는 분리한다. 정상 취소를 우선하고 timeout 뒤에는 워커를 종료·재생성한다.
6. 현재 격리 환경은 모델 포함 약 10.03GiB다. Gate B에서 개발용 패키지와 불필요 의존성을 제거해 실제 포터블 크기를 다시 측정한다.
7. 패키지 metadata 인벤토리는 법적 고지 파일을 대신하지 않는다. Gate B에서 실제 배포 대상에 포함되는 모든 라이선스 원문과 NOTICE를 수집한다.

## 8. 재현 명령

격리 환경과 자산이 준비된 상태에서:

```powershell
.\.gate-a\venv\Scripts\python.exe .\tools\gate-a\run_inference.py --result-name cold-warm.json
.\.gate-a\venv\Scripts\python.exe .\tools\gate-a\run_inference.py --runs 1 --cancel-after-steps 2 --result-name cooperative-cancel.json
.\.gate-a\venv\Scripts\python.exe .\tools\gate-a\test_worker_recovery.py
.\.gate-a\venv\Scripts\python.exe -m pip check
```

추론 스크립트는 `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `DIFFSYNTH_SKIP_DOWNLOAD=true`를 기본 적용한다.
