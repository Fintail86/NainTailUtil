# NaiTail MCP 호출 가이드

NaiTail의 애드온 ID는 `naitail`이다. 싱글·멀티에서는 프리셋 **이름만 참조 필드에 전달**한다.
프로그램이 저장된 본문을 읽고 합성하므로, 생성할 때마다 `preset_get`으로 Prompt·UC를 가져와
복사할 필요가 없다. 아래 프리셋·의상 이름은 예시이며 사용자 저장소에 실제로 있어야 한다.

## 연결과 도구 선택

Hosted 연결은 제품 루트 `NainTailUtil_MCP.bat`, 독립 연결은 `NaiTail_MCP.bat`를 사용한다.
등록·자격증명·비용 승인은 [공통 MCP 문서](../../MCP.md)를 따른다.

Hosted 호출 순서:

1. `naintail_addon_get({"addonId":"naitail"})`로 애드온을 확인한다.
2. 도구명을 모르면 `naintail_addon_tools_list`, 사용할 도구의 인자는 `naintail_addon_tool_get`으로 확인한다.
3. `naintail_addon_call`에 `addonId`, `toolName`, `arguments`를 전달한다.

독립 연결에서는 `naintail_generate_multi` 같은 도구에 아래 예시의 `arguments`를 직접 전달한다.
준비 상태를 모르면 `naintail_status`를 조회한다. 코드 업데이트 후에도 실행 중인 MCP는 이전 코드와
도구 설명을 유지하므로 MCP 연결을 재시작해야 한다. GUI를 다시 여는 것만으로 MCP가 갱신되지는 않는다.

## 프리셋 탐색

- `naintail_presets_list({"type":"character"})`: 이름·타입·항목 수와 `outfits` 의상 이름 배열.
- 타입은 `example`, `character`, `sub-slot`이며 생략하면 전체 목록이다.
- 이름과 필요한 의상을 이미 알면 목록 조회도 생략한다.
- 본문을 검토할 때만 `naintail_preset_get({"type":"example","name":"SP-1"})`을 호출한다.
- 프리셋은 종류별 폴더의 `프리셋 이름.json`에 저장된다. 같은 타입 안에서는 이름이 고유하다.
- `presetId`는 기존 조회 클라이언트의 호환용이며 새 호출은 타입·이름을 쓴다.

## 싱글: 작례 + 캐릭터 + 의상

`naintail_addon_call` 인자:

```json
{
  "addonId": "naitail",
  "toolName": "naintail_generate_single",
  "arguments": {
    "request": {
      "prompt": "1girl",
      "examplePreset": "SP-1",
      "characters": [{ "preset": "테스트 캐릭터", "outfit": "근무복" }],
      "settings": {
        "model": "nai-diffusion-5-full",
        "width": 832,
        "height": 1216,
        "steps": 28,
        "guidance": 5
      }
    }
  }
}
```

`prompt`와 `negativePrompt`는 직접 추가할 공통 Prompt·UC다. 작례의 Prompt·UC는 프로그램이
공통 입력 앞에 합성한다. 캐릭터는 저장된 베이스 + 선택 의상으로 합성하며 캐릭터의 직접
`prompt`·`negativePrompt`도 프리셋 내용 뒤에 추가할 수 있다. 참조만 사용하면 원본 내용을
모델이 재작성할 필요가 없다. 지원 모델의 활성 캐릭터 상한은 V5 22명, V4.5 6명이다.

| 입력 | 의미 |
|---|---|
| `examplePreset`, 캐릭터 `preset`, `slotPreset` 생략·`null`·`""` | 해당 프리셋 미사용, 직접 입력 유지 |
| `outfit` 생략 | 캐릭터 프리셋에 저장된 의상 선택 유지 |
| `outfit: "근무복"` | 의상 목록에서 해당 이름 1종 선택 |
| `outfit: null` | 의상 선택 해제. 목록이 있으면 `undressed, nude` 자동 추가 |
| `outfits: []` | 의상 목록을 비워 자동 태그 비활성화 |

**`preset: null`과 `outfit: null`은 의미가 다르다.** `outfit`에는 유효한 의상 이름 또는 `null`을
지정하며 빈 문자열은 허용하지 않는다. `outfit`과 `selectedOutfitId`를 동시에 전달하지 않는다.
없는 프리셋·의상 이름은 오류로 반환되며 임의로 무시하지 않는다.

타입은 참조 필드로 구분한다. `[작례 프리셋:SP-1]` 같은 문자열은 참조 필드에서 호환용으로만
지원한다. **일반 `prompt` 안의 대괄호 표기를 파싱하는 기능은 없다.**

## 멀티: 감정 서브슬롯

```json
{
  "addonId": "naitail",
  "toolName": "naintail_generate_multi",
  "arguments": {
    "request": {
      "prompt": "1girl",
      "examplePreset": "SP-1",
      "characters": [{ "preset": "테스트 캐릭터", "outfit": "근무복" }],
      "slotPreset": "감정",
      "settings": {
        "model": "nai-diffusion-5-full",
        "width": 832,
        "height": 1216,
        "steps": 28,
        "guidance": 5,
        "seed": 284193607,
        "includeMetadata": true
      }
    }
  }
}
```

`감정`에 항목이 2개라면 기본 반복 수에서 2장을 생성한다. 각 슬롯에는 동일한 공통 캐릭터와
선택 의상이 적용된다. 근무복·의상 2·의상 없음과 감정 2개를 비교하려면 위 요청의 `outfit`을
`"근무복"`, `"의상 2"`, `null`로 바꿔 3번 호출한다. 총 6장이며 의상 조합을 자동으로 펼치는
옵션은 아니다. 프리셋 파일 자체는 바뀌지 않는다.

- `slotPreset: "감정"` 또는 `slotPresets: ["감정", "포즈"]` 중 하나를 쓴다.
- 여러 묶음은 슬롯 목록을 순서대로 이어 붙이며 서로 곱하지 않는다.
- 직접 `slots`도 전달하면 프리셋에서 펼친 슬롯 뒤에 추가된다. 합계 최대 20개다.
- 빈 슬롯 프리셋은 오류다. 참조 없이 `slots: []`이면 기존처럼 공통 입력으로 1장 생성한다.
- `slotPresets: []`는 프리셋 미사용이다. 반복 옵션을 지정하면 최종 생성 수가 늘어난다.
- 생성 등록 시 비용 계산 전에 이름을 해석하고 같은 스냅샷을 큐에 넣는다. 이후 프리셋 수정이
  이미 등록한 작업의 내용을 바꾸지 않는다.

## 프리셋 없이 생성

`naintail_generate_single`의 `arguments` 예시다. 참조 필드는 모두 선택 사항이다.

```json
{
  "request": {
    "prompt": "1girl, garden",
    "negativePrompt": "blurry",
    "characters": [{ "prompt": "adult woman, black hair, blue dress" }],
    "settings": { "model": "nai-diffusion-5-full", "width": 832, "height": 1216 }
  }
}
```

## 비용 확인과 결과 수신

생성 첫 호출에서는 `allowPaidAnlas`와 `maxAnlas`를 생략한다. 무료 예상이면 즉시 등록된다.
`ANLAS_CONFIRMATION_REQUIRED`이면 예상액을 확인하고 사용자 승인 후 같은 `arguments`에
`allowPaidAnlas: true`, `maxAnlas: 승인한도`를 추가한다. 예시 해상도라도 구독·한도·참조 이미지에
따라 비용이 달라질 수 있으므로 무료라고 가정하지 않는다.

등록 결과의 `jobId`를 보관하고 `naintail_job_wait({"jobId":"반환된 jobId","timeoutSeconds":30})`로
기다린다. `wait.timedOut: true`면 같은 도구로 다시 대기한다. `job_status`는 즉시 확인할 때,
`jobs_list`는 ID를 잃었을 때 사용한다. `completed`와 `outputs`·`errors`를 확인한 뒤 결과를 보고한다.
`partial`, `failed`, `cancelled`를 전체 성공으로 보고하지 않는다.

Hosted 출력은 `NainTailUtil/outputs/naitail/`, 독립 출력은 `NaiTail/outputs/`에 저장된다.
파일은 완료 응답의 `outputs[].absolutePath`로 확인한다. `includeMetadata: true`이면 PNG에
적용된 요청 스냅샷이 남으므로 의상·슬롯·설정을 검증할 수 있다.

이름 참조가 줄이는 것은 MCP의 프리셋 본문 조회와 요청 내 반복 텍스트다. NAI로 전송되는
최종 프롬프트나 Anlas 비용을 줄이는 기능은 아니다. 자세한 저장·합성 규칙은
[프리셋 참조 계약](PRESET_REFERENCES.md)을 따른다.
