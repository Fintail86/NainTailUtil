# 생성 MCP 서버

- 기준일: 2026-08-08
- 상태: 생성 및 discovery 도구 구현
- 전송 방식: 로컬 stdio
- 공식 SDK: `@modelcontextprotocol/server` 2.0.0

AnimaUtil MCP 서버는 Electron 화면을 조작하거나 CLI 프로세스를 다시 실행하지 않는다.
CLI와 같은 `GenerationApplication`과 Python worker를 사용하는 세 번째 입력 adapter다.

```text
React GUI ─┐
CLI ───────┼─> GenerationApplication ─> JobQueue ─> Python/CUDA worker
MCP stdio ─┘
```

## 실행과 MCP host 등록

프로젝트의 로컬 의존성이 준비된 개발 환경에서는 다음 명령으로 서버를 실행한다.

```powershell
npm run mcp
```

일반 사용자는 MCP host가 `AnimaUtil_MCP.bat`를 실행하도록 등록한다. Windows에서 BAT를
직접 실행하지 못하는 host는 `cmd.exe`를 사용한다.

```json
{
  "mcpServers": {
    "animautil": {
      "command": "C:\\Windows\\System32\\cmd.exe",
      "args": [
        "/d",
        "/s",
        "/c",
        "C:\\Path\\To\\AnimaTail\\AnimaTail_MCP.bat"
      ]
    }
  }
}
```

다른 PC에서는 마지막 경로만 실제 앱 폴더의 절대경로로 바꾼다. stdio의 stdout은 MCP
프로토콜 전용이며 시작 안내와 worker 로그는 stderr로만 출력한다. 서버를 더블클릭해
검은 창에서 대기하는 것은 사용 흐름이 아니며 MCP host가 자식 프로세스로 실행해야 한다.

## 제공 도구

### `anima_status`

앱 전용 런타임과 필수 보조 자산, 모델·LoRA·프리셋 개수 및 실제 생성 가능 상태를
반환한다. NVIDIA GPU 이름과 VRAM 총량·사용량·여유량, 현재 MCP 활성 작업과 대기
깊이·수용 한도도 포함한다. 이 GPU 정보는 장치 상태이며 별도 GUI·CLI 작업의 소유자를
식별하거나 실행을 잠그지는 않는다. 앱의 절대경로는 노출하지 않는다.

### `anima_models_list`

사용 가능한 diffusion model은 catalog ID와 표시 이름만, LoRA는 ID·표시 이름·`turbo`
판정만 반환한다. 상대경로·파일명·크기·수정 시각과 실제 절대경로는 목록에 포함하지
않는다. 생성 요청의 `modelId`와 `loras[].id`는 이 결과에서 선택한다. 환경 프리셋을
사용하거나 ID를 이미 알고 있다면 이 호출을 생략한다.

### `anima_model_unload`

MCP 서버를 종료하지 않고 현재 생성 Python worker를 종료해 생성 모델이 사용하던 VRAM을
해제한다. 대기 중이거나 실행 중인 생성 작업이 있으면 `MCP_MODEL_BUSY`로 거부하며 기존
작업을 임의로 취소하지 않는다. 유휴 상태에서는 이미 언로드된 경우에도 안전하게 호출할
수 있다. 응답의 `released`는 호출 직전에 실제 생성 모델이 로드돼 있었는지를 나타낸다.

언로드 뒤에도 MCP 연결, 완료 작업 기록과 대기열 관리자는 유지된다. 다음 생성 요청은
새 Python worker를 시작하고 필요한 모델을 자동으로 다시 로드하므로 첫 생성 시간이 다시
발생한다. `anima_status`의 `queue.modelLoaded`로 현재 MCP 생성 모델 보유 여부를 확인할 수
있다.

### `anima_presets_list`

`base`, `prompts`, `negativePrompts`, `subPrompts`, `environments` 중 category를 지정해
목록을 읽거나 생략해 모든 프리셋을 조회한다. 목록 항목은 ID·이름·항목 수만 반환하며
프롬프트 미리보기, 본문, 서브 프롬프트, 환경 설정은 포함하지 않는다. 실제 내용은
`anima_preset_get`을 명시적으로 호출했을 때만 반환한다. 생성 도구의 `presets` 참조에는
기존 ID 또는 `{ "name": "표시 이름" }`을 사용할 수 있다. 정확한 이름을 알고 그대로
사용할 때는 목록과 내용 조회를 모두 생략할 수 있다. 이름이 중복되면 후보 ID를 포함한
명시적 오류를 반환한다.

### `anima_preset_get`

category와 `id` 또는 `name` 중 하나로 프롬프트 본문, 순서가 있는 서브 프롬프트 목록
또는 환경 설정을 읽는다. 손상·부재·중복 이름은 기계 판독 가능한 오류로 반환한다.

### `anima_generate_single`

싱글 생성 설정을 검증해 대기열에 등록하고 즉시 `jobId`를 반환한다. 입력 필드는 CLI
schema v1에서 `schemaVersion`과 `mode`를 뺀 것과 같다. 도구 이름이 두 값을 결정한다.
`presets.environment`를 지정하면 환경 프리셋의 모델·LoRA·생성 설정을 사용하므로
`modelId`를 생략할 수 있다. 같은 필드를 직접 지정하면 직접 입력이 우선한다.

```json
{
  "modelId": "diffusion_models:oneObsessionAnima_v20.safetensors",
  "prompt": "1girl, blue hair",
  "loras": [
    {
      "id": "loras:turbo/Turbo-ANIMA-v2.9.safetensors",
      "strength": 1
    }
  ],
  "width": 768,
  "height": 1024,
  "steps": 10,
  "cfg": 1,
  "sampler": "er_sde",
  "scheduler": "simple",
  "randomSeed": false,
  "seed": 1234
}
```

### `anima_generate_multi`

공통 프롬프트와 활성 서브 프롬프트를 하나의 비동기 작업으로 등록한다. 프리셋 참조,
서브별 LoRA, 비활성 슬롯과 원래 슬롯 번호는 CLI와 같은 규칙을 사용한다. `selectedSlots`
를 지정하면 나머지를 일일이 비활성화하지 않고 출력할 one-based 슬롯만 선언할 수 있다.

```json
{
  "modelId": "diffusion_models:oneObsessionAnima_v20.safetensors",
  "prompt": "1girl",
  "outputPrefix": "au",
  "outputSubPrefix": "hair",
  "subPrompts": [
    { "id": "red", "prompt": "red hair", "enabled": true },
    { "id": "skip", "prompt": "blue hair", "enabled": false },
    { "id": "green", "prompt": "green hair", "enabled": true }
  ]
}
```

저장된 서브 프롬프트 프리셋에서 3번 슬롯만 출력하는 요청은 다음과 같다. 슬롯별
프롬프트나 LoRA를 함께 바꿀 수 있지만 `selectedSlots`와 `subPromptOverrides.enabled`를
동시에 지정하면 선택 의미가 충돌하므로 오류다.

```json
{
  "presets": {
    "environment": { "name": "기본 생성 환경" },
    "subPrompts": { "name": "표정 목록" }
  },
  "selectedSlots": [3]
}
```

### `anima_job_status`

생성 도구가 반환한 `jobId`로 다음 상태를 조회한다.

```text
queued -> running -> completed | partial | failed | cancelled
```

진행 중에는 phase, 현재 step과 totalSteps를 반환한다. 완료되면 이미지별 안전하게
계산한 절대경로, Seed, 해상도, 생성 시간, 결과 순번, 서브 프롬프트 ID와 원래 슬롯
번호만 반환한다. 상대경로·파일명과 프롬프트·네거티브 원문은 요청 및 PNG 메타데이터와
중복되므로 반환하지 않는다.

상세 잡 응답이나 `verbose` 옵션은 제공하지 않는다. 향후 상세 확인이 필요해지면 전체
잡 결과를 부풀리지 않고 선택한 PNG 한 장의 메타데이터를 필요할 때만 읽는 별도 계약으로
설계한다.

### `anima_job_wait`

생성 도구가 반환한 `jobId`의 작업이 terminal 상태가 될 때까지 MCP 서버 내부에서
기다린다. `timeoutSeconds`를 생략하면 다음 식으로 대기 시간을 자동 결정한다.

```text
예상 이미지 수 = batchSize × queueCount × 활성 서브 프롬프트 수
자동 대기 시간 = clamp(예상 이미지 수 × 5초, 30초, 60초)
```

싱글 생성 또는 서브 프롬프트가 없는 멀티 생성은 활성 서브 프롬프트 수를 1로 계산한다.
예를 들어 1~6장은 30초, 8장은 40초, 12장 이상은 60초를 기다린다. 호출자가
`timeoutSeconds`로 1~60초를 직접 지정하면 자동값보다 우선한다.

- 대기 중 작업이 끝나면 즉시 전체 작업 결과와 `wait.timedOut=false`를 반환한다.
- 시간이 먼저 끝나면 `result`와 `error`를 반복하지 않고 상태·진행률만 담은 작은 요약과
  `wait.timedOut=true`를 반환한다. 이 경우 같은 도구를 다시 호출한다.
- 이미 종료된 작업은 기다리지 않고 즉시 전체 결과를 반환한다.

일반 AI 호출에서는 이 도구를 우선 사용한다. `anima_job_status`는 사용자 요청에 따라
현재 상태를 즉시 한 번 확인해야 할 때만 사용한다. 이 구조는 GPU 작업 방식에는 영향을
주지 않으며, 짧은 주기의 상태 폴링으로 생기는 반복 AI 추론과 도구 결과 토큰을 줄인다.
terminal 상태의 결과도 `anima_job_status`와 같은 슬림 출력 형식을 사용한다.

### `anima_job_cancel`

생성 도구가 반환한 `jobId`로 MCP 생성 요청 전체를 취소한다. 대기 작업은 즉시
`cancelled`가 되고, 실행 작업은 내부 반복 큐와 현재 worker 작업에 취소를 요청한다.
이미 종료된 작업과 존재하지 않는 작업은 서로 다른 오류 코드로 반환한다. 생성된 PNG는
삭제하지 않는다.

## 수명주기와 제한

- 생성 도구는 즉시 `jobId`를 반환한다. AI는 짧은 주기의 `anima_job_status` 폴링 대신
  `anima_job_wait`의 이미지 수 기반 30~60초 자동 대기를 사용한다.
- MCP 서버 안에서는 작업을 한 개씩 FIFO로 실행한다. 같은 세션의 다음 작업은 살아 있는
  Python worker와 모델을 재사용할 수 있다.
- `anima_model_unload`는 대기·실행 작업이 없는 경우에만 생성 worker를 종료한다. MCP
  연결과 완료 작업 기록은 유지하며 다음 생성에서 worker와 모델을 자동으로 다시 준비한다.
- GUI나 별도 CLI 프로세스와 GPU 큐를 공유하지 않는다. 같은 GPU에서 동시에 추론하지
  않는 것은 현재 호출자 책임이다.
- 활성 MCP 작업은 최대 20개, 전체 기록은 최근 완료 항목을 포함해 최대 100개다.
- 서버 종료 시 대기 작업을 취소하고 실행 중 worker를 종료한다. 이미 저장된 PNG는
  삭제하지 않는다.
- 자동검열, 리파인, 프리셋 편집·삭제, 모델 다운로드와 갤러리 조작은 현재 MCP 범위가 아니다.

## 권장 호출 순서

```text
필요하면 anima_status
  -> 모델·LoRA ID를 모를 때만 anima_models_list
  -> 프리셋 ID·이름을 모를 때만 anima_presets_list
  -> 프리셋 내용을 확인할 때만 anima_preset_get
  -> anima_generate_single 또는 anima_generate_multi
  -> jobId 보관
  -> 필요하면 anima_job_cancel
  -> 아니면 anima_job_wait
  -> wait.timedOut=true이면 anima_job_wait 재호출
  -> terminal 상태에서 result.outputs 확인
  -> VRAM을 비울 필요가 있을 때 anima_model_unload
```

이미 알고 있는 모델·LoRA ID와 정확한 프리셋 이름은 조회 없이 생성 요청에 바로 사용할 수
있다. 준비 상태가 불확실하거나 생성 준비 오류가 발생했을 때 `anima_status`를 호출한다.
