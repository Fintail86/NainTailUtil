# 코드 구조와 리팩터링 기준

- 기준일: 2026-07-29
- 목적: 기능 추가가 계속되는 동안 프로세스 경계와 화면 책임이 다시 한 파일에 뭉치지 않도록 한다.

## 디렉터리 책임

| 경로 | 책임 |
|---|---|
| `AnimaUtil/` | 별도로 옮길 수 있는 앱 실행 기준 루트 |
| `AnimaUtil/electron/` | 창과 앱 수명주기, IPC 등록, 파일 시스템·프로세스 권한이 필요한 서비스 |
| `AnimaUtil/cli/` | GUI와 같은 생성 application API를 호출하는 JSON/JSONL 명령 adapter |
| `AnimaUtil/mcp/` | 같은 생성 application API를 호출하는 stdio MCP adapter와 비동기 작업 상태 |
| `AnimaUtil/src/renderer/` | React 화면과 사용자 상호작용. 운영체제 API는 preload 계약만 사용 |
| `AnimaUtil/app/` | Python 추론 worker, Anima adapter·sampling과 자동검열 이미지 합성 |
| `AnimaUtil/config/` | Renderer·Electron·Python이 함께 읽는 버전 관리 설정 계약 |
| `AnimaUtil/scripts/` | 개발 실행과 런타임 준비 스크립트 |
| `AnimaUtil/tests/` | Node 서비스·순수 UI 상태 계산과 Python 이미지·모델 계산의 회귀 테스트 |
| `AnimaUtil/runtime/` | 시스템 환경 변수와 분리된 로컬 Python/CUDA 실행 환경. Git에 포함하지 않음 |
| `docs/` | 현재 기능, 계획, 결정, flow와 과거 Gate 결과 |
| `tools/` | 앱 실행에 필요하지 않은 Gate 재현·검증 도구 |
| `artifacts/` | Gate·빌드 검증 시 다시 생성할 수 있는 임시 결과 |

## 작성 원칙

1. React view는 상태 조합과 서비스 호출을 담당하고, 재사용 가능한 입력 UI는 별도 컴포넌트로 둔다.
2. React나 Electron에 의존하지 않는 계산은 `.mjs` 순수 모듈로 분리해 Node 단위 테스트에서 직접 검증한다.
3. Electron main은 서비스를 조립하고 IPC를 등록하되, 파일 형식·진단·큐 규칙은 각 서비스 모듈에 둔다.
4. Python worker의 프로토콜 처리와 모델·이미지 계산을 분리한다. 계산 함수는 worker 프로세스를 띄우지 않고 테스트할 수 있어야 한다.
5. `AnimaUtil/Models/`, `AnimaUtil/Presets/`, `AnimaUtil/outputs/`의 사용자 데이터는
   코드 테스트가 직접 사용하지 않는다.
6. 파일을 나눌 때 CSS class, IPC channel, metadata schema와 사용자 문구를 함께 바꾸지 않는다. 구조 변경과 기능 변경을 분리한다.
7. 실행에 필요한 앱 전용 런타임은 `AnimaUtil/runtime/`에 두고, 삭제 가능한 검증
   결과만 바깥 `artifacts/`에 둔다.
8. `AnimaUtil/outputs/` 이미지는 IPC base64 왕복 대신 `anima://outputs/<파일명>` 커스텀 프로토콜로
   렌더러에 직접 서빙한다. 파일이 이동·삭제되면 404가 되므로 렌더러는 `OutputImage`
   폴백으로 처리한다. 큐 progress 이벤트는 전체 스냅샷 브로드캐스트를 250ms로 스로틀한다.
9. React GUI, CLI와 MCP는 동급 입력 adapter다. 생성 요청 정규화, 모델·LoRA 해석과 큐
   규칙은 `electron/generation-request.cjs`와 headless application 계층을 공유하며 서로를
   호출하지 않는다.

## 1차 정리 결과

- `generation-config.mjs`
  - 싱글·멀티 공통 해상도 프리셋, 크기 복원과 Turbo LoRA 분류
- `GenerationSizeSelector.jsx`
  - 두 생성 화면이 공유하는 방향·해상도·커스텀 크기 UI
- `generation-queue.mjs`
  - 멀티 생성 작업의 그룹화, 상태 우선순위, 결과 수 집계
- 위 순수 계산은 `generation-config.test.cjs`, `generation-queue.test.cjs`에서 직접 검증한다.
- `png-metadata.cjs`
  - PNG pixel을 디코딩하지 않고 `tEXt`, `zTXt`, `iTXt`의 `AnimaUtil` JSON을 읽는다.
- `gallery-service.cjs`
  - 갤러리 목록과 내장 metadata를 결합하고 과거 sidecar는 삭제 호환용으로만 찾는다.
- `OutputImage.jsx`, `output-files.mjs`
  - `anima://outputs/<파일명>` URL과 파일 이동·삭제 뒤 이미지 fallback을 담당한다.
- `PresetPicker.jsx`, `PresetNameDialog.jsx`
  - 생성 화면의 적용·새 저장·선택 항목 덮어쓰기 UI를 두 생성 모드에서 공유한다.
- `Generation2View.jsx`의 `SubPromptCard`
  - 카드별 프롬프트·네거티브·LoRA 접기 상태와 전용 LoRA 편집을 캡슐화한다.
- `electron/main.cjs`
  - 제품 프로세스에 포함돼 있던 Electron 스모크 assertion runner와 환경변수 분기를 제거했다.
  - main은 창 생성, 서비스 조립과 IPC 등록만 담당한다.
- `CensorEffectEditor.jsx`, `CensorInputPanel.jsx`, `CensorDetectionOverlay.jsx`, `CensorOutputStrip.jsx`
  - 자동검열의 중복 효과 입력, 이미지 목록, 박스 렌더링과 저장 결과 UI를 분리했다.
- `censor-effect-config.js`, `censor-view-utils.mjs`
  - 검열 기본값·도움말·박스 효과 병합과 좌표 계산을 화면에서 분리했다.
- `config/generation-profile.json`
  - 샘플러·스케줄러·기본값·생성 제한과 Turbo LoRA 경로 규칙의 단일 원본이다.
  - Renderer, Electron과 Python은 각 계층 adapter를 통해 같은 계약을 읽는다.
- `electron/generation-count.cjs`
  - 활성 서브 프롬프트, 큐와 배치로부터 생성 작업·이미지 수를 계산하는 단일 순수 계약이다.
  - Electron JobQueue와 MCP 자동 대기 정책이 같은 계산을 사용한다.
- `mcp/job-public-view.cjs`
  - MCP 결과 경로 검증과 슬림 공개 응답 직렬화를 작업 수명주기에서 분리한다.
- `mcp/job-manager.cjs`
  - 완료·실패·취소의 terminal 상태 전이는 `finishJob()`에서 시간 기록과 waiter 알림까지
    한 번에 처리한다.

공통 타이포그래피와 대화상자·오류 배치 규칙은
[`UI_SYSTEM.md`](../features/UI_SYSTEM.md), 변경
종류별 검증 기준은 [`TESTING.md`](TESTING.md)를 따른다.

## 다음 분리 순서

1. `AutoCensorView.jsx`
   - 남은 이미지/박스 편집 상태와 비동기 미리보기 흐름을 전용 hook으로 분리
2. `App.jsx`
   - 상단 앱 shell과 싱글 생성 화면을 분리
3. `Generation2View.jsx`
   - 서브 프롬프트 패널과 멀티 작업 목록을 독립 컴포넌트로 이동

각 단계는 Node 테스트와 Vite build를 통과한 뒤 완료로 본다. Electron 화면을 바꾼
단계는 개발 실행으로 수동 확인하고, Python 계산을 건드린 단계는 별도로 Python 단위
테스트도 실행한다.
