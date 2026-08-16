# GalleryTail 문서 안내

GalleryTail이 소유하는 생성 결과 탐색 기능 문서는 이 폴더에서 관리한다.

## 범위

- Hosted NainTail `outputs/animatail/` 탐색과 폴더 계층
- PNG 내장 metadata 표시
- 결과 미리보기, 위치 열기와 휴지통 이동
- `animatail.gallery-settings` 설정 handoff
- GalleryTail Electron service, preload와 renderer
- AnimaTail 의존성 및 Hosted 전용 실행 계약

GalleryTail은 결과 파일을 생성하지 않고 호스트가 `resolveAddonOutputRoot("animatail")`로 공개한
AnimaTail 출력 경계를 읽는다. 애드온 폴더나 부모 경로로 출력 위치를 추측하지 않는다. 설정
재사용은 파일을 직접 수정하지 않고 NainTail host handoff를 통해 AnimaTail을 연다.

전체 애드온 의존성은 [`../ADDON_DEVELOPMENT_CONTRACT.md`](../ADDON_DEVELOPMENT_CONTRACT.md),
출력 위치는 [`../ADDON_OUTPUT_CONTRACT.md`](../ADDON_OUTPUT_CONTRACT.md),
현재 구현 결과는 [`../MVP_RESULT.md`](../MVP_RESULT.md)를 따른다.
