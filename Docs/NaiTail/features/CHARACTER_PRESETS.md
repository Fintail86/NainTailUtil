# 캐릭터 프리셋

프리셋 메뉴의 **캐릭터** 탭에서 `＋`로 추가하고 이름·베이스·의상 목록·UC를 편집해 저장한다.
의상은 한 종류 또는 미선택 상태를 저장할 수 있다. 저장된 항목은 목록에서 다시 열어 수정하거나
삭제한다. 편집 중 탭·항목 변경은 기존 프리셋의 미저장 변경 확인 규칙을 따른다.

싱글·멀티·작품·작가 연구의 캐릭터 카드에서 **캐릭터 프리셋 선택 → 불러오기**를 사용한다.

- 프리셋 이름을 캐릭터 이름으로 복사한다.
- 베이스, 의상 목록 전체, 선택 의상, UC를 현재 카드에 교체 적용한다.
- 카드 ID·사용 여부·배치 위치·설정·소유 슬롯은 유지한다.
- 복사한 내용은 원본과 독립적이다. 프리셋 수정·삭제가 이미 불러온 카드를 변경하지 않는다.
- 목록 갱신은 선택 옵션만 갱신하며 편집 중인 다른 카드 내용을 덮어쓰지 않는다.

의상 선택에 따른 합성은 [캐릭터 의상 규칙](CHARACTER_OUTFITS.md)과 같다.

## 저장·자동화 계약

저장 위치는 NaiTail 데이터 루트의 `Presets/characters/`다. 처음 실행하면 폴더를 생성한다.
기존 작례와 서브슬롯 파일은 그대로 유지한다. GUI와 CLI의 기존 preset CRUD가 세 종류를 처리하고,
MCP `naintail_presets_list`의 `type: "character"` 필터 및 `naintail_preset_get`의 타입·이름으로 조회한다.
파일명과 생성 시 본문 조회 없는 적용은 [이름 기반 프리셋 참조](PRESET_REFERENCES.md)를 따른다.

```json
{
  "schema": "naintail.character-preset/v1",
  "type": "character",
  "name": "검은 머리 캐릭터",
  "prompt": "girl, black hair",
  "outfits": [{ "id": "uniform", "name": "교복", "prompt": "uniform" }],
  "selectedOutfitId": "uniform",
  "negativePrompt": "hat"
}
```

ID와 생성·수정 시각은 저장 객체에 포함한다. 위치·사용 여부·슬롯·생성 설정은 프리셋 내용에
포함하지 않는다. 캐릭터 프리셋을 서브슬롯 Append 입력으로 사용하는 것은 허용하지 않는다.

## 개발 검증

- `character-presets`: 정규화, 실제 파일 저장·재로드·수정·삭제, 타입 분리, MCP 조회, 합성.
- `character-outfits-ui`: 실제 브라우저 DOM에서 프리셋 메뉴 CRUD 및 모든 캐릭터 화면의 불러오기,
  의상 상태 복원, 카드 고유 설정 보존, 복사 독립성, 옵션 갱신.

실행: `npm test -- --scope NaiTail --suite character-presets,character-outfits-ui`
브라우저 테스트의 개발 의존성 설정은 [의상 개발 검증](CHARACTER_OUTFITS.md#개발-검증)을 따른다.
