# 테스트 소유권과 실행 정책

적용일: 2026-09-18. 현재 허브와 모든 애드온의 공통 테스트 정책이다.
과거 작업 기록의 전체 `npm run check` 안내보다 이 문서를 우선한다.

## 폴더와 소유권

```text
Tests/
  Hub/{development,release}/
  NaiTail/{development,release}/
  AnimaTail/{development,release}/
  GalleryTail/{development,release}/
  CensorTail/{development,release}/
Tools/testing/                 # 실행기, 영향 범위 목록
Artifacts/testing/             # 이전 통과 지문과 이동 기록; 배포 제외
```

허브는 discovery, lifecycle, 설치·갱신, 공용 출력 경계와 애드온 간 federation을 소유한다.
각 애드온은 자기 기능·코어·renderer·worker 테스트를 소유한다. 두 영역을 함께 확인하는
테스트는 계약 소유자(주로 Hub)에 한 번만 두고 입력 의존성을 양쪽에 선언한다.
혼합 파일의 배포·런타임 검증은 `release/`로 분리한다. Python 테스트도 해당 애드온의
`development/`에 두며 제품 폴더 안에는 테스트를 두지 않는다.

## 개발 테스트

수정 기능과 영향받는 코어·소비자 경로만 실행한다. 관련 없는 기존 통과 항목은 스킵한다.
공용 코어 변경이면 해당 코어를 사용하는 테스트까지 넓힌다. 애드온 간 계약을 바꾸지 않았다면
다른 애드온 전체 검증으로 넓히지 않는다. 문서·주석 변경에 무관한 기능 회귀검증은 불필요하다.

```powershell
# 이번 작업에서 수정한 파일만 지정 (쉼표로 여러 파일 지정 가능)
npm test -- --files NainTailUtil/Addons/NaiTail/app/core/character-prompt.cjs
# 소유 범위와 검증 항목을 직접 지정
npm test -- --scope NaiTail --suite character-limits
# 실행하지 않고 선택/스킵 사유 확인
npm test -- --scope NaiTail --suite character-limits --list
# 기본값: Git의 미커밋 변경 영향 범위, 개발 테스트만
npm run check
# 수정 파일의 구문만 확인 (이전 통과 지문이 같으면 재사용)
npm run check:syntax -- --files NainTailUtil/Addons/NaiTail/dist/renderer/app.js
# 해당 컴포넌트 전체 회귀검증이 필요한 경우에만
npm run test:dev -- --scope NaiTail --all
```

`--scope`는 필터이며 전 범위 실행 요청이 아니다. 테스트 실행기는 상대경로 import/require의
전이 의존성과 `Tools/testing/catalog.cjs`의 추가 입력(문자열로 읽는 UI, 동적 adapter 등)을
사용한다. 새 동적 의존성이나 파일 읽기를 추가하면 같은 작업에서 목록도 갱신한다.
영향 분석이 불확실하면 `--suite`로 관련 테스트를 추가한다. `--files`는 Git 결과 대신 이번
작업의 명시적 파일 목록을 사용한다. 이미 커밋한 변경도 이 방식으로 지정할 수 있다.

통과 기록은 테스트·의존 소스·추가 입력·실행기·실행 환경 지문과 함께 저장한다. 관련 입력이
그대로면 `REUSE PASS`로 이전 기록을 사용하고, 바뀌었거나 기록이 없으면 선택된 항목만 실행한다.
실패는 통과 기록으로 저장하지 않는다. 무관한 항목은 기록 유무와 관계없이 선택하지 않는다.
Git에서 제외된 로컬 테스트·도구를 바꿨으면 반드시 `--files` 또는 `--suite`를 지정한다.
외부 환경의 변화로 재검증이 필요하면 `--force`를 명시한다. 이 옵션도 선택 범위를 넓히지는 않는다.

Python 테스트는 해당 애드온의 설치된 전용 런타임을 사용한다. 해당 테스트가 선택됐는데
런타임이 없으면 `BLOCKED`로 보고하며, 시스템 Python 우회나 자동 설치는 하지 않는다.

## 릴리즈 테스트

배포·릴리즈 준비 요청이 없는 작업에서는 항상 스킵한다. 개발 기능 변경의 완료 조건이 아니다.
배포 대상 컴포넌트만 선택하고, 실제 배포물·런타임 구성에 대한 검증은 이전 통과 기록으로
생략하지 않는다. 릴리즈에서는 대상 개발 회귀검증과 아래 배포 검증을 별도로 기록한다.

```powershell
# 명시적 릴리즈 준비일 때만 실행
npm run test:release -- --release-prep --scope NaiTail
# 허브 배포 준비
npm run test:release -- --release-prep --scope Hub
# 실행 없이 릴리즈 검사 목록만 보기
npm run test:release -- --scope AnimaTail --list
```

`--release-prep`가 없으면 릴리즈 명령은 스킵 메시지만 출력한다. 이 플래그는 사용자에게
새 승인을 요구하는 장치가 아니라 이미 요청된 릴리즈 준비 단계를 명시하는 실행 옵션이다.
`npm run check:portable`도 같은 규칙을 따른다. 개발 도중 이를 붙여 우회 실행하지 않는다.

| 범위 | 개발 | 릴리즈 준비 |
|---|---|---|
| Hub | registry, federation, lifecycle, updater 로직, 출력 경계 | 공식 catalog/버전, 배포 파일, 포터블 복사·기동, 통합 패키지 |
| NaiTail | 모델·캐릭터, payload, 큐·저장, MCP, renderer | 버전·entry·패키지, standalone/hosted 기동·상대경로 복원 |
| AnimaTail | worker 시작·종료, 모델 경로, adapter | 패키지·전용 런타임·지원 자산, standalone/hosted 실기동 |
| GalleryTail | 폴더 탐색·출력 설정 | 패키지·entry, 호스트 연결과 배포 기동 |
| CensorTail | 편집 설정·대상 모드·드롭, MCP, 마스크 Python | 패키지·런타임·모델, standalone/hosted 실기동 |

CLI 자동 테스트가 수동 GUI·GPU·이동 후 재기동 검증을 대신하지 않는다.
`ADDON_DEVELOPMENT_CONTRACT.md` 7장의 복사·기동·이동 검증은 해당 컴포넌트의 릴리즈
체크리스트다. 자동 항목과 수동 항목을 모두 수행한 경우에만 전체 릴리즈 검증 통과로 보고한다.

## 보존과 보고

이동으로 기존 테스트 케이스를 삭제하거나 실패 조건을 완화하지 않는다. 테스트 소스는 로컬
개발 폴더에서 관리하던 기존 Git 정책을 유지한다. 이미 Git에 있던 CensorTail 테스트 네 개는
이동한 위치에도 추적되도록 예외를 둔다. 통과 캐시와 런타임·생성 결과는 Git에 넣지 않는다.

결과에는 이번 실행, 이전 통과 재사용, 범위 밖 스킵, 릴리즈 단계 스킵, 실패/환경 차단을
구분한다. 릴리즈를 스킵한 개발 작업에서 배포 준비 완료라고 보고하지 않는다.
