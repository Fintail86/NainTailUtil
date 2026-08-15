# NaiTail

- 문서 대상: `NainTailUtil/Addons/NaiTail/`
- 애드온 ID: `naitail`
- 현재 manifest 버전: `0.1.0`
- 실행 형태: Hosted, Standalone GUI·CLI·MCP

NaiTail은 NainTail의 기본 내장 NovelAI 생성 애드온이다. NovelAI 요청을 해석하고 한 장 단위로
실행하는 Core와 Worker, 생성 작업을 구성하는 GUI, 자동화를 위한 CLI·MCP를 하나의 애드온
경계 안에서 소유한다.

이 폴더는 NaiTail 전용 기능·개발·결정·검증 문서의 시작점이다. 호스트 또는 여러 애드온에
공통으로 적용되는 규칙은 [`../README.md`](../README.md)와
[`../ADDON_DEVELOPMENT_CONTRACT.md`](../ADDON_DEVELOPMENT_CONTRACT.md)를 따른다.

## 사용자 기능

| 화면 | 역할 |
|---|---|
| 싱글 | 단일 생성 요청, 캐릭터 프롬프트, 참조 이미지와 결과 미리보기 |
| 멀티 | 공통 프롬프트와 활성 슬롯을 조합한 연속 생성 |
| 작례 연구기 | 작가·태그 조합을 관리하고 예시 이미지를 생성·저장 |
| 작품 | 작품별 공통 설정, 캐릭터 카드와 일반·캐릭터 슬롯 관리 |
| 프리셋 | 서브슬롯과 작례 프리셋 저장·재사용 |
| 설정 | NovelAI 자격증명과 애드온 상태 관리 |

생성 요청은 Anlas 비용을 먼저 계산한 뒤 로컬 순차 큐에서 한 장씩 실행한다. Precise Reference와
Vibe Transfer를 지원하지만 하나의 요청에서 두 참조 방식을 동시에 사용하지 않는다. 생성 결과와
PNG metadata는 NaiTail의 `outputs/` 아래에 저장한다.

## 실행 형태

NaiTail은 같은 Core, Worker와 UI를 두 composition root에서 사용한다.

| 형태 | 진입점 | 실행 환경 |
|---|---|---|
| Hosted GUI | `app/electron/main.cjs` | NainTail host가 Electron service와 창 생명주기를 주입 |
| Standalone GUI | `NaiTail.bat` | 애드온 내부 `runtime/electron/electron.exe` 사용 |
| Standalone CLI | `NaiTail_CLI.bat` | 포터블 Electron을 Node 런타임으로 사용 |
| Standalone MCP | `NaiTail_MCP.bat` | stdio MCP 서버로 실행 |

Standalone에서는 NaiTail 폴더가 application root이자 data root다. 따라서 `NaiTail/` 폴더 하나를
다른 Windows 경로로 복사해 실행할 수 있어야 하며, 시스템 Node나 전역 Electron을 fallback으로
사용하지 않는다. Hosted에서는 코드와 데이터 소유권은 NaiTail에 남고, 호스트가 주입한 공용
service를 우선 사용한다.

## 공개 경계

`addon.json`의 `naintail.addon/v1` manifest가 호스트에 다음 entry를 공개한다.

| Entry | 경로 |
|---|---|
| Electron | `app/electron/main.cjs` |
| Preload | `app/electron/preload.cjs` |
| Renderer | `app/renderer/index.html` |
| CLI | `app/cli/main.cjs` |
| MCP | `app/mcp/main.cjs` |

Standalone 패키지는 별도의 `standalone-manifest.json`에서 포터블 Electron, GUI·CLI·MCP launcher와
data root를 선언한다. Standalone entry는 조립과 생명주기만 담당하며 Core나 Worker를 복제하지
않는다.

## 코드 구조

| 위치 | 소유 책임 |
|---|---|
| `app/core/` | 요청 정규화, 작품·프리셋, 비용, 큐, 출력과 참조 자산 |
| `app/workers/nai/` | NovelAI payload, API 전송, ZIP·이미지 처리와 Vibe cache |
| `app/renderer/` | 여섯 개 사용자 화면과 상태·결과 표시 |
| `app/electron/` | 제한된 IPC, dialog·shell·safeStorage adapter |
| `app/cli/` | 동기형 headless 명령 adapter |
| `app/mcp/` | 비동기 작업 등록·조회·대기·취소 도구 |
| `standalone/` | 독립 실행용 GUI·CLI·MCP composition root |

Core와 Worker는 NainTail host나 Electron UI의 세부 구현을 직접 참조하지 않는다. 호스트 기능이
필요한 경우에는 Electron entry에서 전달받은 좁은 service를 adapter를 통해 사용한다.

## 데이터 소유권

Hosted와 Standalone 모두 다음 데이터는 NaiTail 애드온 폴더 안에서 관리한다.

| 위치 | 내용 |
|---|---|
| `Projects/` | 작품과 캐릭터·슬롯 데이터 |
| `Presets/sub-slots/` | 서브슬롯 프리셋 |
| `Presets/examples/` | 작례 프리셋 |
| `References/precise/` | Precise Reference 원본 |
| `References/vibes/` | Vibe Transfer 원본 |
| `outputs/` | 싱글·멀티·작례·작품 생성 결과 |
| `cache/vibes/` | 모델별 인코딩된 Vibe cache |
| `config/` | 생성 profile, 작례 연구 설정과 암호화된 자격증명 |
| `logs/` | NaiTail 실행 로그 |

경로는 명시적으로 전달된 data root에서만 계산한다. 부모 폴더, 현재 작업 디렉터리 또는 개발 PC의
절대경로를 추측해서 사용하지 않는다.

## NovelAI 자격증명

- GUI는 Electron `safeStorage`로 토큰을 암호화해 `config/credentials.json`에 저장한다.
- CLI와 MCP는 프로세스 환경의 `NAINTAIL_NAI_TOKEN`을 사용한다.
- GUI에 저장된 토큰은 stdio CLI·MCP 프로세스에 자동으로 노출하지 않는다.
- 토큰 원문은 프로젝트, 프리셋, 로그나 Git 추적 파일에 기록하지 않는다.

## 개발 원칙

1. NaiTail 도메인 기능과 schema는 이 애드온 안에서 구현한다. 호스트로 옮기지 않는다.
2. Hosted와 Standalone은 같은 Core·Worker·UI를 공유하며 실행 형태별 구현을 복제하지 않는다.
3. 데이터 형식이나 저장 위치를 바꿀 때는 migration과 하위 호환 계획을 먼저 문서화한다.
4. 실행 진입점이나 의존성을 바꿀 때는 Hosted와 복사된 Standalone 패키지를 각각 검증한다.
5. 기능 문서는 `features/`, 구현 문서는 `development/`, 작업 기록은 `flows/`, 장기 결정은
   `decisions/`, 검증 결과는 `results/` 아래에 둔다.
6. 구현 완료, 자동 테스트 통과, 실제 NovelAI 생성 품질 확인은 서로 다른 검증 결과로 기록한다.

## 관련 문서

- [`../ADDON_DEVELOPMENT_CONTRACT.md`](../ADDON_DEVELOPMENT_CONTRACT.md): Hosted·Standalone 공통 계약
- [`../MCP.md`](../MCP.md): 범용 MCP host와 NaiTail 등록 방식
- [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md): 전체 제품 구조와 개발 계획
- [`../MVP_RESULT.md`](../MVP_RESULT.md): 현재 전체 MVP 구현·검증 기록
- [`../UI_SYSTEM.md`](../UI_SYSTEM.md): 호스트와 애드온 공통 UI 계약

