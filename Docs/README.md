# NainTailUtil 문서 안내

이 폴더는 NainTail 호스트와 내장 애드온의 개발 문서를 관리한다. 문서의 저장 위치는
코드 소유권과 같은 경계를 사용한다.

## 문서 라우팅

| 위치 | 소유 범위 |
|---|---|
| [`NainTail/`](NainTail/README.md) | 애드온 홈, registry, 실행·전환, host lifecycle과 routing |
| [`NaiTail/`](NaiTail/README.md) | NovelAI 생성, 작품·프리셋·큐, NAI Worker와 API 계약 |
| [`AnimaTail/`](AnimaTail/README.md) | 로컬 Anima 생성, Python/CUDA 런타임, 모델·LoRA, CLI·MCP |
| [`GalleryTail/`](GalleryTail/README.md) | Anima 결과 탐색, 파일 작업과 설정 handoff |
| [`CensorTail/`](CensorTail/README.md) | 로컬 자동검열, ONNX Worker, 검열 편집·저장 |
| `Docs/` 루트 | 둘 이상의 경계에 적용되는 공통 계약·계획·결과 |

## 공통 문서

| 문서 | 범위 |
|---|---|
| [`ADDON_DEVELOPMENT_CONTRACT.md`](ADDON_DEVELOPMENT_CONTRACT.md) | Hosted·Standalone 애드온 개발 계약 |
| [`ADDON_MCP_PROFILE.md`](ADDON_MCP_PROFILE.md) | 애드온 MCP 공통 명령·상태·job·결과 계약 |
| [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) | 전체 제품 구조와 개발 계획 |
| [`MCP.md`](MCP.md) | 범용 MCP host와 NaiTail·AnimaTail 등록 방식 |
| [`MVP_RESULT.md`](MVP_RESULT.md) | 전체 MVP 구현·검증 결과 |
| [`UI_SYSTEM.md`](UI_SYSTEM.md) | 호스트와 모든 애드온에 적용되는 공통 UI 계약 |

## 관리 규칙

1. NainTail 호스트만 소유하는 새 문서는 `Docs/NainTail/` 아래에 만든다.
2. 한 애드온만 소유하는 새 문서는 반드시 `Docs/<AddonName>/` 아래에 만든다.
3. 둘 이상의 애드온 또는 호스트와 애드온에 함께 적용되는 계약만 `Docs/` 루트에 둔다.
4. 기능 문서는 `features/`, 구현 문서는 `development/`, 작업 기록은 `flows/`, 장기 결정은
   `decisions/`, 검증 결과는 `results/` 하위 폴더를 권장한다.
5. 공통 문서에는 세부 구현을 복제하지 않고 해당 호스트·애드온 문서 링크를 둔다.
6. 소유권이 바뀌면 코드 이동과 같은 변경에서 문서도 새 소유 폴더로 함께 옮긴다.
7. 과거 검증 기록을 보존할 때는 현재 계약으로 오해하지 않도록 역사 문서임을 명시한다.
