# NainTail 호스트와 홈 관리

NainTail은 `NainTailUtil` 포터블 배포본의 **애드온 호스트**다. 이미지 생성, 갤러리,
검열 기능을 직접 소유하지 않고, 제품에 배치된 애드온을 발견해 홈에 표시하고 적절한 실행 entry와
공용 service를 연결한다.

## 책임 경계

NainTail이 소유하는 기능은 다음과 같다.

- 애드온 registry와 `naintail.addon/v1` manifest 검증
- 홈 카드 목록, 표시 순서와 기본 애드온 결정
- 필수 애드온 존재 여부 확인
- Electron·CLI·MCP entry 선택과 경계 내부 경로 해석
- 호스트 Electron이 없을 때 고정 manifest 기반 검증 다운로드와 `runtime/electron/` 설치
- GUI 창 lifecycle, 홈 이동과 같은 애드온 재진입
- 제한된 host service, dependency resolver와 handoff 전달
- Hosted Python/CUDA runtime의 저장·설치 경계와 `runtimeRoot` 주입
- Hosted `outputs/<addonId>/` namespace 계산과 output root 주입
- 호스트 전체의 runtime manifest와 내장 애드온 목록

NainTail이 소유하지 않는 기능은 다음과 같다.

- 생성 요청, 프롬프트, 모델과 큐의 도메인 규칙
- 프리셋·작품·결과·검열 데이터의 schema와 migration
- 애드온 Worker와 외부 API의 구현
- 애드온별 모델 호환성 판정과 Worker 구현

이 경계가 필요한 이유는 애드온이 NainTail 없이도 독립 실행할 수 있고, 호스트에 장착했을
때도 같은 Core와 Worker를 재사용하게 하기 위해서다.

## 홈에서 애드온을 발견하는 방식

호스트는 제품 루트의 `Addons/` 바로 아래 디렉터리를 조회한다. 각 디렉터리에 유효한
`addon.json`이 있어야 registry에 등록된다.

현재 manifest의 핵심 필드는 다음과 같다.

| 필드 | 역할 |
|---|---|
| `schema` | `naintail.addon/v1` 계약 선언 |
| `id`, `name`, `version` | 식별자와 표시 정보 |
| `default`, `order` | 기본 대상과 홈 정렬 순서 |
| `entries` | 호스트에 공개하는 Electron·CLI·MCP 등의 진입점 |
| `requires` | 실행 전에 존재해야 하는 다른 애드온 ID |
| `artifactProviders` | 선택적으로 입력받을 수 있는 artifact provider ID |
| `capabilities` | 목록과 진단에 노출하는 기능 식별자 |

정렬은 기본 애드온, `order`, 표시 이름 순으로 결정한다. 중복 ID, 허용되지 않은 entry 종류,
애드온 디렉터리 밖으로 벗어나는 entry 경로는 거부한다.

## GUI lifecycle

1. 호스트가 홈 창을 열고 발견된 manifest 수만큼 카드를 만든다.
2. 사용자가 카드를 누르면 `requires` 누락 여부를 확인한다.
3. 애드온의 Electron entry를 로드하고 host context로 활성화한다.
4. 애드온 창을 열고 홈 창은 숨긴다.
5. 홈 버튼을 누르면 애드온 창을 숨기고 기존 홈 창을 다시 표시한다.

홈과 현재 활성 애드온 사이를 왕복할 때는 같은 창을 재사용하므로 renderer 상태를 유지한다.
다른 애드온을 선택하면 이전 runtime의 `close()`를 호출하고 기존 애드온 창을 파기한 뒤 새
애드온을 활성화한다. 따라서 **홈 왕복 보존**과 **서로 다른 애드온 간 동시 상주**는 같은
의미가 아니다.

호스트는 애드온에 Electron dialog, IPC, safeStorage, shell, 창 조회, broadcast와 등록된
애드온 디렉터리 resolver를 좁은 context로 전달한다. Hosted 출력은 호스트 제품 루트의
`outputs/<addonId>/`로 분리하고, 애드온 entry와 출력 소비자에게 추측 불가능한 명시적
`outputRoot`/resolver로 전달한다. 도메인 Core와 Worker가 Electron 또는 호스트 객체에 직접
의존해서는 안 된다.

Python/CUDA capability를 선언한 Hosted 애드온에는 `<NainTailRoot>/runtime/`을 `runtimeRoot`로
주입한다. 이 경로의 설치 잠금, 버전 디렉터리와 무결성 상태는 NainTail이 관리한다. 애드온은
필요한 runtime manifest와 패키지 요구사항을 선언하고 Worker·모델을 소유하지만, Hosted 실행에서
자기 폴더의 runtime으로 fallback하지 않는다. Standalone composition root만 애드온 로컬
`runtime/`을 사용한다.

## CLI와 MCP

CLI launcher는 기본 애드온 또는 명시적으로 선택한 애드온의 manifest를 읽어 해당 entry로
전달한다. 기본 MCP launcher는 NainTail federation server를 열고 축약 discovery·get·call로
`mcpAdapter`를 선언한 애드온을 lazy-load한다.

- CLI 선택: `--addon <addon-id>`
- MCP 기본: NainTail federation router
- MCP 호환 직접 선택: `NAINTAIL_ADDON_ID=<addon-id>`

CLI·MCP의 도메인 도구 schema와 결과는 각 애드온이 소유한다. 호스트는 전체 도구를 최초
`tools/list`에 합치지 않고 선택한 애드온·도구의 상세만 명시적으로 조회한다.

## 현재 관리 범위

현재 홈이 제공하는 애드온 관리는 다음 범위로 제한된다.

- 로컬 manifest 발견과 목록 표시
- 표시 순서와 기본 애드온 적용
- 필수 애드온 누락 확인
- 실행, 홈 복귀, 재진입과 다른 애드온 전환
- host-to-addon handoff
- 공식 애드온 카탈로그 조회와 설치·업데이트
- 호스트 공식 버전 조회와 사용자 승인형 자기 업데이트

다음은 아직 구현 범위가 아니다.

- 제3자 애드온 마켓과 임의 저장소 등록
- GUI에서 설치된 애드온 제거
- 활성화·비활성화 토글과 사용자별 정렬
- semantic version 범위 해결과 자동 migration
- 서명 검증, 권한 선언과 애드온 sandbox 정책
- 여러 애드온 runtime의 동시 상주와 통합 작업 그래프

향후 이 기능들을 추가하더라도 호스트는 패키지와 lifecycle만 관리하고 각 애드온의 도메인
데이터를 직접 수정하지 않는다.

## 호스트 자기 업데이트

NainTail 0.1.2부터 설정 화면에서 공식 `official-host.json`을 조회해 현재 호스트와 공개 버전을
비교한다. 새 버전이 있을 때만 업데이트 버튼을 활성화하며, 사용자가 확인한 뒤 다음 순서로
적용한다.

1. 공식 호스트 ZIP의 크기와 SHA-256을 검증한다.
2. 별도 staging 폴더에 압축을 풀고 `package.json`, 버전과 필수 entry를 검증한다.
3. 제품 폴더 바깥의 transaction marker를 기록한다.
4. 호스트 종료 후 외부 PowerShell updater가 새 코드로 교체한다.
5. `Addons/`, `config/`, `outputs/`, `runtime/`을 디렉터리 단위로 신버전에 이동한다.
6. 검증 완료 후 백업과 marker를 제거하고 호스트를 다시 실행한다.

전원 차단 등으로 보존 디렉터리가 구버전 백업과 신버전에 나뉘면 다음 `NainTailUtil.bat`
실행에서 marker를 발견해 남은 이동을 재개한다. 적용 오류가 정상적으로 포착되면 보존 데이터를
구버전에 되돌리고 전체 호스트를 롤백한다.

`official-host.json`은 호스트 ZIP과 분리된 릴리즈 자산이다. 호스트 ZIP 안에 자기 ZIP의 SHA-256을
넣으면 순환 참조가 생기기 때문이다. 마지막으로 검증한 manifest는 `runtime/catalog/`에 캐시한다.
호스트와 각 애드온 릴리즈에는 그 시점의 최신 `official-host.json`을 함께 게시한다.

이미 공개된 0.1.1에는 자기 업데이트 코드가 없으므로 0.1.1에서 0.1.2로 넘어가는 한 번은 수동
교체가 필요하다. 0.1.2 이후부터 이 업데이트 경로를 사용한다.

## 포터블·Hosted 계약

NainTail 호스트의 GUI·CLI·MCP launcher는 `runtime/electron/electron.exe`가 없으면 Windows
PowerShell 부트스트랩을 호출한다. 부트스트랩은 공식 Electron ZIP의 URL·크기·SHA-256을
`electron-runtime-manifest.json`과 대조하고 제품 루트의 `runtime/electron/`에 원자적으로
설치한다. 설치된 `.runtime-ready`의 버전과 hash도 매 실행 시 manifest와 대조하므로 호스트
업데이트가 새 Electron을 요구하면 기존 실행 파일의 존재만으로 구버전을 재사용하지 않는다.
따라서 호스트 ZIP에 Electron 바이너리를 중복 포함하거나 시스템 Node에 의존하지 않는다.

Standalone 지원 애드온은 폴더 하나만 복사해 독립 실행할 수 있어야 한다. Hosted에서는
NainTail이 composition root가 되어 공용 service와 dependency를 우선 주입한다. 어느 쪽도
시스템 전역 runtime이나 개발 PC 절대경로로 조용히 우회하지 않는다.

세부 우선순위, data root 소유권과 검증 Gate는
[`ADDON_DEVELOPMENT_CONTRACT.md`](../ADDON_DEVELOPMENT_CONTRACT.md)를, 실행 형태별 최종 결과
위치는 [`ADDON_OUTPUT_CONTRACT.md`](../ADDON_OUTPUT_CONTRACT.md)를 정식 계약으로 따른다.

## 관련 문서

- [NainTail MCP 애드온 연합 설계](MCP_FEDERATION.md)
- [전체 문서 인덱스](../README.md)
- [애드온 개발 계약](../ADDON_DEVELOPMENT_CONTRACT.md)
- [애드온 출력 위치 계약](../ADDON_OUTPUT_CONTRACT.md)
- [공통 UI 시스템](../UI_SYSTEM.md)
- [CLI·MCP 운영](../MCP.md)
- [전체 개발 계획](../DEVELOPMENT_PLAN.md)
