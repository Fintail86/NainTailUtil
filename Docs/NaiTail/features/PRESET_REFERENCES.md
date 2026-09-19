# 이름 기반 프리셋 저장과 생성 참조

프리셋의 공개 식별자는 **타입 + 이름**이다. 파일명은 이름 그대로 `.json`을 붙인다.

| 타입 | 파일 예시 | 권장 생성 입력 |
|---|---|---|
| 작례 `example` | `Presets/examples/SP-1.json` | `examplePreset: "SP-1"` |
| 캐릭터 `character` | `Presets/characters/테스트 캐릭터.json` | `characters[].preset: "테스트 캐릭터"` |
| 서브슬롯 `sub-slot` | `Presets/sub-slots/감정.json` | `slotPreset: "감정"` |

같은 타입 안에서 이름은 고유하며 대소문자를 구분하지 않고 중복 검사한다. 이름은 NFC 정규화와
양끝 공백 제거 후 사용한다. Windows 금지 문자, 예약 이름, 끝 마침표, 80자 초과 이름은 거부한다.
다른 타입은 같은 이름을 쓸 수 있다. 중복 신규 저장·이름 변경으로 다른 파일을 덮어쓰지 않는다.
기존 ID는 저장 편집과 과거 클라이언트 호환용으로 보존하지만 파일명·MCP 목록의 식별자로 쓰지 않는다.

기존 `이름_UUID끝8자리.json` 파일은 저장소 초기화 때 충돌을 전체 검사하고 원본을
`Presets/.name-migration-backup/`에 복사한 뒤 이름 기반 파일로 이전한다. 이름 충돌은 원본 변경 전에
오류로 보고하며 임의 덮어쓰기나 숫자 접미사 추가를 하지 않는다. 이후에는 파일명의 `.json` 앞부분이
조회 이름이다. 사용자가 파일명만 바꿔도 목록·조회에는 새 이름이 적용된다.
이전 충돌 시 프리셋 저장·삭제는 차단하고 중복 이름 조회는 오류로 반환한다. 프리셋을 참조하지 않는
직접 생성과 다른 라이브러리는 계속 사용할 수 있다. 충돌 파일을 정리한 뒤 다시 시작하면 이전을 재시도한다.

## 조회

MCP `naintail_presets_list`는 `name`, `type`, `itemCount`와 캐릭터의 `outfits` 이름 배열만 반환한다.
프롬프트는 포함하지 않는다. 생성만 할 때는 `get`으로 본문을 읽지 않고 이름 참조를 보낸다.
본문을 확인할 때는 `naintail_preset_get`에 `{"type":"example","name":"SP-1"}`을 전달한다.
기존 `presetId` 조회도 호환용으로 지원한다.

CLI도 `presets get --type example --name SP-1`, `presets delete --type character --name "테스트 캐릭터"`를 지원한다.
CLI `presets list`는 이름 기준 목록을 반환한다. 기존 `--id`는 호환용으로 남긴다.

## 싱글 생성

다음은 `naintail_generate_single`의 `request` 예시다. 기존 settings 필드는 그대로 사용할 수 있다.

```json
{
  "prompt": "1girl",
  "examplePreset": "SP-1",
  "characters": [
    { "preset": "테스트 캐릭터", "outfit": "근무복" }
  ],
  "settings": { "model": "nai-diffusion-5-full", "width": 832, "height": 1216 }
}
```

참조 필드는 `"SP-1"`처럼 **이름만 보내는 방식을 기본으로 사용한다**. 필드가 타입을 결정하므로
대괄호나 한글 타입 접두사는 필요 없다. `"[작례 프리셋:SP-1]"` 또는
`{"type":"example","name":"SP-1"}`도 호환용으로 지원하며 타입은 입력 필드와 일치해야 한다.
일반 `prompt` 문자열 안의 참조 표기는 파싱하지 않는다. 호출 순서는 [MCP 가이드](MCP.md)를 참고한다.

| 입력 | 적용 |
|---|---|
| 참조 없음·null·빈 문자열 | 프리셋 조회 없이 기존 직접 입력 사용 |
| 작례 참조 + 직접 `examplePrompt`/`exampleNegativePrompt` | 프리셋 내용 뒤에 직접 입력을 합성 |
| 캐릭터 참조 + 직접 `prompt`/`negativePrompt` | 프리셋 베이스·UC 뒤에 직접 입력을 합성 |
| 캐릭터 이름·사용 여부·위치 지정 | 요청 값 사용 |
| `outfit` 생략 | 프리셋에 저장된 의상 선택 유지 |
| `outfit: "근무복"` | 해당 의상 이름 선택 |
| `outfit: null` | 목록은 유지하고 선택 해제 → 목록이 있으면 `undressed, nude` |
| 직접 `outfits: []` | 목록 교체·선택 해제 → 자동 태그 없음 |

직접 의상 목록을 지정하면 프리셋 목록을 교체하고, 선택 ID를 따로 지정하지 않으면 선택을 해제한다.
`outfit`과 `selectedOutfitId`는 동시에 지정하지 않는다. 의상 이름이 없거나 여러 항목에 해당하면 오류다.
작례만·캐릭터만·둘 다·아무 프리셋도 사용하지 않는 조합을 모두 지원한다.

## 멀티 서브슬롯

`naintail_generate_multi`는 같은 작례·캐릭터 참조와 함께 `slotPreset`을 받는다.

```json
{
  "prompt": "1girl",
  "examplePreset": "SP-1",
  "characters": [{ "preset": "테스트 캐릭터", "outfit": null }],
  "slotPreset": "감정",
  "slots": [{ "name": "추가 컷", "prompt": "looking away" }]
}
```

여러 묶음은 `"slotPresets": ["감정", "포즈"]`로 지정한다.
`slotPreset`과 비어 있지 않은 `slotPresets`는 동시에 쓰지 않는다. 참조한 묶음을 순서대로 펼친 뒤
직접 입력 `slots`를 붙인다. 각 슬롯의 이름·Prompt·UC·설정을 복사하고 ID는 새로 생성한다.
최종 슬롯 수는 기존과 같이 최대 20개다. 빈 슬롯 프리셋은 오류이며, 프리셋 없이 빈 `slots`를
보내는 기존 공통 프롬프트 1장 생성은 유지한다. 빈 `slotPresets: []`는 참조 미사용이다.

## 실행 일관성·검증

이름 참조는 싱글·멀티의 공용 Core에서 해석하므로 MCP·CLI·GUI 생성 진입점에 같은 규칙을 적용한다.
MCP에서는 비용 승인 전에 참조를 한 번 풀고, 같은 내용으로 비용을 계산하고 큐에 넣는다.
큐 및 PNG 메타데이터에는 완전히 적용된 프롬프트·캐릭터·의상 스냅샷이 남는다.
대기 중 파일 수정·이름 변경·삭제가 이미 접수된 생성 내용을 바꾸지 않는다.
이름 참조가 줄이는 것은 MCP 요청·응답 본문의 반복이다. NAI에 전달되는 최종 내용은 동일하다.

`preset-references` 개발 테스트는 미사용 회귀, 조합별 합성, 멀티 확장, 오류 처리, 이름 충돌,
원본 보존 이전, 비용 계산과 실행 간 스냅샷 일관성을 검증한다. 실제 외부 생성과 릴리즈는 별도다.
