# AnimaTail 문서 안내

- 현재 애드온 경계 적용일: 2026-08-15
- 대상: `NainTailUtil/Addons/AnimaTail/`

## AnimaTail이란

AnimaTail은 Anima 계열 모델을 로컬에서 실행하는 Windows용 이미지 생성 애드온이다.
싱글·멀티 생성, 모델과 LoRA 선택, 생성 프리셋, CLI와 MCP 자동화를 소유하며 실제 추론은
애드온 전용 Python/CUDA Worker에서 수행한다.

같은 코드와 사용자 데이터를 두 실행 형태에서 사용한다.

- **Hosted**: NainTail 홈에서 애드온으로 열고 호스트가 제공하는 Electron lifecycle과
  dependency를 우선 사용한다.
- **Standalone**: `NainTailUtil/Addons/AnimaTail/` 폴더만 복사해 독립 포터블 유틸로
  실행한다. GUI는 `AnimaTail.bat`, CLI는 `AnimaTail_CLI.bat`, MCP는
  `AnimaTail_MCP.bat`가 진입점이다.

두 형태의 Core, Worker, UI와 데이터 schema는 동일하다. 실행 환경 선택, 경로 주입과 창
생명주기만 composition root에서 달라진다. 자세한 규범은
[`../ADDON_DEVELOPMENT_CONTRACT.md`](../ADDON_DEVELOPMENT_CONTRACT.md)를 따른다.

## 소유 경계

AnimaTail은 다음 범위를 직접 소유한다.

- Anima 싱글·멀티 생성과 실험적 리파인 기능
- 모델·LoRA 카탈로그, 호환성 진단과 생성용 보조 자산
- 프롬프트·서브 프롬프트·생성 환경 프리셋
- 생성 큐, Python/CUDA Worker, GUI·CLI·MCP adapter
- `Models/`, `Presets/`, `outputs/`, `runtime/` 아래의 로컬 자산과 사용자 데이터

생성 결과 탐색은 `GalleryTail`, 자동검열은 `CensorTail`이 소유한다. 두 애드온은 AnimaTail의
공개된 출력·dependency 경계를 사용하며, AnimaTail 내부 구현이나 부모 폴더 구조를 추측해
접근하지 않는다.

## 문서 사용 순서

1. 현재 화면과 지원 기능은 [`features/TABS.md`](features/TABS.md)에서 확인한다.
2. 생성·모델·프리셋·CLI·MCP의 세부 계약은 아래 사용자 기능 문서를 따른다.
3. 코드 변경 전에는 [`development/CODE_STRUCTURE.md`](development/CODE_STRUCTURE.md)와
   [`development/TESTING.md`](development/TESTING.md)를 확인한다.
4. 장기 설계 변경은 `decisions/`, 기능 단위 작업은 `flows/`에 PLAN과 RESULT로 남긴다.

이 폴더의 상세 문서는 AnimaUtil에서 가져온 로컬 생성 기록을 기반으로 한다. 현재 제품에서는
갤러리와 자동검열이 각각 `GalleryTail`, `CensorTail`로 분리되었으며 새 문서는 실제 소유
애드온 폴더에 기록한다.

Gate 문서는 당시 검증 결과를 보존하는 역사 문서이므로 현재 기능 목록 대신 사용하지 않는다.

## 사용자 기능

| 문서 | 범위 |
|---|---|
| [`features/TABS.md`](features/TABS.md) | 상단 탭별 현재 기능과 미구현 경계 |
| [`features/GENERATION.md`](features/GENERATION.md) | 싱글·멀티 생성, 큐, 미리보기와 실행 방법 |
| [`features/SAMPLING.md`](features/SAMPLING.md) | 샘플러·스케줄러 구현과 지원 조합 |
| [`features/METADATA.md`](features/METADATA.md) | 생성 이미지 내장 메타데이터와 호환 schema |
| [`features/MODELS.md`](features/MODELS.md) | Models 폴더와 체크포인트·LoRA 호환성 |
| [`features/PRESETS.md`](features/PRESETS.md) | 프롬프트·환경 프리셋 파일과 편집·덮어쓰기 |
| [`features/CLI.md`](features/CLI.md) | AI 친화적 싱글·멀티 생성과 프롬프트·환경 프리셋 CLI |
| [`features/MCP.md`](features/MCP.md) | AI가 직접 호출하는 비동기 싱글·멀티 생성 MCP 서버 |
| [`features/UI_SYSTEM.md`](features/UI_SYSTEM.md) | 폰트 토큰, 공통 피드백 UI와 접기 상태 |

## 개발과 검증

| 문서 | 범위 |
|---|---|
| [`development/CODE_STRUCTURE.md`](development/CODE_STRUCTURE.md) | 워크스페이스와 Electron·React·Python 책임 |
| [`development/TESTING.md`](development/TESTING.md) | Node, Python, Electron, 실제 GPU 검증 명령과 범위 |
| [`plans/PLAN.md`](plans/PLAN.md) | 전체 목표, 위험, 보류 중인 배포 경계 |
| [`flows/README.md`](flows/README.md) | 기능 단위 PLAN·RESULT 기록 규칙 |
| [`flows/001-generation-cli/PLAN.md`](flows/001-generation-cli/PLAN.md) | 싱글·멀티 생성과 프롬프트 프리셋 CLI 개발 계획 |
| [`flows/002-generation-mcp/PLAN.md`](flows/002-generation-mcp/PLAN.md) | 생성 MCP 서버 개발 계획 |
| [`decisions/README.md`](decisions/README.md) | 장기 영향을 주는 결정 기록 규칙 |

## 검증 기록

- [`results/GATE_A_RESULT.md`](results/GATE_A_RESULT.md): RTX 5090 CUDA·Anima 추론 검증
- [`results/GATE_B_RESULT.md`](results/GATE_B_RESULT.md): 앱 전용 Python/CUDA 런타임 설치·격리 검증

## 분리된 관련 애드온

- [`../GalleryTail/README.md`](../GalleryTail/README.md): 생성 결과 탐색과 설정 handoff
- [`../CensorTail/README.md`](../CensorTail/README.md): 자동검열 Worker·UI·저장

## 문서 갱신 원칙

1. 탭에 보이는 사용자 기능은 `features/TABS.md`와 해당 전문 문서를 함께 갱신한다.
2. 파일 형식이나 복원 규칙이 바뀌면 `features/METADATA.md` 또는
   `features/PRESETS.md`를 갱신한다.
3. 테스트를 추가하거나 검증 범위가 달라지면 `development/TESTING.md`를 갱신한다.
4. Gate 결과의 과거 수치와 판정은 덮어쓰지 않고 현재 문서에서 후속 상태를 설명한다.
5. `Addons/AnimaTail/Models/`, `Presets/`, `outputs/`, `runtime/`의 사용자·대용량 파일은
   문서화 대상이지만 Git 추적 대상으로 바꾸지 않는다.
