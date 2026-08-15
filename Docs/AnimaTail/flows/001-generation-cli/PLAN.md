# Flow 001 생성 CLI 계획

- 작성일: 2026-08-04
- 상태: 1차 구현 완료
- 대상 앱 버전: `0.1.0` 개발 트리
- 목표 사용자: 사람과 로컬 AI 에이전트

## 목표

AnimaUtil의 싱글 생성, 멀티 생성과 프롬프트 프리셋을 GUI 없이 명령줄에서
사용할 수 있게 한다. CLI는 별도 추론 구현을 만들지 않고 GUI와 같은 생성 요청 정규화,
FIFO 큐, 모델·LoRA 해석, Python worker와 출력 규칙을 재사용한다.

최종 구조에서 React GUI와 CLI는 서로를 호출하지 않는 동급 입력 adapter다.

```text
React GUI ─┐
           ├─> Generation Application API ─> JobQueue ─> InferenceService
CLI ───────┘                                            └─> Python worker
                                                               └─> Anima core
```

## 성공 조건

1. 앱 전용 Python/CUDA 런타임과 기존 모델 자산만 사용해 CLI 싱글 생성이 완료된다.
2. 멀티 생성에서 출력 대상으로 선택된 서브 프롬프트, 원래 슬롯 번호, 서브별 LoRA,
   batch, queue와 현재 출력 폴더·파일명 규칙을 그대로 보존한다.
3. Base, 일반, 네거티브와 서브 프롬프트 리스트 프리셋을 ID로 조회하고 생성 요청에
   적용할 수 있다.
4. CLI에서 새 프리셋 저장과 기존 프리셋 덮어쓰기가 가능하며 GUI와 같은 schema v1
   JSON을 사용한다.
5. 기계 판독 출력은 안정적인 JSON 또는 JSONL이며 진행률, 결과 경로, 실패 원인과
   종료 코드를 AI가 별도 화면 해석 없이 판단할 수 있다.
6. 같은 정규화 전 요청과 고정 Seed를 GUI와 CLI에 전달했을 때 worker에 전달되는
   생성 payload와 결과 metadata가 일치한다.
7. CLI 실행 중 Electron 창이나 운영체제 확인 대화상자가 열리지 않는다.

## 범위

### 생성 명령

- 싱글 생성
- 멀티 생성
- Base 프롬프트와 일반 프롬프트 결합
- 기본 네거티브와 서브 네거티브 결합
- diffusion model 선택
- 공통 LoRA 복수 적용과 Turbo LoRA
- 멀티 서브별 전용 LoRA
- `fused`와 실험적 `hotload` LoRA 모드
- width, height, steps, CFG, sampler, scheduler
- random/fixed Seed, batch와 queue 반복
- Prefix, SubPrefix와 멀티 슬롯 번호
- 현재 멀티 작업별 출력 하위 폴더와 PNG metadata
- JSONL 진행 이벤트와 `Ctrl+C` 취소

### 프리셋 명령

- 다섯 분류 목록 조회
  - `base`
  - `prompts`
  - `negativePrompts`
  - `subPrompts`
- category와 ID를 이용한 단일 프리셋 조회
- 새 프리셋 저장
- ID를 명시한 기존 프리셋 덮어쓰기
- 싱글 생성에서 Base·일반·네거티브 프리셋 적용
- 멀티 생성에서 위 세 종류와 서브 프롬프트 리스트 프리셋 적용

프리셋 이름은 표시와 검색 보조 정보로만 사용하고, 자동화에서의 정식 참조값은
변경되지 않는 `category + id`로 한다. 이름으로도 찾을 수 있게 한다면 같은 category
안에서 정확히 하나가 일치할 때만 허용한다.

### AI 실행을 위한 보조 조회

다음은 별도 사용자 기능 확장이 아니라 생성 전 조건을 판독하기 위한 읽기 전용 명령이다.

- 앱·런타임·필수 보조 자산 준비 상태
- 사용 가능한 diffusion model과 LoRA ID 목록
- CLI schema 및 지원 명령 목록

## 비범위

- 자동검열의 검출, 편집, 미리보기와 저장
- 리파인, img2img, 업스케일과 부분 편집
- 갤러리 열람·휴지통 이동·설정 불러오기
- 프리셋 삭제와 휴지통 복원
- 런타임, 필수 보조 자산, 선택 보조 자산의 CLI 다운로드
- 모델·LoRA 다운로드와 삭제
- GUI와 CLI가 동시에 사용하는 공용 상주 큐
- CLI daemon, 로컬 HTTP 서버, named pipe와 MCP server
- 자연어를 생성 설정으로 변환하는 AI 로직
- GUI 레이아웃과 디자인 변경
- Python 샘플러·스케줄러 알고리즘 변경

프리셋 삭제는 AI의 실수로 사용자 JSON을 잃지 않도록 1차 범위에서 제외한다. 이후
Windows 휴지통 또는 앱 내부 복구 폴더를 공유하는 안전한 삭제 adapter가 확정되면 별도
flow로 추가한다.

## 명령 표면 초안

실제 실행 파일 이름은 `AnimaUtil_CLI.bat`로 하고, 개발 환경에서는 같은 진입점을
`npm run cli -- <args>`로 실행한다.

```powershell
AnimaUtil_CLI.bat capabilities --json
AnimaUtil_CLI.bat status --json
AnimaUtil_CLI.bat models list --json
AnimaUtil_CLI.bat presets list --json
AnimaUtil_CLI.bat presets list --category subPrompts --json
AnimaUtil_CLI.bat presets get --category base --id <preset-id> --json
AnimaUtil_CLI.bat presets save --config .\preset.json --json
AnimaUtil_CLI.bat presets save --id <preset-id> --config .\preset.json --overwrite --json
AnimaUtil_CLI.bat generate single --config .\single-job.json --jsonl
AnimaUtil_CLI.bat generate multi --config .\multi-job.json --jsonl
```

복잡한 프롬프트, LoRA와 서브 프롬프트를 shell 인자로 직접 조합하는 방식은 주 경로로
삼지 않는다. AI 자동화의 정식 입력은 UTF-8 JSON 파일이며 간단한 scalar만 선택적으로
CLI flag로 덮어쓸 수 있게 한다.

## 입력 계약

### 공통 원칙

- CLI 문서 schema와 내부 worker schema를 구분한다.
- CLI 입력에는 `schemaVersion`과 `mode`를 필수로 둔다.
- model과 LoRA는 catalog ID로 받으며 기본 동작에서는 임의 절대경로를 받지 않는다.
- 앱 루트는 BAT와 CLI 진입점의 위치로 결정한다.
- `--app-root`는 격리 테스트 전용 옵션으로만 허용하고 일반 도움말에는 노출하지 않는다.
- 알 수 없는 필드와 지원하지 않는 enum은 조용히 무시하지 않고 입력 오류로 처리한다.
- 프롬프트와 경로는 UTF-8을 사용하며 한글·공백 경로를 보존한다.

### 싱글 생성 예시

```json
{
  "schemaVersion": 1,
  "mode": "single",
  "presets": {
    "base": "base-quality-a1b2c3d4",
    "prompt": "character-a-1234abcd",
    "negativePrompt": "negative-default-5678efab"
  },
  "promptOverrides": {
    "prompt": "smiling, classroom"
  },
  "modelId": "diffusion_models:oneObsessionAnima_v20.safetensors",
  "loras": [],
  "outputPrefix": "au",
  "width": 1024,
  "height": 1024,
  "steps": 20,
  "cfg": 1,
  "sampler": "er_sde",
  "scheduler": "simple",
  "batchSize": 1,
  "queueCount": 1,
  "randomSeed": true,
  "seed": 0
}
```

### 멀티 생성 예시

```json
{
  "schemaVersion": 1,
  "mode": "multi",
  "presets": {
    "base": "base-quality-a1b2c3d4",
    "prompt": "character-a-1234abcd",
    "negativePrompt": "negative-default-5678efab",
    "subPrompts": "expression-set-90abcdef"
  },
  "modelId": "diffusion_models:oneObsessionAnima_v20.safetensors",
  "loras": [],
  "loraLoadMode": "fused",
  "outputPrefix": "au",
  "outputSubPrefix": "character-a",
  "subPromptOverrides": [
    {
      "slot": 1,
      "enabled": true,
      "loras": []
    },
    {
      "slot": 2,
      "enabled": false,
      "loras": []
    }
  ],
  "width": 1024,
  "height": 1024,
  "steps": 20,
  "cfg": 1,
  "sampler": "er_sde",
  "scheduler": "simple",
  "batchSize": 3,
  "queueCount": 1,
  "randomSeed": false,
  "seed": 1000
}
```

서브 프롬프트 프리셋 schema는 현재와 같이 긍정·네거티브 문자열과 순서만 보존한다.
CLI 실행용 `enabled`, SubPrefix와 서브별 LoRA는 프리셋 파일을 변형하지 않고
`subPromptOverrides`에서 슬롯 번호로 합성한다. 프리셋에 존재하지 않는 슬롯을
override하면 입력 오류로 처리한다.

### 병합 우선순위

동일 필드가 여러 곳에 있을 때 다음 순서로 뒤의 값이 앞의 값을 덮어쓴다.

```text
generation-profile 기본값
  < 참조한 프리셋 내용
  < config의 promptOverrides/subPromptOverrides
  < 명시적인 CLI scalar flag
```

빈 문자열은 명시적인 값으로 취급한다. 프리셋을 읽지 못하거나 category가 맞지 않으면
해당 프리셋만 생략하지 않고 전체 요청을 실패시킨다.

## 출력 계약

### stdout와 stderr

- `--json`: 최종 결과 객체 하나만 stdout에 출력한다.
- `--jsonl`: 진행 이벤트와 최종 결과를 한 줄에 JSON 객체 하나씩 stdout에 출력한다.
- Python 경고, 진단 로그와 사람용 설명은 stderr로 보낸다.
- ANSI 색상과 지역화된 장식 문자는 JSON/JSONL stdout에 넣지 않는다.
- machine field 이름과 `code` 값은 언어 설정과 무관하게 고정한다.
- 사용자용 `message`는 한국어일 수 있지만 판정은 `code`로 한다.

### JSONL 이벤트

```text
ready
validated
queued
loading
progress
image
completed
cancelled
error
```

모든 이벤트는 최소한 다음 필드를 가진다.

```json
{
  "schemaVersion": 1,
  "event": "progress",
  "requestId": "request-id",
  "timestamp": "2026-08-04T00:00:00.000Z",
  "data": {}
}
```

`image`와 `completed`는 앱 루트 기준 상대 출력 경로, Seed, width, height와 소요 시간을
반환한다. 절대경로는 명시적인 `--absolute-paths`가 있을 때만 추가한다.

### 종료 코드

| 코드 | 의미 |
|---:|---|
| `0` | 요청한 모든 작업 완료 |
| `2` | CLI 인자 또는 JSON schema 오류 |
| `3` | 런타임·필수 보조 자산·모델·LoRA·프리셋 누락 |
| `4` | worker 시작 또는 이미지 생성 실패 |
| `5` | 일부 작업 성공 후 나머지 작업 실패 |
| `130` | 사용자 또는 상위 프로세스가 취소 |

멀티 생성은 일부 결과가 만들어진 뒤 실패한 경우 그 결과 경로를 최종 `error` 객체에
포함하고 종료 코드 `5`를 사용한다.

## 실행 수명주기

1차 CLI는 one-shot 프로세스다.

1. 설정과 프리셋을 읽는다.
2. 앱 전용 런타임과 필수 보조 자산을 점검한다.
3. catalog ID를 실제 모델·LoRA 경로로 해석한다.
4. GUI와 공유하는 정규화 함수로 JobQueue 요청을 만든다.
5. InferenceService가 기존 Python worker를 실행한다.
6. 한 CLI 호출에 포함된 싱글 또는 멀티 그룹이 끝날 때까지 같은 worker를 유지한다.
7. 완료·실패·취소 후 worker와 스트림을 정리하고 정해진 종료 코드로 끝낸다.

따라서 멀티 생성의 서브 슬롯마다 프로세스나 기본 모델을 다시 시작하지 않는다. 다만
서로 독립된 CLI 호출 사이에는 모델을 유지하지 않으며 GUI의 실행 중 큐와도 공유하지 않는다.
상주 모델과 공용 큐는 실제 사용에서 반복 로드가 문제가 될 때 별도 daemon flow로 판단한다.

첫 번째 `Ctrl+C`는 활성 작업과 남은 CLI 작업을 취소하고 worker 종료를 기다린다. 짧은
유예 시간 안에 끝나지 않으면 현재 InferenceService의 강제 종료 경로를 사용한다. 취소 중
이미 저장된 PNG는 삭제하지 않는다.

## 변경 대상

### 기존 파일

| 파일 | 계획된 변경 |
|---|---|
| `AnimaUtil/electron/main.cjs` | `normalizeGenerationRequest`와 관련 helper를 Electron 전역에서 분리하고 새 application API를 조립·호출 |
| `AnimaUtil/electron/job-queue.cjs` | 특정 group의 terminal 상태를 await하고 부분 성공을 집계할 수 있는 headless 완료 계약 추가 |
| `AnimaUtil/electron/inference-service.cjs` | CLI 종료 시 worker·readline·pending promise를 확실히 정리하는 명시적 close 경로 검증·보강 |
| `AnimaUtil/electron/model-catalog.cjs` | CLI가 절대경로를 노출하지 않는 public catalog와 ID 해석을 재사용하도록 경계 정리 |
| `AnimaUtil/electron/preset-service.cjs` | GUI와 CLI가 같은 list/read/save 검증을 사용하도록 공개 계약 정리 |
| `AnimaUtil/package.json` | 개발용 `cli` script 추가 |
| `AnimaUtil/README.md` | CLI 실행 조건과 최소 예시 추가 |
| `docs/features/GENERATION.md` | 구현 완료 후 CLI 생성 경계 추가 |
| `docs/features/PRESETS.md` | 구현 완료 후 CLI 조회·저장·덮어쓰기 경계 추가 |
| `docs/development/TESTING.md` | CLI 단위·통합·실제 GPU 검증 명령 추가 |

### 신규 파일 후보

최종 이름은 구현 시 기존 모듈 배치와 테스트 import 비용을 확인한 뒤 확정한다.

| 파일 | 책임 |
|---|---|
| `AnimaUtil/electron/generation-request.cjs` | 싱글·멀티 공용 요청 정규화. Electron 및 renderer에 의존하지 않는 순수/주입형 모듈 |
| `AnimaUtil/electron/generation-application.cjs` | catalog, preset, JobQueue와 InferenceService를 조립하는 headless facade |
| `AnimaUtil/cli/main.cjs` | 인자 파싱, 명령 routing, JSON/JSONL 출력과 종료 코드 |
| `AnimaUtil/cli/generation-config.cjs` | CLI schema 검증, 프리셋 병합과 내부 요청 변환 |
| `AnimaUtil/config/cli-generation.schema.json` | AI가 읽을 수 있는 버전형 싱글·멀티 입력 schema |
| `AnimaUtil/AnimaUtil_CLI.bat` | 프로젝트 위치 기준 로컬 실행기 |
| `AnimaUtil/tests/generation-request.test.cjs` | GUI/CLI 공용 정규화 회귀 테스트 |
| `AnimaUtil/tests/cli-generation-config.test.cjs` | schema, 프리셋 병합과 슬롯 override 테스트 |
| `AnimaUtil/tests/cli-contract.test.cjs` | subprocess stdout, JSONL, 종료 코드와 취소 테스트 |
| `docs/features/CLI.md` | 사용자·AI용 명령과 schema 문서 |

`generation-request.cjs`는 `getAppRoot`, 앱 버전, runtime 정보와 catalog를 인자로 받고
`electron.app`이나 전역 singleton을 직접 참조하지 않게 한다. 이 분리가 완료되어야
GUI와 CLI의 조용한 동작 차이를 막을 수 있다.

## 구현 단계

### Phase 0 — 기준선 고정

- 현재 `npm run check` 결과 기록
- 싱글·멀티 GUI 요청 fixture 확보
- 프리셋 다섯 category의 정상·손상 fixture 확보
- 고정 Seed 실제 생성 한 건의 metadata와 출력명 기록

통과 조건: 구조 변경 전 현재 동작과 자동 테스트가 정상이며 비교 fixture가 준비된다.

### Phase 1 — 공용 생성 계약 분리

- `main.cjs`의 생성 정규화 helper와 `normalizeGenerationRequest()` 분리
- app root, version, runtime status, catalog를 dependency로 주입
- 싱글·멀티 및 서브 선택·슬롯·LoRA 검증을 순수 모듈 테스트로 이전
- Electron IPC는 새 공용 함수를 호출하도록 변경

통과 조건: renderer 수정 없이 기존 GUI 요청 테스트와 `npm run check`가 통과한다.

### Phase 2 — 프리셋 해석과 CLI schema

- version 1 JSON schema 확정
- category+ID 프리셋 참조와 병합 우선순위 구현
- 서브 프롬프트 프리셋과 슬롯 override 결합
- unknown field, 잘못된 category/ID, 중복 LoRA와 범위 오류 테스트

통과 조건: 같은 fixture에서 직접 입력과 프리셋 입력이 동일한 내부 요청을 만든다.

### Phase 3 — Headless application facade

- JobQueue와 InferenceService 조립을 Electron window 수명주기에서 분리
- group 완료 promise, 부분 성공, cancel과 close 구현
- GUI main도 같은 facade 또는 같은 하위 서비스를 사용
- Electron UI 이벤트와 CLI JSONL event를 각 adapter에서 변환

통과 조건: fake executor로 싱글·멀티 완료, 실패, 부분 성공과 취소를 창 없이 검증한다.

### Phase 4 — CLI와 로컬 실행기

- `capabilities`, `status`, `models list`, `presets list/get/save` 구현
- `generate single`, `generate multi` 구현
- stdout/stderr 분리와 종료 코드 적용
- `AnimaUtil_CLI.bat` 및 `npm run cli` 연결
- BAT는 자신의 폴더를 앱 루트로 사용하고 현재 설치된 로컬 Electron/Node 실행 파일만 사용

통과 조건: 시스템 현재 디렉터리와 무관하게 한글·공백 경로에서 CLI help와 read-only
명령이 동작하고, fake worker 생성 명령이 JSONL만 stdout에 남긴다.

### Phase 5 — 실제 GPU 검증

- 싱글 고정 Seed 생성
- batch와 queue를 포함한 싱글 생성
- 선택/해제 슬롯이 섞인 멀티 생성
- 서브 프롬프트 프리셋과 슬롯별 LoRA 멀티 생성
- fused 및 hotload 각 한 작업
- 진행 중 `Ctrl+C`와 다음 실행 복구
- GUI와 CLI 결과 metadata 및 파일명 규칙 비교

통과 조건: 아래 수동 시나리오와 자동 검증을 모두 통과하고 `RESULT.md`에 실제 모델,
설정, 출력 상대경로와 결과를 기록한다.

### Phase 6 — 문서와 AI 소비 경계 확정

- `CLI.md`에 명령, schema, event, 종료 코드와 예제 작성
- `capabilities --json` 결과가 문서와 일치하는지 테스트
- 프리셋 변경과 생성 결과를 포함하는 agent-style 순차 smoke 작성
- `GENERATION.md`, `PRESETS.md`, `TESTING.md`, `TABS.md` 갱신

통과 조건: 새 대화나 별도 AI가 GUI 설명 없이 문서와 `capabilities` 출력만으로
모델 확인, 프리셋 조회, 멀티 생성과 결과 경로 확인을 완료할 수 있다.

## 검증 계획

### 자동 검증

```powershell
cd .\AnimaUtil
npm run test
npm run build
npm run check
npm run cli -- capabilities --json
npm run cli -- status --json
```

추가 테스트는 실제 사용자 `Models/`, `Presets/`, `outputs/`를 사용하지 않고 임시 앱
루트와 fixture를 사용한다. 실제 GPU 검증만 명시적으로 사용자 자산을 읽는다.

필수 자동 시나리오는 다음과 같다.

1. 싱글 직접 입력 정규화
2. 싱글 프리셋 조합과 inline override
3. 멀티 서브 프리셋의 순서 및 비활성 슬롯 보존
4. 서브별 LoRA와 공통 LoRA 중복 거부
5. 잘못된 model·LoRA·preset ID 거부
6. 범위 밖 크기·steps·CFG·batch·queue·Seed 거부
7. JSONL 한 줄 한 객체 보장
8. stdout 로그 오염 방지
9. 완료, worker 실패, 부분 성공과 취소 종료 코드
10. CLI 종료 후 child worker 잔류 없음

### 실제 GPU 수동 시나리오

1. GUI와 CLI에서 같은 모델, 프롬프트, 설정과 고정 Seed로 싱글 한 장을 생성한다.
2. 두 PNG의 생성 설정 metadata와 해상도를 비교한다.
3. CLI 멀티에서 서브 슬롯 1, 3만 활성화하고 각 슬롯 batch 2를 생성한다.
4. 멀티 작업 폴더, 슬롯 번호와 `{prefix}_{subPrefix}_{slot}_{num}.png`를 확인한다.
5. Base·일반·네거티브·서브 프롬프트 프리셋을 조합해 생성하고 metadata에서 결합값을 확인한다.
6. hotload 멀티 A-B-A 순서로 생성해 기존 GUI 검증과 같은 LoRA 잔류 없음 조건을 확인한다.
7. 긴 작업에서 `Ctrl+C` 후 worker가 종료되고 다음 CLI 싱글 생성이 성공하는지 확인한다.

## 위험과 대응

| 위험 | 대응 |
|---|---|
| GUI와 CLI가 서로 다른 요청 조립 규칙을 가짐 | `normalizeGenerationRequest`를 먼저 분리하고 양쪽이 동일 함수를 호출 |
| CLI 호출마다 모델을 다시 로드해 반복 작업이 느림 | 한 호출의 전체 batch·queue·sub 작업 동안 worker 유지. 호출 간 상주는 후속 daemon 판단 |
| mutable preset 이름으로 잘못된 항목 적용 | 자동화 정식 키를 category+ID로 고정하고 중복 이름은 모호성 오류 |
| 서브 프롬프트 프리셋에 실행 상태가 섞임 | preset 원본은 prompt/negative/order만 유지하고 enabled·LoRA는 slot override로 분리 |
| worker/Python 로그가 JSONL을 오염 | child stdout을 서비스에서 파싱하고 CLI adapter가 승인된 event만 재출력, 로그는 stderr |
| CLI 종료 후 CUDA worker가 남음 | facade에 idempotent `close()`와 signal handler, child 잔류 통합 테스트 추가 |
| AI가 임의 파일 경로를 주입 | model·LoRA·preset은 catalog ID만 허용하고 출력은 앱 `outputs/` 내부로 제한 |
| GUI 리팩터링 중 기존 동작 회귀 | 구조 분리 단계와 CLI 기능 단계를 나누고 각 Phase마다 `npm run check` 수행 |
| dirty worktree의 기존 변경과 충돌 | 현재 사용자 변경을 보존하고 변경 전 파일별 diff를 확인하며 관련 구간만 수정 |

## 완료 산출물

- GUI와 CLI가 공유하는 생성 application API
- 버전형 CLI generation schema
- `AnimaUtil_CLI.bat`
- 싱글·멀티 생성 명령
- 프리셋 조회·새 저장·덮어쓰기와 생성 적용 명령
- JSON/JSONL event 및 종료 코드 계약
- 단위·통합 테스트와 실제 GPU 검증 결과
- `docs/features/CLI.md`
- 이 flow의 `RESULT.md`

## 확정된 1차 결정

1. 1차 CLI에서 프리셋 삭제를 제외하고 조회·신규 저장·덮어쓰기까지만 지원한다.
2. CLI 호출 간 모델 상주는 하지 않고, 한 번의 싱글/멀티 명령 안에서만 worker와 모델을 유지한다.
