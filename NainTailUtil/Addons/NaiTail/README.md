# NaiTail

NainTail의 기본 NovelAI 내장 애드온이다. 기존 NAI 기능 전체를 하나의 두꺼운 모듈로 소유한다.

독립 기준 버전은 `VERSION`, `addon.json`, `package.json`의 `0.1.0`이다. 릴리즈 시 세 파일의
SemVer를 함께 변경하고 포터블 entry를 검증한다.

- `app/core/`: 작품·프리셋·큐·비용·참조 자산을 포함한 현재 NaiTail Core
- `app/workers/`: NovelAI 전송 Worker
- `dist/renderer/`: Single, Multi, 작례 연구기, 작품, 프리셋, 설정 UI
- `electron/`: 제한된 IPC와 자격증명 adapter
- `cli/`, `mcp/`: headless adapter

NainTail 호스트 안에서 실행하거나 `NaiTail.bat`로 단독 실행하는 경우 모두 이 NaiTail 폴더
자체가 application·data root다. `Projects/`, `Presets/`, `References/`, `Favorites/`, `outputs/`, `cache/`,
`config/`, `logs/`는 실행 형태와 관계없이 이 애드온이 직접 소유한다. Hosted 실행에서 달라지는
것은 호스트가 공용 runtime과 service를 주입한다는 점뿐이다.

작례 연구기 Searching에서 별표로 수집한 선호 자료는 `Favorites/Searching/favorites.json` DB와
`Favorites/Searching/<작가 이름>/` 이미지 폴더에 저장한다. DB는 `schemaVersion`을 포함하며 작가별 이미지는
최대 10장이다. `Favorites/`는 소스·릴리즈에 포함하지 않고 애드온 업데이트 시 사용자 데이터로 보존한다.

Mixing의 `＋ 작가` 선택기는 이 DB에 등록된 작가만 보여주며, 카드 대표 이미지는 작가별 이미지 배열의
0번 항목을 사용한다. 선택된 작가는 `mixingArtists`에 Favorite 키와 함께 저장되고, 생성 직전 Core가
키를 다시 대조해 DB에 없는 작가가 믹싱 요청으로 우회 입력되는 것을 막는다.

파운딩은 Favorites 작가 중 사용자가 지정한 수를 무작위로 선택해 한 장의 조합 이미지를 만들고, 각 작가의 가중치
비율로 회차당 10,000점을 배분한다. 사용자가 결과에 좋아요·싫어요·건너뛰기를 기록하면
`Favorites/Pounding/preference.json`에 작가별 노출·선호 점수와 가중치 구간별 통계가 누적된다. 좋아요를
누른 생성 결과는 원본 출력과 별도로 `Favorites/Pounding/`에 PNG로 복사된다. 최소 3회의
평가 증거가 생긴 작가는 선호 구간 쪽으로 탐색 폭을 서서히 좁히되, 전체 회차의 20%는 전역 범위를
계속 탐색한다. 건너뛰기는 학습 통계에 반영하지 않으며 한 결과의 중복 평가는 거부한다.

상세 기능 계약과 현재 한계는 `Docs/NaiTail/features/ARTIST_POUNDING.md`에 기록한다.

## 독립 포터블 실행

- GUI: `NaiTail.bat`
- CLI: `NaiTail_CLI.bat`
- MCP: `NaiTail_MCP.bat`
- 전용 Electron: `runtime/electron/`
- Electron 자동 설치: `bootstrap/ensure-electron.cmd`, `electron-runtime-manifest.json`
- standalone host: `standalone/`

따라서 이 `NaiTail/` 폴더 하나만 다른 Windows 경로로 복사해 상위 NainTailUtil 없이 실행할 수 있다.
Electron이 빠져 있으면 첫 실행 시 공식 배포본을 크기·SHA-256 검증 후 자동 설치한다. 기존
standalone 데이터까지 옮기려면 폴더 전체를 그대로 복사한다.
