# GalleryTail 문서 안내

GalleryTail이 소유하는 생성 결과 탐색 기능 문서는 이 폴더에서 관리한다.

## 범위

- `전체 보기 / 워크스페이스 / 포터블 모드 자체 경로` 탐색 범위 선택
- Hosted NainTail 공용 출력 루트와 Standalone 애드온별 출력 위치 탐색
- PNG 내장 metadata 표시
- 결과 미리보기, 위치 열기와 휴지통 이동
- GalleryTail Electron service, preload와 renderer
- 생성 애드온과 분리된 독립 실행 계약

GalleryTail은 결과 파일을 생성하지 않는다. 워크스페이스 범위는 호스트가 직접 주입한 공용 출력
루트를, 포터블 범위는 호스트가 Standalone manifest와 공통 출력 설정 schema로 공개한 각 애드온의
실제 출력 경로를 읽는다. 특정 제공자나 부모 폴더를 추측하지 않으며, 탐색·폴더 열기·위치 표시와
휴지통 작업은 현재 선택한 저장 위치 안에서만 수행한다.

전체 애드온 의존성은 [`../ADDON_DEVELOPMENT_CONTRACT.md`](../ADDON_DEVELOPMENT_CONTRACT.md),
출력 위치는 [`../ADDON_OUTPUT_CONTRACT.md`](../ADDON_OUTPUT_CONTRACT.md),
현재 구현 결과는 [`../MVP_RESULT.md`](../MVP_RESULT.md)를 따른다.
