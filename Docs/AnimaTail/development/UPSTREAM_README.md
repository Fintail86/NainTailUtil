# AnimaUtil

ComfyUI 없이 Anima 모델을 로컬에서 바로 돌리고 싶어서 만든 Windows용 이미지 생성 유틸리티입니다. 노드 그래프를 조립하는 대신, 켜서 프롬프트를 넣고 뽑는 데 집중합니다. 이 저장소 루트가 앱 실행 기준 루트입니다.

## 주요 기능

- **싱글 생성 / 멀티 생성** — 익숙한 단일 생성 모드와, 기본 프롬프트에 서브 프롬프트 변형을 조합해 배치로 뽑는 멀티 슬롯 모드
- **프리셋** — Base / 일반 / 네거티브 / 서브 리스트 프롬프트 자산과 모델·LoRA·생성값 환경을 독립적으로 저장·조합
- **LoRA** — 슬롯별 개별 적용, fused/hotload 전환 지원
- **자동 검열(선택)** — 생성 후 ONNX 기반 검출·처리, 모델은 최초 사용 시 다운로드
- **미리보기 뷰어** — 1:1 리얼사이즈, 휠 줌, 드래그 이동, 영역 스냅샷
- **한국어/영어 UI** — `locales/`에 JSON을 추가하면 다른 언어도 사용 가능
- **CLI / MCP 자동화** — 화면 없이 싱글·멀티 생성, AI용 비동기 MCP 작업 등록과 상태 조회

## Windows에서 실행하기

`START_ANIMAUTIL.bat`를 실행하면 됩니다. 첫 실행에는 시스템에 Node.js LTS와 npm이 필요하고, BAT가 잠금 파일 기준으로 로컬 Electron과 빌드 의존성을 설치한 뒤 renderer를 빌드합니다. 이후 실행부터는 현재 폴더의 `node_modules/electron`과 `dist/renderer`를 그대로 사용합니다.

현재 공개 배포는 소스 기반입니다. Node.js LTS가 설치된 Windows에서 BAT를 실행하면 Electron 의존성 → renderer → 앱 전용 Python/CUDA 런타임 순서로 준비됩니다.

## 개발 실행

```powershell
npm ci
npm run au
```

production renderer를 빌드한 뒤 Electron을 실행하려면:

```powershell
npm run build
npm start
```

## 생성 CLI

Electron 화면 없이 싱글·멀티 생성과 프롬프트·환경 프리셋을 사용할 수 있습니다.

```powershell
.\AnimaUtil_CLI.bat status --json
.\AnimaUtil_CLI.bat models list --json
.\AnimaUtil_CLI.bat generate single --config .\single.json --jsonl
.\AnimaUtil_CLI.bat generate multi --config .\multi.json --jsonl
```

개발 실행은 `npm run cli -- <명령>`을 사용합니다. 생성 설정의 정식 계약은
`config/cli-generation.schema.json`, 전체 명령과 예시는
[`../docs/features/CLI.md`](../docs/features/CLI.md)를 참고하세요.

## 생성 MCP

로컬 AI가 stdio MCP로 싱글·멀티 작업을 등록하고 진행 상태와 결과 경로를 조회할 수
있습니다. MCP host에는 앱 폴더의 `AnimaUtil_MCP.bat`를 등록합니다. 별도의 전역 Python,
CUDA 또는 MCP 패키지 설치는 사용하지 않으며 앱 폴더의 Node 의존성과 전용 런타임을
그대로 사용합니다.

```powershell
npm run mcp
```

### MCP host 등록

JSON 설정을 받는 MCP host에는 다음처럼 등록합니다. 마지막 BAT 경로는 실제 AnimaUtil
폴더의 절대경로로 바꿉니다.

```json
{
  "mcpServers": {
    "animautil": {
      "command": "C:\\Windows\\System32\\cmd.exe",
      "args": [
        "/d",
        "/s",
        "/c",
        "C:\\Tools\\AnimaUtil\\AnimaUtil_MCP.bat"
      ]
    }
  }
}
```

명령과 인자를 따로 입력하는 화면이라면 다음 값을 사용합니다.

- 실행 명령: `C:\Windows\System32\cmd.exe`
- 인자: `/d`, `/s`, `/c`, `C:\Tools\AnimaUtil\AnimaUtil_MCP.bat`
- 전송 방식: `stdio`
- 환경변수: 필요 없음

앱 폴더를 이동하거나 삭제하면 등록된 절대경로도 더 이상 유효하지 않습니다. 폴더를
옮겼다면 MCP host의 마지막 인자만 새 경로로 갱신합니다.

### 제공 도구

- `anima_status` — 런타임·보조 자산 준비 상태, 모델·프리셋 수, NVIDIA VRAM과 MCP 큐 상태
- `anima_models_list` — 생성 모델과 LoRA 선택에 필요한 ID·이름 최소 목록 조회
- `anima_model_unload` — MCP 연결을 유지한 채 유휴 생성 모델을 언로드해 VRAM 확보
- `anima_presets_list` — 본문 없이 Base·일반·네거티브·서브·환경 프리셋 ID·이름 목록 조회
- `anima_preset_get` — 프리셋 ID 또는 정확한 표시 이름으로 내용 조회
- `anima_generate_single` — 싱글 생성 요청을 비동기 작업으로 등록
- `anima_generate_multi` — 공통 프롬프트와 선택한 서브 슬롯을 비동기 작업으로 등록
- `anima_job_status` — `jobId`의 대기·실행·완료 상태와 출력 경로 조회
- `anima_job_wait` — 작업 종료를 서버 내부에서 기다려 반복 상태 조회와 AI 호출량 절감
- `anima_job_cancel` — 대기 또는 실행 중인 MCP 생성 요청 전체 취소

### 기본 호출 흐름

생성 도구는 완료를 기다리지 않고 즉시 `jobId`를 반환합니다. AI는 다음 순서로 호출해야
합니다.

```text
필요하면 anima_status
  -> 모델·LoRA ID를 모를 때만 anima_models_list
  -> 프리셋 ID·이름을 모를 때만 anima_presets_list
  -> 프리셋 내용을 확인할 때만 anima_preset_get
  -> anima_generate_single 또는 anima_generate_multi
  -> anima_job_wait (이미지 수에 따라 30~60초 자동 대기)
  -> 시간 초과면 anima_job_wait 재호출
  -> 작업이 끝나고 VRAM을 비울 때 anima_model_unload
  -> 필요하면 anima_job_cancel
  -> completed의 result.outputs 확인
```

이미 알고 있는 모델·LoRA ID와 정확한 프리셋 이름은 조회 없이 생성 요청에 바로 사용할 수
있습니다. 준비 상태가 불확실하거나 생성 준비 오류가 발생했을 때 `anima_status`를
호출합니다.

`anima_job_wait`는 작업이 끝나면 즉시 전체 결과를 반환하고, 자동 대기 시간이 끝난 경우에만
현재 상태와 진행률을 작은 요약으로 반환합니다. 자동 대기는 `예상 이미지 수 × 5초`를
기준으로 최소 30초, 최대 60초입니다. 예상 이미지 수는 `배치 × 큐 × 활성 서브 프롬프트`
이며 싱글 생성은 서브 프롬프트 수를 1로 계산합니다. AI는 잦은 `anima_job_status` 폴링 대신
이 도구를 우선 사용해야 합니다. `anima_job_status`는 기다리지 않고 현재 상태를 한 번
확인할 때 사용합니다. 필요하면 `timeoutSeconds`로 1~60초를 직접 지정할 수 있습니다.

`anima_model_unload`는 작업 완료 후 선택적으로 호출합니다. 모델을 계속 재사용할 예정이면
호출하지 않는 편이 다음 생성이 빠르고, 다른 GPU 작업을 위해 VRAM이 필요하면 호출해
생성 worker와 모델을 해제합니다.

완료 결과는 대화 토큰을 불필요하게 늘리지 않도록 이미지별 절대경로, Seed, 해상도,
생성 시간, 순번과 서브 프롬프트 ID·원래 슬롯 번호만 반환합니다. 요청에 이미 포함됐고
PNG 메타데이터에도 기록되는 프롬프트·네거티브 원문은 다시 반환하지 않습니다. 별도
상세 잡 응답이나 `verbose` 옵션은 제공하지 않습니다.

환경 프리셋과 서브 프롬프트 프리셋은 ID뿐 아니라 정확한 표시 이름으로도 참조할 수
있습니다. 동일 이름이 여러 개면 임의로 하나를 고르지 않고 후보 ID와 함께 오류를
반환합니다.

프리셋 목록은 ID·이름·항목 수만 반환합니다. 프롬프트·서브 프롬프트·환경 설정은
`anima_preset_get`을 명시적으로 호출했을 때만 반환하며, 정확한 프리셋 이름을 이미 알고
그대로 생성에 사용할 때는 목록과 내용 조회를 모두 생략할 수 있습니다.

```json
{
  "presets": {
    "environment": { "name": "기본 생성 환경" },
    "subPrompts": { "name": "표정 목록" }
  },
  "prompt": "1girl",
  "selectedSlots": [3]
}
```

`selectedSlots`는 one-based 번호입니다. 위 요청은 서브 프롬프트 3번만 생성하며 결과
파일에도 원래 슬롯 번호 3을 유지합니다. `subPromptOverrides`로 해당 슬롯의 프롬프트나
LoRA를 추가 변경할 수 있지만 `selectedSlots`와 `subPromptOverrides.enabled`는 함께
사용할 수 없습니다.

### 운영 제한

- 같은 MCP 서버 안의 작업은 FIFO로 한 개씩 실행하고 Python worker와 모델을 재사용합니다.
- `anima_model_unload`는 대기·실행 작업이 없을 때 생성 worker를 종료해 VRAM을 해제합니다.
  MCP 서버와 작업 기록은 유지되며 다음 생성 요청에서 worker와 모델을 자동으로 다시
  준비합니다. 이미 언로드된 상태에서 다시 호출해도 안전합니다.
- `anima_status`의 큐 정보는 현재 MCP 서버가 소유한 작업만 나타냅니다.
- GPU·VRAM 정보는 장치 상태를 보여주지만 다른 GUI·CLI 프로세스를 잠그거나 소유자를
  판별하지 않습니다. AnimaUtil GUI나 별도 CLI에서 동시에 생성하지 마세요.
- MCP 서버가 종료되면 대기 작업은 취소되고 실행 중 worker도 종료됩니다. 이미 저장된
  PNG는 삭제하지 않습니다.
- 자동검열, 리파인, 프리셋 편집·삭제와 모델 다운로드는 현재 MCP 범위가 아닙니다.

CLI 생성은 명령 하나가 끝나면 해당 CLI 프로세스와 생성 모델도 함께 종료되므로 별도
언로드 명령이 필요하지 않습니다. 장시간 살아 있는 MCP 프로세스의 VRAM을 비울 때는
`anima_model_unload`를 사용합니다.

개발 워크스페이스를 함께 받은 경우 전체 계약과 추가 예시는
[`../docs/features/MCP.md`](../docs/features/MCP.md)를 참고하세요.

## 폴더 구조

- `app/` — Python 추론·모델 진단·자동검열 worker
- `cli/` — 싱글·멀티 생성과 프롬프트·환경 프리셋용 headless 명령 adapter
- `mcp/` — AI용 stdio 생성 adapter와 비동기 작업 관리자
- `config/` — JavaScript·Electron·Python 공통 생성 설정 계약
- `locales/` — 기본 한국어·영어와 사용자가 추가하는 UI 번역 JSON
- `electron/` — Electron main, preload, IPC 서비스
- `src/` — React renderer
- `scripts/` — 개발 실행과 런타임 준비
- `tests/` — Node와 Python 회귀 테스트
- `runtime/` — 앱 전용 Python/CUDA 런타임
- `Models/` — 사용자 모델, LoRA와 보조 자산
- `Presets/` — 사용자 프롬프트·생성 환경 프리셋
- `outputs/` — 생성 이미지와 자동검열 결과

`runtime/`, `Models/`, `Presets/`, `outputs/`는 앱 폴더를 옮겨도 함께 따라가는 로컬 자산입니다. 시스템에 설치된 Python이나 CUDA Toolkit, 사용자 `PATH`는 추론 worker 선택에 관여하지 않습니다. AnimaTail 런타임은 PyTorch와 DiffSynth 생성 의존성만 소유하며 ONNX Runtime은 CensorTail이 소유합니다.

## 런타임 설치

앱 루트의 `runtime-manifest.json`이 공개 배포용 런타임 계약입니다. 최초 실행 시 런타임이 없으면 설정 화면으로 이동해 설치가 자동으로 시작됩니다. 설치 중 취소할 수 있고, 실패하면 같은 화면에서 재시도하면 됩니다.

저장소에는 조립된 Python/CUDA 런타임을 싣지 않습니다. 대신 manifest에 고정된 공개 원본에서 Python standalone, `uv`, DiffSynth 소스를 받아 고정 버전 PyTorch CUDA 12.8과 Python 패키지를 `runtime/versions/<runtimeId>/`에 직접 설치합니다. 공개 원본 파일과 설치 후 핵심 파일은 크기와 SHA-256을 검증하고, CUDA·BF16·DiffSynth 점검까지 통과한 staging 디렉터리만 원자적으로 활성화합니다.

시스템 Python으로 폴백하거나 시스템 CUDA 환경 변수를 사용하는 일은 없습니다. DiffSynth는 Windows의 긴 wheel 빌드 경로를 만들지 않도록 검증된 commit의 순수 Python 패키지를 직접 설치합니다. 실패한 설치의 앱 내부 패키지 캐시는 재시도에 재사용하고, 설치가 성공하면 정리합니다. 개발 PC 전용 경로가 필요하면 Git에서 제외되는 `runtime-manifest.local.json`으로 덮어쓸 수 있습니다.

## 모델과 보조 자산

처음 실행한 뒤 `설정 > 모델`에서 생성에 필요한 필수 보조 자산과, 선택 항목인 자동검열 모델을 내려받을 수 있습니다. 파일은 고정된 원본 revision에서 직접 받아 `Models/`의 지정 경로에 저장되며, 크기와 SHA-256 검증을 통과해야 준비 상태가 됩니다. 사용자 diffusion model과 LoRA는 자동으로 다운로드하지 않습니다 — 직접 넣어 쓰는 자산입니다.

모델 호환성 검사를 실행하면 결과가 `Models/diagnostics/compatibility.json`에 저장됩니다. 다음 실행에서 마지막 검사 결과를 자동 복원하고, 검사 버튼을 다시 누르면 현재 모델 구성 기준으로 갱신됩니다.

## 표시 언어

설정에서 한국어와 영어 중 선택할 수 있습니다. `locales/`에 계약에 맞는 UTF-8 JSON 파일을 추가하면 다음 실행부터 해당 언어가 드롭다운에 나타납니다. 자세한 형식은 [`locales/README.md`](locales/README.md)를 참고하세요.
