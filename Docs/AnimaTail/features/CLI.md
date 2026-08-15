# 생성 CLI

- 기준일: 2026-08-04
- 상태: 싱글·멀티 생성, 프롬프트·환경 프리셋과 생성 전 조회 명령 구현
- 입력 schema: `AnimaUtil/config/cli-generation.schema.json` version 1

AnimaUtil CLI는 React 화면을 자동 조작하지 않는다. GUI와 같은 생성 요청 정규화,
모델·LoRA catalog, 프리셋 서비스, FIFO 큐와 Python worker를 사용하는 별도 입력
adapter다. 한 CLI 생성 명령이 끝나면 worker도 종료하므로 GUI 큐와 모델 메모리를
공유하지 않는다.

## 실행

앱 실행 프로젝트에서 다음 BAT를 사용한다.

```powershell
.\AnimaUtil_CLI.bat capabilities --json
```

BAT는 자신의 위치를 앱 루트로 사용하고 `node_modules/electron`의 로컬 실행 파일을
Node 모드로 실행한다. 로컬 의존성이 없으면 `START_ANIMAUTIL.bat`과 같은 잠금 파일로
최초 설치를 수행한다. 개발 중에는 다음 명령도 같은 CLI 진입점을 사용한다.

```powershell
npm run cli -- capabilities --json
```

## 조회 명령

```powershell
.\AnimaUtil_CLI.bat status --json
.\AnimaUtil_CLI.bat models list --json
.\AnimaUtil_CLI.bat presets list --json
.\AnimaUtil_CLI.bat presets list --category subPrompts --json
.\AnimaUtil_CLI.bat presets get --category base --id <preset-id> --json
```

- `status`: 앱 루트, 런타임, 필수 보조 자산, 모델과 프리셋 개수 및 생성 가능 상태
- `models list`: 절대경로를 제외한 diffusion model과 LoRA catalog ID
- `presets list/get`: 다섯 category의 프리셋 ID와 schema v1 내용
- `capabilities`: 명령, category, 샘플러·스케줄러와 수치 제한

자동화에서는 파일명이나 표시 이름이 아니라 `models list`가 반환한 catalog ID와
`presets list`가 반환한 `category + id`를 사용한다. 생성 설정의 프리셋 참조는 기존 ID
문자열 또는 `{ "name": "표시 이름" }`을 받을 수 있다. 표시 이름이 중복되면 후보 ID를
포함한 오류를 반환하며 임의로 하나를 선택하지 않는다.

## 프리셋 저장

새 Base 프리셋 설정 파일 예시:

```json
{
  "schemaVersion": 1,
  "category": "base",
  "name": "Quality",
  "content": "masterpiece, best quality"
}
```

```powershell
.\AnimaUtil_CLI.bat presets save --config .\base-preset.json --json
```

서브 프롬프트 리스트는 `items`를 사용한다.

```json
{
  "schemaVersion": 1,
  "category": "subPrompts",
  "name": "Expressions",
  "items": [
    { "prompt": "smiling", "negativePrompt": "sad" },
    { "prompt": "angry", "negativePrompt": "smiling" }
  ]
}
```

기존 항목은 ID와 명시적 덮어쓰기 옵션을 함께 지정해야 한다.

```powershell
.\AnimaUtil_CLI.bat presets save `
  --config .\base-preset.json `
  --id <preset-id> `
  --overwrite `
  --json
```

프리셋 삭제는 1차 CLI 범위에 포함하지 않는다. GUI의 Windows 휴지통 동작과 동일한
복구 경계를 headless 환경에서 보장하기 전까지 AI가 사용자 프리셋을 삭제하지 않는다.

환경 프리셋은 `category: "environments"`와 `settings` 객체를 사용한다. 생성 설정에서
`presets.environment`로 ID를 지정하면 `modelId`를 생략할 수 있다. 같은 환경 프리셋을
싱글과 멀티 양쪽에서 사용할 수 있으며 멀티 전용 SubPrefix와 LoRA 교체 방식은 별도로
지정한다.

```json
{
  "schemaVersion": 1,
  "mode": "single",
  "presets": { "environment": { "name": "기본 생성 환경" } },
  "prompt": "1girl"
}
```

## 싱글 생성

```json
{
  "schemaVersion": 1,
  "requestId": "example-single",
  "mode": "single",
  "presets": {
    "base": "base-preset-id",
    "negativePrompt": "negative-preset-id"
  },
  "prompt": "1girl, blue hair",
  "modelId": "diffusion_models:example.safetensors",
  "loras": [
    { "id": "loras:turbo/example.safetensors", "strength": 1 }
  ],
  "outputPrefix": "au",
  "width": 1024,
  "height": 1024,
  "steps": 10,
  "cfg": 1,
  "sampler": "er_sde",
  "scheduler": "simple",
  "batchSize": 1,
  "queueCount": 1,
  "randomSeed": true,
  "seed": 0
}
```

```powershell
.\AnimaUtil_CLI.bat generate single --config .\single.json --jsonl
```

생략한 생성 수치는 GUI 기본값과 같은 1024×1024, 10 steps, CFG 1,
`er_sde · simple`, batch 1, queue 1, random Seed를 사용한다. `modelId`와 합친
Base/일반 프롬프트 중 하나 이상은 필수다.

## 멀티 생성

멀티 설정은 서브 프롬프트를 직접 쓰거나 `presets.subPrompts`로 불러올 수 있다.

```json
{
  "schemaVersion": 1,
  "requestId": "example-multi",
  "mode": "multi",
  "basePrompt": "masterpiece, best quality",
  "prompt": "1girl, blue hair",
  "modelId": "diffusion_models:example.safetensors",
  "loras": [],
  "loraLoadMode": "fused",
  "outputPrefix": "au",
  "outputSubPrefix": "character-a",
  "subPrompts": [
    {
      "id": "happy",
      "prompt": "smiling, classroom",
      "negativePrompt": "sad",
      "enabled": true,
      "loras": []
    },
    {
      "id": "skip",
      "prompt": "angry",
      "enabled": false,
      "loras": []
    },
    {
      "id": "calm",
      "prompt": "calm expression, night city",
      "enabled": true,
      "loras": []
    }
  ],
  "batchSize": 2,
  "queueCount": 1,
  "randomSeed": false,
  "seed": 1000
}
```

```powershell
.\AnimaUtil_CLI.bat generate multi --config .\multi.json --jsonl
```

비활성 항목은 생성하지 않지만 원래 슬롯 번호를 보존한다. 위 예시는 슬롯 1과 3만
출력하며 현재 GUI와 같은 멀티 작업 폴더 및
`{prefix}_{subPrefix}_{slot}_{num}.png` 규칙을 사용한다.

서브 프롬프트 프리셋에는 현재 prompt, negativePrompt와 순서만 저장된다. 프리셋을
실행할 때 특정 슬롯을 비활성화하거나 LoRA를 더하려면 `subPromptOverrides`를 사용한다.

```json
{
  "presets": { "subPrompts": "expression-preset-id" },
  "subPromptOverrides": [
    { "slot": 2, "enabled": false },
    {
      "slot": 3,
      "loras": [
        { "id": "loras:characters/example.safetensors", "strength": 1.2 }
      ]
    }
  ]
}
```

특정 슬롯만 출력하려면 `selectedSlots`가 더 간단하다. one-based 슬롯 번호와 출력 파일의
원래 슬롯 번호가 일치한다.

```json
{
  "presets": { "subPrompts": { "name": "표정 목록" } },
  "selectedSlots": [3]
}
```

`selectedSlots`와 `subPromptOverrides[].enabled`는 함께 사용할 수 없다. 프롬프트·LoRA
override는 `selectedSlots`와 함께 사용할 수 있다.

존재하지 않는 슬롯과 중복 override는 입력 오류다. 출력 대상이 하나도 없으면 기존
GUI와 마찬가지로 생성을 거부한다.

## 프리셋과 직접 입력의 우선순위

```text
기본값
  < 환경·프롬프트 프리셋
  < config의 직접 모델/LoRA/생성 수치와 basePrompt/prompt/negativePrompt/subPrompts
  < promptOverrides/subPromptOverrides/selectedSlots
```

빈 문자열도 명시적인 override다. 프리셋 ID나 category가 잘못됐을 때 프리셋을
생략하고 계속하지 않고 전체 요청을 실패시킨다.

## 출력 형식

- `--json`: 진행 이벤트 없이 최종 객체 하나를 stdout에 출력
- `--jsonl`: 이벤트마다 압축된 JSON 객체 한 줄을 stdout에 출력
- worker 경고와 사람용 로그: stderr

JSONL 이벤트는 `ready`, `validated`, `queued`, `loading`, `progress`, `image`,
`completed`, `cancelled`, `error`다. 각 객체는 `schemaVersion`, `event`,
`requestId`, `timestamp`, `data`를 가진다. `image`와 최종 결과에는 앱 기준 상대 출력
경로와 실제 Seed가 포함된다.

| 종료 코드 | 의미 |
|---:|---|
| `0` | 전체 완료 또는 읽기 명령 성공 |
| `2` | 명령 인자·JSON·생성 설정 오류 |
| `3` | 런타임·보조 자산·모델·LoRA·프리셋 누락 |
| `4` | worker 또는 전체 생성 실패 |
| `5` | 일부 이미지 생성 후 나머지 작업 실패 |
| `130` | `Ctrl+C` 또는 상위 프로세스 취소 |

`Ctrl+C`는 남은 CLI 큐와 실행 중인 worker를 중단한다. 이미 저장된 PNG는 삭제하지
않는다.

## 현재 경계

- 각 CLI 호출은 독립적이며 호출 사이에 모델을 상주시켜 재사용하지 않는다.
- 한 멀티 호출 안에서는 같은 worker와 모델을 유지한다.
- CLI와 실행 중인 GUI는 큐를 공유하지 않는다. GPU 추론을 동시에 실행하지 않는 것은
  호출자 책임이다.
- 자동검열, 리파인, 갤러리 조작, 런타임·자산 다운로드와 프리셋 삭제는 지원하지 않는다.
