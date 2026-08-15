# AnimaUtil MVP 계획 초안

- 작성일: 2026-07-19
- 상태: 기본안 승인, Gate A/Gate B 통과
- 현재 단계: Gate C 기능 확장. 포터블 패키징과 배포 안정화는 보류
- 런타임 결정: 시스템 환경변수를 수정하지 않고 앱 전용 런타임을 절대경로로 실행
- UI 결정: Electron renderer + 제한된 preload API, 추론은 별도 Python worker

## 1. 목표와 성공 조건

AnimaUtil은 Windows에서 Anima를 로컬 실행하는 개인용 포터블 이미지 생성 도구다. 사용자는 ComfyUI, 시스템 Python, CUDA Toolkit을 별도로 설치하거나 조작하지 않아야 한다. 인터넷은 런타임/모델의 최초 준비와 명시적 업데이트에만 사용하고, 실제 생성은 로컬에서 수행한다.

MVP는 다음 조건을 모두 만족해야 성공으로 본다.

1. 새 Windows 사용자 계정 또는 동등한 깨끗한 환경에서 포터블 폴더만으로 실행된다.
2. 지원되는 NVIDIA GPU와 드라이버를 진단하고, 문제가 있으면 모델을 로드하기 전에 이해 가능한 오류를 표시한다.
3. 사용자가 동의한 파일만 내려받고 중단 후 재개, 무결성 검사, 디스크 부족 복구를 지원한다.
4. Anima-Turbo로 텍스트-이미지 생성, 진행 표시, 취소, 재시도가 안정적으로 동작한다.
5. 같은 모델 버전, 프롬프트, Seed, 해상도, Steps, CFG로 생성을 재현할 수 있도록 PNG 메타데이터를 남긴다.
6. 앱/런타임 업데이트가 `Models/`, `Presets/`, `outputs/`를 덮어쓰지 않는다.
7. 네트워크를 차단한 상태에서도 이미 설치된 모델로 생성과 갤러리 열람이 가능하다.

## 2. 현재 PC 확인 결과

| 항목 | 확인 결과 | 판단 |
|---|---|---|
| 운영체제 | Windows 11 25H2, 빌드 26200.8875, x64 | 지원 대상으로 적합 |
| GPU | NVIDIA GeForce RTX 5090 | 지원 대상으로 적합 |
| VRAM | 32,607 MiB (조회 시 30,227 MiB 여유) | Anima의 공식 최소 8GB보다 충분함 |
| Compute Capability | 12.0 (`sm_120`) | Blackwell 대응 PyTorch/CUDA 빌드 검증이 필수 |
| NVIDIA 드라이버 | 610.62 | 버전 자체는 충분해 보이나 실제 PyTorch CUDA 로딩으로 최종 판정 |
| 시스템 RAM | 61.6GB (조회 시 41.6GB 여유) | 오프로딩 및 개발 검증에 충분함 |
| 디스크 여유 | C: 약 597GB, D: 약 1,227GB | 런타임, 모델, 테스트 산출물에 충분함 |

Windows 제품명 레지스트리는 호환성 때문에 `Windows 10 Home` 문자열을 반환했지만, Microsoft의 릴리스 정보상 25H2/빌드 26200은 Windows 11이다. CIM/WMI 조회는 현재 권한에서 거부되어 레지스트리, Win32 메모리 API, `nvidia-smi`를 사용했다.

## 3. 조사로 확인된 구현 전제

### Anima와 모델 파일

- Anima는 약 20억 파라미터의 이미지 생성 모델이며 사실적 사진보다 애니메이션, 일러스트, 비사실적 이미지에 초점을 둔다.
- 제작자는 빠른 반복용 첫 모델로 Anima-Turbo를 권장하며 기본 권장값은 CFG 1, 8~12 steps다.
- 지원 해상도는 총 픽셀 면적 기준 512²~1536²이며, DiffSynth 파이프라인의 각 변은 16의 배수여야 한다.
- 최소 가중치 후보는 다음 세 파일로 약 5.6GB다.
  - `split_files/diffusion_models/anima-turbo-v1.0.safetensors` — 약 4.18GB
  - `split_files/text_encoders/qwen_3_06b_base.safetensors` — 약 1.19GB
  - `split_files/vae/qwen_image_vae.safetensors` — 약 254MB
- 위 5.6GB는 전체 다운로드 크기가 아니다. 현재 DiffSynth 예제는 `Qwen/Qwen3-0.6B`와 `stabilityai/stable-diffusion-3.5-large/tokenizer_3/`의 토크나이저 자산도 요구한다. 실제 파일 allowlist와 총 크기는 추론 스파이크에서 확정해야 한다.

### DiffSynth-Studio

- 현재 공식 Anima 직접 추론 경로는 `AnimaImagePipeline`이며, 문서는 VRAM 관리 사용 시 최소 8GB VRAM을 명시한다.
- 현재 `main`의 패키지 버전은 2.0.17이고 Python 3.10.1 이상 및 PyTorch 2.0 이상을 선언한다.
- 프로젝트 자체가 DiffSynth-Studio를 연구/최신 기능 지향으로 설명하고 소스 설치를 권장한다. 따라서 떠다니는 `main`이나 느슨한 버전 범위를 제품 런타임에 그대로 사용하지 않고, 검증한 커밋과 모든 직접 의존성을 고정한다.
- `progress_bar_cmd`를 교체할 수 있어 step 단위 진행률과 협력적 취소를 연결할 수 있다. VAE 디코딩 등 step 바깥 구간의 즉시 취소는 별도 워커 프로세스 종료가 필요하다.
- CFG가 정확히 1이면 DiffSynth는 negative branch를 실행하지 않는다. 즉 Anima-Turbo 권장 설정에서는 부정 프롬프트가 결과에 반영되지 않는다.

### RTX 5090 런타임

- RTX 5090은 Compute Capability 12.0이므로 `sm_120`을 포함하는 PyTorch CUDA 빌드가 필요하다.
- 현재 PyTorch 공식 Windows 선택기는 CUDA 12.8 빌드를 제공하지만, 정확한 PyTorch/Python 조합은 DiffSynth와 함께 실제 설치·커널 실행·패키징까지 통과한 조합으로 고정한다.
- 시스템 CUDA Toolkit에 의존하지 않는 사설 런타임을 목표로 하되, 이 조건은 포터블 패키지를 CUDA Toolkit이 없는 환경에서 실행해 최종 검증한다.

## 4. 제안하는 MVP 범위

### 포함

1. **첫 실행 및 환경 진단**
   - Windows 버전, NVIDIA GPU, VRAM, 드라이버, 디스크 여유 확인
   - CUDA/PyTorch 로드 가능 여부와 `sm_120` 지원 확인
   - 모델과 토크나이저 파일 상태 및 무결성 확인

2. **모델 검색 및 선택**
   - 초기 지원 범위는 사용자가 준비한 Anima-Turbo 호환 모델
   - 앱은 모델을 다운로드·업데이트·삭제하지 않음
   - `Models/diffusion_models/`와 `Models/loras/`를 재귀 검색
   - 일반 LoRA 복수 적용과 `Models/loras/turbo/` 전용 Turbo 옵션을 분리
   - 폴더 열기와 목록 새로고침을 제공
   - 구조 hash와 tensor shape 검증 전에는 선택 가능한 모델로 노출하지 않음
   - 읽을 수 없거나 호환되지 않는 파일은 원인과 함께 제외하고 원본 파일은 변경하지 않음

3. **생성 화면**
   - 긍정 프롬프트
   - 부정 프롬프트: 항상 편집 가능하며 CFG 1에서는 적용되지 않는 이유와 연산 경계를 표시
   - 해상도 프리셋과 16배수 사용자 지정
   - Seed: 랜덤, 직접 입력, 직전 Seed 재사용
   - Steps: Turbo 기본 10, 권장 범위 8~12 표시
   - CFG: Turbo 기본 1.0, 직접 변경 가능하며 권장값은 안내로만 표시
   - 배치 수: 한 명령에서 만들 이미지 수. 내부적으로 개별 이미지 작업으로 펼쳐 순차 생성
   - 큐 반복: 현재 설정의 명령을 큐에 넣을 횟수. 총 생성 수는 `배치 수 × 큐 반복`
   - 한 작업 실행, 이미지/step 진행률, 경과 시간, 취소
   - 단순 FIFO 대기열: 대기 작업 추가/삭제/순서 변경, 동시 추론은 1개로 제한
   - 고정 Seed의 복수 생성은 기준 Seed부터 이미지마다 1씩 증가시키고 실제 Seed를 결과 메타데이터에 기록

4. **결과와 재현성**
   - 생성 즉시 `outputs/`에 PNG 저장
   - 파일명 충돌이 없는 시간+Seed 기반 이름 사용
   - PNG 텍스트 메타데이터에 프롬프트, 부정 프롬프트, 실제 적용 여부, 모델 ID, 모델 revision/hash, Seed, 크기, Steps, CFG, 앱/런타임 버전 저장
   - 최근 결과 갤러리, 원본 열기, 폴더 열기, 설정 다시 불러오기
   - 별도 DB 없이 PNG 메타데이터와 파일 시스템을 기준으로 동작

5. **프리셋**
   - Base·일반·네거티브 프롬프트와 서브 프롬프트 리스트를 분리된 JSON 프리셋으로 관리
   - 싱글·멀티 생성 화면에서 프리셋을 현재 입력에 적용
   - 사용자 데이터 형식에 버전 필드를 두어 이후 마이그레이션 가능하게 설계

6. **오류와 복구**
   - VRAM 부족, CUDA 초기화 실패, 드라이버 불일치, 손상/누락 모델, 디스크 부족, 네트워크 중단을 구분
   - 생성 실패가 UI 프로세스를 종료시키지 않음
   - 취소 또는 CUDA 오류 후 워커를 새로 시작해 다음 작업이 오염된 CUDA 상태를 물려받지 않음

### MVP에서 제외

- LoRA 학습
- img2img
- 업스케일러
- 복수 이미지 동시 GPU 추론
- Anima-Aesthetic/Base 선택
- 모델/LoRA 썸네일 및 마켓 탐색
- 온라인 계정, 클라우드 동기화, 원격 API
- 자동 앱 업데이트

LoRA 로딩은 복수 일반 LoRA와 Turbo 전용 LoRA까지 구현했다. LoRA 학습, 온라인
검색·다운로드와 모델별 권장 강도 자동 적용은 현재 범위에 포함하지 않는다.

## 5. 제안 아키텍처

```text
AnimaUtil.exe (Electron main process)
  ├─ BrowserWindow (sandboxed renderer)
  │    └─ preload contextBridge (allowlisted API only)
  ├─ settings + preset service
  ├─ local model scan + selection service
  ├─ output/gallery service
  ├─ runtime bootstrap helper (C#, install-only)
  └─ versioned local IPC
       └─ inference worker process
            ├─ pinned private Python runtime
            ├─ pinned PyTorch CUDA runtime
            ├─ pinned DiffSynth commit
            └─ AnimaImagePipeline
```

- Electron main process가 창, 앱 수명주기, 전용 런타임 설치와 Python worker의 유일한 소유자가 된다. renderer는 운영체제 파일이나 프로세스 API에 직접 접근하지 않는다.
- renderer는 `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`로 실행하고, preload는 스키마 검증된 최소 API만 `contextBridge`로 노출한다. 원격 웹 콘텐츠와 임의 탐색은 허용하지 않는다.
- UI와 추론을 별도 프로세스로 분리한다. CUDA OOM, 취소, 네이티브 라이브러리 오류가 UI까지 죽이는 것을 줄이고, 강제 취소 후 worker만 재시작할 수 있다.
- Gate B에서 검증한 C# bootstrap은 폐기하지 않고 Electron main이 `--install-only` helper로 호출한다. 설치 완료 후 Electron이 앱 전용 `python.exe`를 절대경로와 정제된 자식 환경으로 직접 실행한다.
- IPC 메시지는 `ready`, `load`, `progress`, `result`, `error`, `cancelled`의 작은 버전형 프로토콜로 제한한다.
- 정상 취소는 step 경계에서 협력적으로 처리한다. 제한 시간 내 종료되지 않으면 워커를 종료하고 새 워커를 만든다.
- 초기에는 GPU 하나와 동시 작업 하나만 지원한다.
- 배치와 큐 반복은 동시 GPU 추론이 아니라 하나의 FIFO 이미지 작업 목록으로 정규화한다. 실패한 항목은 기록하고 워커 복구 후 다음 대기 항목을 계속 처리한다.
- 실행 시 현재 작업용 모델만 로드하고, 다음 생성에서는 파이프라인을 재사용한다. 모델 변경 기능이 추가되기 전에는 불필요한 언로드/재로드를 하지 않는다.

## 6. 포터블 배포 구조

```text
AnimaUtil/
├─ AnimaUtil.exe
├─ resources/
│  ├─ app.asar
│  └─ bootstrap/AnimaUtil.RuntimeBootstrap.exe
├─ runtime/
├─ Models/
│  ├─ diffusion_models/
│  ├─ loras/
│  │  └─ turbo/
│  ├─ text_encoders/
│  ├─ vae/
│  └─ tokenizers/
│     ├─ qwen3_0.6b/
│     └─ t5_v1_1_xxl/
├─ Presets/
├─ outputs/
├─ logs/
├─ licenses/
```

우선순위는 단일 파일 EXE가 아니라 Electron shell과 사설 Python/CUDA 런타임을 분리한 `onedir` 포터블 폴더다. UI는 Electron Forge 계열 패키징을 사용하고, 대용량 Python/CUDA 런타임은 Gate B manifest로 별도 설치·업데이트한다. 앱 shell 업데이트가 `runtime/`, `Models/`, `Presets/`, `outputs/`를 덮어쓰지 않아야 한다.

판정 기준은 시작 시간, Electron shell 크기, CUDA DLL 탐색, 모델 경로의 비ASCII/공백 처리, 바이러스 오탐, 업데이트 시 사용자 데이터 보존이다. 구현이 단순하다는 이유만으로 단일 EXE를 선택하지 않는다.

기본 데이터 위치는 실행 프로젝트 `AnimaUtil/` 안의 `Models/`, `Presets/`,
`outputs/`다. 각 위치는 설정에서 변경할 수 있어야 하며, 쓰기 불가능한 위치에서는
생성 전에 명확히 안내한다. 세부 모델 경계는
[`MODELS.md`](../features/MODELS.md)를 따른다.

## 7. 구현 전 검증 단계와 승인 게이트

### Gate A — 런타임/추론 스파이크

**결과: 2026-07-19 통과. 상세 결과는
[`GATE_A_RESULT.md`](../results/GATE_A_RESULT.md)를 참조한다.**

사용자 승인 후에만 별도 격리 디렉터리에서 수행한다.

1. Python 후보 버전 하나를 선택한다. 첫 후보는 생태계 호환성이 넓은 3.11이다.
2. RTX 5090용 PyTorch CUDA wheel을 설치하고 다음을 기록한다.
   - `torch.__version__`, `torch.version.cuda`
   - `torch.cuda.is_available()`
   - GPU 이름과 capability
   - `torch.cuda.get_arch_list()`의 `sm_120` 포함 여부
   - 간단한 CUDA tensor 연산 성공 여부
3. DiffSynth-Studio를 특정 commit에 고정해 설치한다.
4. 토크나이저를 포함한 정확한 다운로드 manifest, 총 크기, 라이선스 목록을 작성한다.
5. Anima-Turbo 한 장을 1024×1024, Seed 고정, 10 steps, CFG 1로 생성한다.
6. 첫 생성과 warm 생성의 모델 로드 시간, 생성 시간, 최고 VRAM, RAM, 디스크 임시 사용량을 기록한다.
7. 네트워크 차단 상태에서 같은 로컬 파일만으로 두 번째 생성을 수행한다.
8. step 콜백, 협력적 취소, 워커 강제 종료 후 재생성을 검증한다.

**통과 조건:** CUDA 커널과 이미지 생성 성공, 재현 가능한 Seed, 오프라인 재생성 성공, 다운로드 파일 목록 확정, 취소 후 다음 생성 성공.

**실패 시:** UI 구현으로 넘어가지 않고 PyTorch 빌드, DiffSynth commit, 직접 pipeline adapter 또는 엔진 후보를 다시 결정한다.

### Gate B — 포터블 패키징 스파이크

**결과: 2026-07-19 통과. 상세 결과는
[`GATE_B_RESULT.md`](../results/GATE_B_RESULT.md)를 참조한다.**

1. 최소 CLI 워커를 포터블 구조로 묶는다.
2. 시스템 Python과 CUDA Toolkit이 없는 환경 또는 그와 동등한 격리 환경에서 실행한다.
3. ASCII/한글/공백 경로에서 모델 로드와 저장을 확인한다.
4. 앱 폴더 이동 후 실행, 읽기 전용 위치 오류, 긴 경로를 확인한다.
5. 런타임 크기와 콜드 스타트 시간을 기록한다.

**통과 조건:** 외부 Python/CUDA Toolkit 없이 실행되고, 폴더 이동 후에도 모델/출력 경로가 올바르며, 누락 DLL이 없다.

검증된 구현은 작은 Windows 부트스트랩이 고정 manifest의 런타임 ZIP을 앱의
`runtime/versions/<runtime-id>/`에 설치한 뒤, 그 안의 `python.exe`를 절대경로로
실행한다. `PYTHONHOME`, `PYTHONPATH`, `CUDA_PATH`, `CUDA_HOME`은 자식 프로세스에서
제거하며 `PATH`도 앱 런타임과 Windows 시스템 디렉터리만으로 재구성한다. 시스템
환경변수나 레지스트리는 수정하지 않는다.

### Gate C — MVP 구현

1. Electron main/preload/renderer 골격, CSP와 IPC 스키마, 로깅
2. Gate B runtime bootstrap helper 연결과 설치 진행/취소/재시도 UI
3. 진단과 로컬 모델 검색·선택
4. 추론 worker 및 stdio JSON IPC
5. 생성 UI와 대기열/취소
6. PNG 메타데이터와 갤러리
7. 프리셋
8. 오류 복구, 오프라인 동작, 포터블 빌드 및 새 환경 검증

각 단계는 자동 테스트와 짧은 수동 시나리오를 모두 통과한 뒤 다음 단계로 간다.

**2026-07-20 현재:** 로컬 모델·LoRA 재귀 검색, 읽기 전용 호환성 진단, Electron
IPC, 상주 추론 worker, 실제 FIFO 큐와 취소, PNG 저장·미리보기를 연결했다.
PNG에는 schema v1 메타데이터를 넣고 별도 JSON sidecar 없이 이미지 자체를
저장한다. 최근 결과 갤러리에서 설정을 생성 화면으로 되가져올 수 있다. 사용자
체크포인트 `oneObsessionAnima_v20`과 LoRA `Turbo-ANIMA-v2.9` 조합으로 Electron
전체 경로의 1024×1024 GPU 생성과 메타데이터 왕복을 통과했다. 싱글·멀티 생성,
샘플러·스케줄러, 서브별 LoRA, 자동검열, 네 종류 프롬프트 프리셋과 환경 프리셋 관리 및 생성 화면
적용과 생성 화면의 새 프리셋 저장·선택 항목 덮어쓰기까지 구현했다. 제품용 runtime
승격 및 새 환경 검증은 보류 중이다.

개발 실행과 현재 경계는 [`GENERATION.md`](../features/GENERATION.md)를 따른다.

### Gate C 기능 확장 우선 결정

**2026-07-19 결정:** 포터블 패키징, 제품용 runtime 승격, 새 Windows 환경 검증과
배포 안정화는 기능 구성이 충분히 확정될 때까지 보류한다. 사용자가 다시 진행을
지시하기 전에는 이 항목을 활성 작업으로 잡지 않는다.

현재는 검증된 개발용 사설 runtime을 유지하면서 다음 기능에 집중한다.

1. ~~생성 작업 schema와 PNG 메타데이터~~ — 완료
2. ~~복수 명령을 다루는 실제 FIFO 대기열~~ — 완료
3. ~~모델·LoRA 사전 진단과 모델 화면~~ — 완료
4. ~~갤러리와 생성 설정 재사용~~ — 완료
5. ~~프롬프트 프리셋 관리 및 생성 화면 적용~~ — 완료
6. ~~생성 화면의 프리셋 새 저장·선택 항목 덮어쓰기~~ — 완료
7. ~~환경 프리셋~~ — 완료. 모델·공통 LoRA·크기·샘플링·반복·출력 규칙 저장, 프롬프트 본문은 기존 4종과 분리
8. 앱 설정 영속화와 추가 생성 기능·UI 확장

기능 개발 중에도 기존 Node 테스트, Electron shell smoke와 실제 GPU generation
smoke는 계속 통과시킨다. 패키징 관련 코드는 필요한 경우에만 호환성을 보존하고,
기능보다 먼저 확장하지 않는다.

## 8. 핵심 위험과 완화책

| 위험 | 영향 | 완화책 |
|---|---|---|
| RTX 5090과 잘못된 PyTorch CUDA wheel | GPU 미인식 또는 `sm_120` 커널 오류 | Gate A 첫 항목으로 CUDA tensor 테스트, 통과한 wheel과 hash 고정 |
| DiffSynth `main` 변경 또는 회귀 | 갑작스러운 API/동작 파손 | commit pin, adapter 계층, 고정 Seed 스모크 테스트 |
| DiffSynth의 연구 지향 및 넓은 의존성 | 패키징 크기/안정성 저하 | Anima 실행에 필요한 최소 의존성 실측, 불필요 extras 제외, 라이선스 인벤토리 |
| 필수 토크나이저·보조 자산 누락 | 오프라인 로드 실패 | 로컬 파일 사전 진단과 누락 항목 안내, 추론 중 원격 다운로드 금지 |
| Turbo CFG 1에서 부정 프롬프트 무효 | UI가 거짓 기대를 줌 | 기본 상태에서 비활성화하고 실제 적용 여부를 메타데이터에 기록 |
| 취소 중 CUDA 상태 손상 | 이후 작업 연쇄 실패 | 별도 워커, 협력적 취소 후 timeout 시 워커 재시작 |
| Electron renderer 권한 과다 또는 IPC 오용 | 로컬 파일/프로세스 권한 노출 | sandbox/contextIsolation, Node 통합 금지, preload allowlist와 main 입력 검증 |
| Electron/Node와 Python의 이중 런타임 관리 | 업데이트 및 장애 지점 증가 | Electron은 UI shell로 제한하고 Python runtime은 기존 manifest와 bootstrap 경계를 재사용 |
| 손상되거나 호환되지 않는 사용자 모델 | 로드 실패 또는 워커 종료 | 선택 전 구조 검사, 명확한 제외 사유, 원본 파일 비변경 |
| 포터블 폴더 쓰기 권한 없음 | 설정/출력 저장 실패 | 시작 시 쓰기 검사, 경로 변경 안내, 사용자 데이터와 앱 파일 분리 |
| 모델/앱 라이선스 혼동 | 배포 또는 상업 이용 시 위반 | 모델은 사용자 제공 자산임을 명시하고 앱의 third-party notices와 분리 |
| 이미지 메타데이터가 외부 편집으로 제거됨 | 재현 정보 유실 | 앱 저장 시 내장 메타데이터를 기록하고 외부 편집·내보내기 시 메타데이터 보존 여부를 안내 |

## 9. 테스트 기준

### 자동화 대상

- 설정 스키마 검증 및 마이그레이션
- 모델·LoRA 하위 폴더 재귀 검색과 확장자 필터링
- 손상 파일, 비호환 tensor 및 접근 불가 경로의 안전한 제외
- Seed/설정 직렬화와 PNG 메타데이터 왕복
- 대기열 상태 전이와 취소/실패 후 다음 작업 진행
- IPC protocol version 및 비정상 워커 종료 처리
- 경로에 한글, 공백, 긴 이름이 있는 경우

### 실제 GPU 수동/통합 확인

- 1024×1024 Turbo 기본 생성
- 동일 Seed/설정의 재생성 비교
- cold/warm 생성 시간과 최고 VRAM/RAM
- 생성 중 취소와 즉시 다음 생성
- VRAM 부족을 유도한 뒤 복구
- 네트워크 차단 후 실행
- 새 Windows 환경에서 포터블 폴더 실행

## 10. 승인받을 제안값

다음 값을 기본안으로 제안한다.

| 결정 항목 | 제안 |
|---|---|
| 초기 모델 | 사용자가 넣은 Anima-Turbo 호환 모델 |
| 모델 획득 | 앱에서 제공하지 않음. 사용자가 직접 `Models/`에 배치 |
| LoRA | 복수 일반 LoRA와 `loras/turbo/` 전용 Turbo 옵션 지원 |
| 기본 출력 위치 | 포터블 폴더의 `outputs/`, 설정에서 변경 가능 |
| 최종 배포 형태 | 포터블 `onedir` 후보, 현재 작업 보류 |
| 추론 구조 | UI와 별도 워커 프로세스 |
| 기본 생성값 | 1024×1024, 10 steps, CFG 1, 랜덤 Seed |
| 업데이트 | 모델 업데이트 기능과 자동 앱 업데이트 모두 제외 |

모델 자산은 사용자가 직접 준비하며 앱은 임의로 설치하거나 다운로드하지 않는다.

## 11. 근거 자료

- [Anima 공식 모델 카드](https://huggingface.co/circlestone-labs/Anima)
- [Anima 공식 파일 트리](https://huggingface.co/circlestone-labs/Anima/tree/main/split_files)
- [CircleStone Labs Non-Commercial License](https://huggingface.co/circlestone-labs/Anima/blob/main/LICENSE.md)
- [DiffSynth-Studio Anima 문서](https://github.com/modelscope/DiffSynth-Studio/blob/main/docs/en/Model_Details/Anima.md)
- [DiffSynth-Studio 패키지 정의](https://github.com/modelscope/DiffSynth-Studio/blob/main/pyproject.toml)
- [PyTorch Windows 설치 안내](https://pytorch.org/get-started/locally/)
- [Microsoft Windows 11 릴리스 정보](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information)
