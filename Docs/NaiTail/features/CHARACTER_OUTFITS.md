# 캐릭터 베이스·의상·UC

싱글, 멀티, 작품 캐릭터 카드와 작례 연구기의 모든 캐릭터 편집 화면에 같은 규칙을 적용한다.

- 베이스: 기존 캐릭터 Prompt. 외모 등 공통 속성을 입력한다.
- 의상: 이름과 프롬프트를 가진 목록. 한 번에 하나만 체크할 수 있으며 다시 클릭하면 해제된다.
- UC: 기존 캐릭터 Undesired Content. 의상 선택으로 변경하지 않는다.

| 상태 | 최종 캐릭터 프롬프트 |
|---|---|
| 의상 선택 | 베이스 + 선택한 의상 프롬프트 |
| 의상 목록이 있고 선택 없음 | 베이스 + `undressed, nude` |
| 의상 목록이 비어 있음 | 베이스만 사용, 자동 태그 비활성화 |

새 의상은 추가와 동시에 선택된다. 선택한 의상을 삭제하면 선택이 해제된다.
마지막 의상을 삭제하면 자동 태그가 꺼진다. 선택된 의상의 프롬프트가 비어 있으면
베이스만 사용한다. 다른 의상의 프롬프트나 UC를 합치지 않는다.
작품의 캐릭터 소유 슬롯 Prompt·UC 합성 규칙은 유지한다.

## 저장 및 CLI·MCP 입력

기존 `prompt` 필드가 베이스다. 캐릭터 객체에 다음 선택 필드를 추가한다.
기존 schema v1을 유지하며, 의상 필드가 없는 기존 파일은 빈 목록·미선택으로 읽는다.
기존 프롬프트 안에 있던 의상 태그를 자동 분리하거나 제거하지 않는다.

```json
{
  "id": "character_1",
  "name": "캐릭터",
  "prompt": "girl, black hair",
  "outfits": [
    { "id": "uniform", "name": "교복", "prompt": "white shirt, blue skirt" },
    { "id": "casual", "name": "외출복", "prompt": "hoodie, jeans" }
  ],
  "selectedOutfitId": "uniform",
  "negativePrompt": "hat",
  "enabled": true,
  "position": null
}
```

미선택은 `selectedOutfitId: null` 또는 필드 생략으로 표현한다. 의상 ID는 캐릭터 내에서
고유해야 하며 선택 ID는 목록 안에 있어야 한다. 잘못된 선택 ID는 자동 미선택으로 바꾸지 않고
오류로 반환한다. 작품·작가 연구 저장과 생성 요청에는 베이스·목록·선택값을 보존한다.
Worker가 NAI payload를 만들 때만 최종 프롬프트로 합성하므로 재실행 시 의상을 중복 추가하지 않는다.
싱글·멀티 화면의 저장 수명은 기존과 같으며 생성 결과의 요청을 재사용할 때 의상 정보도 복원한다.

## 개발 검증

`npm test -- --scope NaiTail --suite character-outfits`로 합성, 하위 호환, 저장 및 모든 생성 경로를 검증한다.
`character-outfits-ui`는 브라우저 DOM에서 선택·해제·추가·삭제·화면 동기화를 검증한다.
UI 테스트에는 개발 환경의 `playwright` 패키지와 Edge가 필요하다. 패키지가 별도 도구 런타임에
있으면 `NODE_PATH`를 해당 `node_modules`로 지정한다. 다른 설치된 브라우저 채널은
`NAITAIL_TEST_BROWSER`로 선택할 수 있다. 제품 런타임에 개발 의존성을 설치하지 않는다.
실제 NovelAI 이미지 생성과 릴리즈 검증은 별도 실행한다.
