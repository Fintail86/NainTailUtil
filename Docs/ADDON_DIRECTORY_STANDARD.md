# NainTail 애드온 디렉터리 표준

- 상태: 마이그레이션 표준
- 적용 대상: `NainTailUtil/Addons/` 아래의 모든 애드온
- 적용 원칙: 새 애드온에는 즉시 적용하고, 기존 애드온은 아래 마이그레이션 순서로 맞춘다.

## 1. 목적과 경계

이 표준은 애드온의 도메인 구현을 하나의 프레임워크로 합치기 위한 규칙이 아니다. 호스트 탐색,
배포 조립, 독립 실행과 운영자가 반복해서 다루는 **외곽 구조**만 공통화한다.

- 호스트는 애드온 루트의 `addon.json`만 자동 탐색한다.
- 공개 entry의 실제 경로는 항상 manifest가 결정한다.
- Core, Worker, service와 도메인 자산의 내부 구조는 각 애드온이 소유한다.
- 호스트가 폴더 이름을 추측해 애드온 내부 구현을 직접 호출해서는 안 된다.

즉, 공통 폴더 이름은 배포와 유지보수를 위한 규칙이며 애드온 간 암묵 API가 아니다.

## 2. 표준 배포 구조

```text
<AddonRoot>/
├─ addon.json                         # MUST: Hosted manifest
├─ VERSION                            # MUST: addon.json과 같은 SemVer
├─ README.md                          # MUST: 실행·의존성·데이터·출력 안내
├─ package.json                       # 조건부: Node dependency 경계를 가진 애드온
├─ standalone-manifest.json           # 조건부: Standalone 지원
├─ electron-runtime-manifest.json     # 조건부: Electron 자동 설치
├─ runtime-manifest.json              # 조건부: Python/CUDA 등 로컬 runtime
├─ <AddonName>.bat                    # 조건부: 사용자가 실행하는 GUI launcher
├─ <AddonName>_CLI.bat                # 조건부: CLI 지원
├─ <AddonName>_MCP.bat                # 조건부: MCP 지원
├─ app/                               # 애드온 전용 Core·Worker·service
├─ electron/                          # Hosted Electron activate·IPC·preload adapter
├─ dist/renderer/                     # 배포용 renderer와 정적 자산
├─ cli/                               # CLI adapter
├─ mcp/                               # MCP adapter·protocol·tool mapping
├─ standalone/                        # 독립 Electron composition root
├─ bootstrap/                         # 배포 필수 runtime 설치·검증 코드만
├─ config/                            # 설정과 로컬 보호 저장 데이터
├─ presets/                           # 조건부: 사용자·기본 프리셋
├─ references/                        # 조건부: 참조 이미지와 portable descriptor
├─ models/                            # 조건부: 애드온 소유 모델
├─ locales/                           # 조건부: 번역 자산
├─ licenses/                          # 포함 구성 요소 고지문
├─ runtime/                           # Standalone dependency 설치 위치
├─ cache/                             # 다시 만들 수 있는 로컬 캐시
├─ logs/                              # 로컬 로그
├─ projects/                          # 조건부: 사용자 프로젝트
└─ outputs/                           # Standalone 결과; Hosted에서는 host output 사용
```

Windows launcher는 사용자가 압축 해제 직후 찾을 수 있도록 루트에 두는 예외다. 나머지 실행 코드는
역할별 디렉터리 아래에 둔다.

### 2.1 애드온 위치와 runtime 설치 위치

Standalone 애드온의 설치 위치는 고정된 절대경로가 아니라 **현재 애드온 폴더 자체**다. 사용자가
애드온 폴더를 다른 드라이브나 하위 폴더로 복사·이동하면 launcher와 bootstrap은 이동된 위치를
새 `AddonRoot`로 다시 계산해야 한다.

```text
<현재 AddonRoot>/bootstrap/ensure-electron.cmd
                    ↓ 현재 스크립트 위치의 부모를 계산
<현재 AddonRoot>/runtime/electron/

<현재 AddonRoot>/runtime manifest 또는 installer
                    ↓ 주입된 현재 application/data root를 사용
<현재 AddonRoot>/runtime/versions/<runtimeId>/
```

- launcher는 자신의 위치(`%~dp0`)를 기준으로 `bootstrap/`과 entry를 찾아야 한다.
- PowerShell bootstrap은 자신의 위치(`$PSScriptRoot`)에서 `AddonRoot`를 계산해야 한다.
- Electron, Python/CUDA와 애드온 소유 모델의 기본 설치 대상은 현재 `AddonRoot` 아래 상대경로여야 한다.
- `cwd`, 개발 워크스페이스, 이전 설치 위치, 사용자명과 드라이브 문자를 저장하거나 fallback으로
  사용해서는 안 된다.
- 애드온을 이동한 뒤 이미 설치된 로컬 runtime은 이동된 폴더에서 그대로 발견되어야 한다.
- runtime이 없는 상태에서 이동했다면 최초 실행 시 이동된 폴더 아래에 새로 설치해야 한다.
- Hosted에서는 이 standalone bootstrap을 호출하지 않고 호스트가 주입한 dependency root를 사용한다.

사용자가 runtime만 애드온 바깥에 설치하도록 선택하는 기능은 현재 표준에 포함하지 않는다. 이를
추가하려면 별도 dependency-root 설정, 이동·누락 복구와 Standalone 백업 규칙을 먼저 정의해야 한다.

## 3. 공통화 수준

| 수준 | 구성 요소 | 규칙 |
|---|---|---|
| 필수 루트 계약 | `addon.json`, `VERSION`, `README.md` | 모든 애드온이 같은 위치와 의미로 소유한다. |
| 조건부 루트 계약 | standalone·runtime manifest, launcher, `package.json` | 선언한 기능이 있을 때만 둔다. |
| 공개 adapter | `electron/`, `cli/`, `mcp/`, `standalone/` | 기능별 공개 entry와 composition root를 분리한다. |
| UI 배포물 | `dist/renderer/` | 호스트와 standalone이 같은 renderer를 사용한다. |
| 배포 bootstrap | `bootstrap/` | 시스템 의존성 없이 runtime을 설치·검증하는 코드만 둔다. |
| 비공개 구현 | `app/` | Core·Worker·service의 언어와 내부 하위 구조는 애드온이 결정한다. |
| 애드온 소유 데이터 | config·preset·reference·model·project | 호스트가 해석하지 않고 애드온이 schema와 migration을 소유한다. |
| 생성 데이터 | runtime·cache·logs·outputs | Git과 기본 배포 ZIP에서 실제 사용자 데이터를 제외한다. |

## 4. 금지되는 혼합

- 배포 애드온 안에 `tests/`, fixture, QA capture와 개발용 `tools/`를 넣지 않는다.
- `bootstrap/`에는 실행에 필요한 설치·무결성 검증 코드만 둔다. 버전 변경기, source check,
  smoke harness와 개발 자산 연결기는 로컬 개발 워크스페이스에 둔다.
- `runtime-manifest.local.json`, `dev-assets.local.*`, 자격증명, 사용자 설정과 실제 모델은 배포 Git에
  넣지 않는다.
- `app/` 아래에 Electron 창 생명주기와 MCP stdio transport를 다시 숨기지 않는다.
- 호스트는 `models/`, `presets/` 같은 폴더가 존재한다는 이유로 내용을 직접 읽지 않는다.

## 5. 대소문자와 호환성

새 애드온의 표준 폴더 이름은 소문자를 사용한다. 기존 `Models/`, `Presets/`, `References/`는 저장
schema와 사용자 경로 호환성 때문에 즉시 이름을 바꾸지 않는다. 변경하려면 구 경로 읽기,
신 경로 쓰기와 충돌 처리까지 포함한 migration을 먼저 제공한다.

## 6. 현재 애드온 차이

| 애드온 | 현재 일치 항목 | 정리 대상 |
|---|---|---|
| NaiTail | root contract·app·electron·cli·mcp·standalone·dist renderer·bootstrap | 표준 구조 적용 완료 |
| AnimaTail | root contract·app·electron·cli·mcp·standalone·dist renderer·bootstrap | 표준 구조 적용 완료 |
| CensorTail | root contract·app·electron·mcp·standalone·dist renderer·bootstrap | CLI는 제공하지 않음 |
| GalleryTail | root contract·electron·dist renderer | Hosted-only라 standalone·runtime 폴더는 만들지 않음 |

## 7. 적용 상태와 유지 Gate

다음 1차 구조 정리는 적용을 완료했다.

1. 세 Standalone 애드온의 Electron 설치 코드를 `bootstrap/`으로 분리했다.
2. source check, version setter, dev setup과 개발 테스트를 배포 애드온에서 제거했다.
3. GalleryTail에 `VERSION`을 추가하고 manifest 버전과 일치시켰다.
4. NaiTail의 공개 adapter와 renderer를 표준 위치로 옮기고 manifest·상대 import를 갱신했다.

registry 검증은 루트 계약과 manifest entry 존재만 확인하며 비공개 `app/` 구조는 검사하지 않는다.
데이터 폴더 대소문자 변경은 별도 migration이 준비될 때까지 보류한다.

각 단계는 Hosted 홈 진입·복귀, Standalone GUI·CLI·MCP, 포터블 경계와 출력 위치 검증을 통과한 뒤
완료로 본다.

Standalone 폴더 변경이 포함된 단계는 추가로 다음 위치 이동 Gate를 통과해야 한다.

1. runtime이 없는 애드온을 임의의 다른 드라이브·중첩 경로에 복사한다.
2. GUI·CLI·MCP launcher가 현재 폴더의 `bootstrap/`을 호출하는지 확인한다.
3. Electron과 Python/CUDA가 현재 폴더의 `runtime/` 아래에만 설치되는지 확인한다.
4. 설치가 끝난 애드온 폴더 전체를 다시 이동하고 기존 runtime이 새 위치에서 발견되는지 확인한다.
5. 이전 위치, 개발 워크스페이스와 호스트 runtime에 파일이 생성되지 않았는지 확인한다.
