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
- GUI 창 lifecycle, 홈 이동과 같은 애드온 재진입
- 제한된 host service, dependency resolver와 handoff 전달
- 호스트 전체의 runtime manifest와 내장 애드온 목록

NainTail이 소유하지 않는 기능은 다음과 같다.

- 생성 요청, 프롬프트, 모델과 큐의 도메인 규칙
- 프리셋·작품·결과·검열 데이터의 schema와 migration
- 애드온 Worker와 외부 API의 구현
- 애드온별 runtime·모델 호환성 판정

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
애드온 디렉터리 resolver를 좁은 context로 전달한다. 도메인 Core와 Worker가 Electron 또는
호스트 객체에 직접 의존해서는 안 된다.

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

다음은 아직 구현 범위가 아니다.

- 온라인 애드온 카탈로그와 마켓
- GUI에서 다운로드, 설치, 업데이트, 제거
- 활성화·비활성화 토글과 사용자별 정렬
- semantic version 범위 해결과 자동 migration
- 서명 검증, 권한 선언과 애드온 sandbox 정책
- 여러 애드온 runtime의 동시 상주와 통합 작업 그래프

향후 이 기능들을 추가하더라도 호스트는 패키지와 lifecycle만 관리하고 각 애드온의 도메인
데이터를 직접 수정하지 않는다.

## 포터블·Hosted 계약

Standalone 지원 애드온은 폴더 하나만 복사해 독립 실행할 수 있어야 한다. Hosted에서는
NainTail이 composition root가 되어 공용 service와 dependency를 우선 주입한다. 어느 쪽도
시스템 전역 runtime이나 개발 PC 절대경로로 조용히 우회하지 않는다.

세부 우선순위, data root 소유권과 검증 Gate는
[`ADDON_DEVELOPMENT_CONTRACT.md`](../ADDON_DEVELOPMENT_CONTRACT.md)를 정식 계약으로 따른다.

## 관련 문서

- [NainTail MCP 애드온 연합 설계](MCP_FEDERATION.md)
- [전체 문서 인덱스](../README.md)
- [애드온 개발 계약](../ADDON_DEVELOPMENT_CONTRACT.md)
- [공통 UI 시스템](../UI_SYSTEM.md)
- [CLI·MCP 운영](../MCP.md)
- [전체 개발 계획](../DEVELOPMENT_PLAN.md)
