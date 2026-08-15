# 생성 메타데이터 schema v1

AnimaUtil은 생성된 `outputs/<name>.png`의 `AnimaUtil` PNG text chunk에 JSON을
직접 넣는다. 별도 JSON sidecar는 생성하지 않는다. 갤러리도 PNG pixel 전체를
디코딩하지 않고 `tEXt`, `zTXt`, `iTXt` chunk를 훑어 이 값을 읽는다.

## 최상위 필드

| 필드 | 의미 |
|---|---|
| `schemaVersion` | 현재 `1`. 이후 호환 마이그레이션의 기준 |
| `application` | 생성 앱 이름 |
| `jobId`, `job` | 개별 FIFO 작업 ID, 그룹 ID, 반복 순번과 전체 반복 수 |
| `createdAt`, `generatedAt` | 큐 등록 시각과 이미지 저장 시각(UTC ISO 8601) |
| `prompt`, `negativePrompt` | worker에 전달된 프롬프트 |
| `generationMode` | 싱글 생성은 `standard`, 멀티 생성은 `sub-prompt` |
| `loraLoadMode` | LoRA 가중치 융합은 `fused`, 실험적 빠른 교체는 `hotload` |
| `basePrompt`, `mainPrompt` | 결합 전 Base 프롬프트와 일반 프롬프트. 실제 `prompt`에는 두 값과 선택된 서브가 결합됨 |
| `baseNegativePrompt` | 멀티 생성에서 서브 부정 프롬프트와 결합하기 전 공통 부정 프롬프트 |
| `baseLoras` | 멀티 생성의 공통 LoRA 목록 |
| `subPrompt` | 멀티 생성에서 결합한 서브의 ID, 순번, 긍정·부정 원문과 전용 LoRA. 공통-only 변형이면 `null` |
| `model` | 선택 모델 ID, 표시명, 파일명, Models 기준 상대 경로 |
| `loras` | 적용 순서대로 기록한 LoRA ID, 경로, 강도, Turbo 여부 |
| `settings` | 출력 Prefix/SubPrefix, 멀티 작업 폴더와 슬롯 번호, 실제 크기, Steps, CFG, 샘플러, 스케줄러, Seed, 랜덤 요청 여부, 배치·큐 정보 |
| `runtime` | 앱/runtime ID와 실제 Python, PyTorch, CUDA, GPU 정보 |
| `result` | 파일명, `outputs/` 기준 상대 경로, 작업 폴더 내 Prefix·SubPrefix·슬롯 기준 출력 번호, 배치 내 이미지 순번과 전체 장수 |

PNG에는 다른 도구에서 빠르게 읽을 수 있는 `parameters` 텍스트도 함께 넣는다.
여기에는 프롬프트, Steps, 샘플러, 스케줄러, CFG, 실제 Seed, 크기와 모델 파일명이 들어간다.

## Seed와 큐 의미

- `settings.seed`는 이미지에 실제 사용한 Seed다.
- `settings.sampler`와 `settings.scheduler`는 실제 사용한 샘플링 조합이다.
- `settings.randomSeedRequested`는 사용자가 랜덤 Seed를 요청했는지 나타낸다.
- `settings.batchSize`는 해당 명령에서 순차 생성하는 장수다.
- FIFO 실행용 payload의 `settings.queueCount`는 항상 1이다.
- 사용자가 요청한 원래 큐 반복 수는 `settings.queueRepeatRequested`와
  `job.groupSize`에 보존되고 현재 반복 위치는 `job.ordinal`에 기록된다.
- 고정 Seed는 다음 배치 및 다음 큐 작업으로 넘어갈 때 이미지마다 1씩 증가한다.
- 멀티 생성의 고정 Seed는 같은 `job.queueOrdinal`을 가진 서브 변형끼리 동일한 시작 Seed를
  공유하며 `job.variationOrdinal`과 `job.variationCount`로 변형 위치를 기록한다.
- `loras`는 해당 이미지에 적용된 공통+서브 유효 목록이고 `baseLoras` 및
  `subPrompt.loras`는 그 조합의 출처를 분리해서 기록한다.

## 갤러리 재사용

갤러리는 PNG의 `AnimaUtil` chunk를 읽어 설정을 복원한다. 해당 chunk가 없거나
JSON이 손상된 이미지는 썸네일로는 표시하지만 `설정 불러오기`는 비활성화한다.
과거에 생성된 같은 이름의 JSON sidecar는 메타데이터 원본으로 사용하지 않는다.
다만 과거 PNG를 휴지통으로 이동할 때 남아 있는 legacy sidecar도 함께 정리한다.
복원은 동일한 ID가 현재 `Models/` 카탈로그에 남아 있는 모델과 LoRA에 한해 적용한다.
샘플링 필드가 없는 과거 결과는 현재 기본값 `er_sde · simple`로 복원한다.
`mainPrompt`가 없는 과거 결과는 기존 공통 프롬프트를 일반 프롬프트 칸으로 복원하고
새 Base 프롬프트 칸은 비워 둔다.

메타데이터는 사용한 설정과 런타임을 기록하지만 모델 파일 자체의 동일성 hash까지
보증하지는 않는다. 파일명이 같은 체크포인트를 교체한 경우 픽셀 단위 재현은 보장할
수 없으며, 모델 hash 기록은 이후 schema 버전의 확장 항목이다.

## 자동검열 결과

자동검열 결과는 `animautil.censor/v1` JSON을 이미지 내부에 저장하고 별도 sidecar를
만들지 않는다.

- PNG: `AnimaUtil` PNG text chunk
- JPG/JPEG, WebP: EXIF `ImageDescription`, 작성 프로그램 `AnimaUtil`

메타데이터에는 입력 파일명·드롭 루트 기준 상대 경로, 출력 상대 경로, 검열 모델,
효과 설정과 최종 검열 영역이 들어간다. 로컬 절대 경로는 기록하지 않는다. 폴더를
드롭해 처리한 결과는 `source.relativePath`와 `output.relativePath`에 드롭한 폴더
루트부터의 보존 경로를 기록한다.
