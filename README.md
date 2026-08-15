# NainTailUtil

NainTailUtil은 **NainTail 애드온 호스트**와 내장 애드온을 함께 배포하는 포터블 Windows
플랫폼이다. NainTail 자체는 이미지 생성기가 아니다. 애드온을 발견해 홈에 표시하고,
필요한 실행 환경을 연결한 뒤 GUI·CLI·MCP 진입점으로 여는 관리 계층이다.

## 이름과 책임

| 이름 | 의미 |
|---|---|
| **NainTail** | 애드온 홈, registry, 실행·전환·의존성 확인을 소유하는 호스트 |
| **NaiTail** | NovelAI 이미지 생성 기능을 소유하는 내장 애드온 |
| **NainTailUtil** | NainTail 호스트와 내장 애드온을 함께 담은 저장소·포터블 배포본 |

생성, 갤러리, 검열 같은 도메인 기능은 NainTail이 아니라 각 애드온이 소유한다. 호스트는
애드온 내부의 Core, Worker, 데이터 schema를 해석하거나 대신 구현하지 않는다.

## NainTail 홈 관리 기능

현재 호스트가 담당하는 범위는 다음과 같다.

- `Addons/*/addon.json`을 탐색하고 `naintail.addon/v1` manifest를 검증한다.
- `default`, `order`, 이름 순으로 홈 카드를 구성하고 가용 애드온 목록을 표시한다.
- `requires`에 선언된 필수 애드온이 없으면 실행을 막고 누락 항목을 알린다.
- manifest에 공개된 Electron·CLI·MCP entry만 애드온 폴더 경계 안에서 해석한다.
- GUI에서는 홈과 활성 애드온 창을 전환하고, 홈 복귀 후 같은 애드온에 재진입할 때 상태를
  유지한다. 다른 애드온으로 전환하면 이전 애드온 runtime을 종료하고 새 애드온을 활성화한다.
- Electron dialog, safeStorage, 제한된 IPC, 애드온 경로 resolver와 handoff 같은 공용
  service를 애드온 entry에 주입한다.
- CLI는 선택한 애드온 entry로 전달하고, MCP는 기본 federation routing 또는 명시적인 호환
  selector로 애드온 entry를 실행한다.

현재 의미의 관리는 **로컬 manifest 발견, 상태 확인, 실행과 전환**까지다. 온라인 마켓,
다운로드, 설치·업데이트·제거, 활성/비활성 토글, 버전 자동 해결은 아직 구현하지 않았다.
따라서 홈에 카드가 보인다는 사실만으로 모든 runtime·모델의 호환성까지 보장하지는 않는다.

호스트의 상세 계약은 [NainTail 호스트 문서](Docs/NainTail/README.md), 애드온의 독립 실행과
Hosted 결합 규칙은 [애드온 개발 계약](Docs/ADDON_DEVELOPMENT_CONTRACT.md)을 따른다.

## 내장 애드온

| 애드온 | 소유 기능 | 실행 형태 |
|---|---|---|
| **NaiTail** | NovelAI 생성, 작품·프리셋·참조 이미지·큐 관리 | Hosted / Standalone GUI·CLI·MCP |
| **AnimaTail** | 로컬 Anima 생성, Python/CUDA runtime과 모델 관리 | Hosted / Standalone GUI·CLI·MCP |
| **GalleryTail** | AnimaTail 결과 탐색, 파일 작업과 설정 handoff | Hosted GUI |
| **CensorTail** | 로컬 자동검열, 마스크·박스 편집과 결과 저장 | Hosted / Standalone GUI |

각 애드온의 기능과 데이터는 해당 애드온 문서에서 관리한다.

## 바로 실행하기

Windows 탐색기에서 다음 파일을 실행하면 NainTail 홈이 열린다.

```text
NainTailUtil/NainTailUtil.bat
```

호스트 CLI와 MCP 진입점은 다음과 같다.

```text
NainTailUtil/NainTailUtil_CLI.bat
NainTailUtil/NainTailUtil_MCP.bat
```

기본 CLI 대상은 NaiTail이고 `--addon <id>`로 다른 애드온을 선택한다. 기본 MCP는 NainTail
federation router이며, 현재 NaiTail과 AnimaTail 도구를 축약 조회·호출할 수 있다. 기존 단일 애드온 MCP는
`NAINTAIL_ADDON_ID`를 명시해 직접 선택한다. 제품 폴더에는 전용 Electron runtime이 포함되므로
GUI·CLI·MCP 사용에 시스템 Node.js가 필요하지 않다.

AnimaTail과 CensorTail은 Python/CUDA runtime이 없으면 최초 실행 시 설치 안내를 표시하고,
사용자가 승인한 뒤 포터블 경계 안에서 준비한다.

## 애드온 장착과 단독 실행

Hosted 애드온의 최소 장착 단위는 다음과 같다.

```text
NainTailUtil/Addons/<AddonName>/
└─ addon.json
```

호스트는 시작과 목록 조회 시 manifest를 다시 발견한다. 현재는 파일을 홈에서 설치하는 기능이
없으므로, 애드온 폴더의 배치와 제거는 앱을 종료한 상태에서 배포·관리한다.

Standalone 지원을 선언한 NaiTail, AnimaTail과 CensorTail은 각 폴더만 복사해 직접 실행할 수 있다.

```text
NainTailUtil/Addons/NaiTail/NaiTail.bat
NainTailUtil/Addons/AnimaTail/AnimaTail.bat
NainTailUtil/Addons/CensorTail/CensorTail.bat
```

Standalone에서는 애드온 내부 runtime과 data root를 사용한다. Hosted에서는 같은 코드를
NainTail composition root에서 실행하고 호스트가 제공한 service와 dependency를 우선한다.

## 포터블 제품 경계

실제 배포·복사 대상은 저장소 전체가 아니라 중첩된 [`NainTailUtil/`](NainTailUtil/README.md)
폴더 하나다.

```text
NainTailUtil/                 개발 워크스페이스
├─ Docs/                     호스트·공통·애드온별 개발 문서
├─ Tests/                    제품 외부 자동 테스트
├─ Tools/                    검증·QA 보조 도구
├─ Artifacts/                다시 만들 수 있는 개발 산출물
└─ NainTailUtil/             독립 실행 가능한 포터블 제품
   ├─ app/                   NainTail 호스트
   ├─ Addons/               내장 애드온
   ├─ runtime/              공용 Electron runtime
   └─ licenses/             포함 구성 요소 고지문
```

테스트 코드와 개발 산출물은 제품 폴더에 포함하지 않는다. 제품은 부모 워크스페이스나
개발 PC의 절대경로, 시스템 Python·CUDA Toolkit에 조용히 의존하지 않는다.

## 개발과 검증

개발 검증에는 Node.js가 필요하다. 저장소 루트에서 실행한다.

```bash
npm run test
npm run check:syntax
npm run check:portable
npm run check
```

자동 검증은 소스·계약·포터블 경계를 확인한다. 실제 외부 API 호출, GPU 생성 품질과
runtime 설치 성공 여부는 별도의 acceptance 범위다.

## 문서

- [문서 인덱스와 소유권 규칙](Docs/README.md)
- [NainTail 호스트와 홈 관리](Docs/NainTail/README.md)
- [애드온 개발 계약](Docs/ADDON_DEVELOPMENT_CONTRACT.md)
- [애드온 MCP Profile](Docs/ADDON_MCP_PROFILE.md)
- [전체 개발 계획](Docs/DEVELOPMENT_PLAN.md)
- [MVP 구현 결과](Docs/MVP_RESULT.md)
- [공통 UI 시스템](Docs/UI_SYSTEM.md)
- [CLI·MCP 운영](Docs/MCP.md)

호스트에만 해당하는 문서는 `Docs/NainTail/`, 개별 애드온 문서는
`Docs/<AddonName>/`, 둘 이상의 경계에 적용되는 계약만 `Docs/` 루트에서 관리한다.

## 라이선스와 외부 서비스

NovelAI는 NaiTail이 사용하는 외부 서비스이며 사용자의 구독·토큰과 해당 서비스 정책을
따른다. 각 runtime, 폰트와 참고 구현의 고지문은 실제 제품의 `licenses/` 및 애드온별
runtime 폴더에 보존한다.
