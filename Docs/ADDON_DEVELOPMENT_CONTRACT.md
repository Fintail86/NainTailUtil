# NainTailUtil 애드온 개발 계약

- 상태: 정식 개발 계약
- 적용일: 2026-08-15
- 적용 대상: NainTail host와 `NainTailUtil/Addons/` 아래의 모든 내장·외부 애드온
- 규범 용어: `반드시(MUST)`, `금지(MUST NOT)`, `권장(SHOULD)`은 구현·검증 Gate의 의미를 가진다.

## 1. 계약의 목적

NainTail 애드온은 하나의 코드베이스로 다음 두 실행 형태를 모두 지원한다.

1. **Standalone**: 애드온 폴더 하나만 복사해 독립 포터블 유틸로 실행한다.
2. **Hosted**: 애드온을 NainTail 홈에 장착해 호스트가 제공하는 실행 환경과 공용 의존성을 사용한다.

두 형태는 별도 제품이나 별도 기능 구현이 아니다. 같은 Core, Worker, UI와 저장 schema를 서로
다른 composition root로 조립하는 방식이다. Standalone은 독립성을 보장하고, Hosted는 호스트의
통합 실행 환경과 의존성 정책을 따른다.

## 2. 절대 원칙

### 2.1 독립 실행 보장

Standalone을 지원한다고 선언한 애드온은 반드시 다음 조건을 만족해야 한다.

- 애드온 폴더 하나만 다른 Windows 경로로 복사해 실행할 수 있어야 한다.
- 지원한다고 선언한 GUI·CLI·MCP entry와 launcher를 애드온 폴더 안에 가져야 한다.
- 실행에 필요한 Electron, Python/CUDA, 모델, 라이선스와 정적 자산을 애드온 경계 안에서
  해결해야 한다. 단, 해당 애드온 기능에 필요하지 않은 런타임은 요구하지 않는다.
- 로컬 Electron이 빠진 Standalone 패키지는 Windows 기본 PowerShell 부트스트랩으로 애드온이
  고정한 공식 Electron ZIP을 내려받아 크기와 SHA-256을 검증한 뒤 `runtime/electron/`에
  설치하고 원래 entry 실행을 계속해야 한다. 부트스트랩 자체가 시스템 Node나 다른 애드온에
  의존해서는 안 된다.
- 시스템 Node, 시스템 Python, 전역 패키지, 사용자 `PATH`, 개발 워크스페이스와 부모
  NainTailUtil 폴더를 실행 전제로 삼아서는 안 된다.
- Standalone 실행 시 애드온 폴더가 기본 application root이자 data root다.
- 설정, 프리셋, 캐시와 로그는 애드온 폴더 안의 상대경로로 저장해야 하며, 출력은
  `<AddonRoot>/outputs/`에 저장해야 한다.

Standalone 전용 코드는 Core나 Worker를 복제하지 않고 진입점 조립, 경로 주입, 창 생명주기만
담아야 한다.

### 2.2 호스트 결합 규칙

Hosted 실행에서는 NainTail host가 composition root다. 애드온은 반드시 다음 규칙을 따른다.

- 호스트가 Electron process, 애드온 registry, 창 생명주기, 홈 이동과 공용 service 주입을 소유한다.
- 애드온은 자기 폴더의 standalone launcher나 전용 Electron executable을 다시 실행해서는 안 된다.
- 호스트가 주입한 service와 dependency가 있으면 애드온 내부의 동종 자산보다 우선 사용해야 한다.
- 호스트가 제공한다고 선언한 필수 dependency가 없거나 유효하지 않으면 명시적으로 로드 실패해야
  한다. 조용히 시스템 전역 설치나 임의의 로컬 자산으로 우회해서는 안 된다.
- 호스트는 도메인 로직을 흡수하지 않는다. NAI, Anima 생성, 갤러리와 검열의 의미는 각 애드온이
  계속 소유한다.

즉, Hosted의 실행 우선순위는 다음과 같다.

```text
호스트가 주입한 service/dependency
        ↓ 없을 때만
manifest가 Hosted fallback을 명시적으로 허용한 애드온 자산
        ↓ 둘 다 없으면
명시적 로드 실패
```

Standalone의 실행 우선순위는 다음과 같다.

```text
애드온 폴더 안의 standalone runtime/resource/data root
        ↓ 없으면
명시적 실행 실패
```

시스템 전역 설치나 개발 PC 절대경로는 어느 실행 형태에서도 fallback이 아니다.

### 2.3 의존성의 이중화와 선택

애드온 폴더 안의 runtime과 resource는 Standalone 보장을 위한 정식 자산이다. Hosted에서 같은
종류의 자산을 호스트가 제공하더라도 로컬 사본은 삭제하지 않는다. 대신 실행 시 어느 자산을
선택할지만 composition root가 결정한다.

- Standalone: 애드온 로컬 dependency를 사용한다.
- Hosted: 호스트 dependency를 먼저 사용한다.
- Hosted에서 로컬 fallback이 필요하면 manifest 계약에 명시하고, 진단 상태에 실제 선택 출처를
  노출해야 한다.
- 버전이 다른 두 dependency를 조용히 혼용해서는 안 된다.
- dependency를 선택한 뒤에는 해당 작업의 전체 생명주기 동안 같은 출처를 유지해야 한다.

이 규칙은 중복 파일의 존재를 허용하지만, 실행 중 서로 다른 runtime이나 모델이 우연히 섞이는
것은 허용하지 않는다.

### 2.4 런타임 의존성 버전 변경 주의사항

Python, PyTorch, CUDA, ONNX Runtime 또는 그 밖의 실제 실행 의존성 구성이 바뀌는 애드온
업데이트는 기존 runtime을 그대로 재사용할 수 있다고 가정해서는 안 된다.

- 배포 결과나 호환성에 영향을 주는 runtime 의존성 구성이 바뀌면 새로운 `runtimeId`를 발급해야
  한다. 이미 공개한 `runtimeId`의 내용을 다른 구성으로 덮어쓰는 것은 금지한다.
- 애드온의 `runtime-manifest.json`이 요구하는 `runtimeId`와 설치된 runtime을 실행 전에 대조하고,
  일치하는 버전이 없으면 신규 runtime 설치가 필요하다고 명시적으로 보고해야 한다.
- 신규 runtime은 `runtime/versions/<runtimeId>/`에 기존 버전과 병렬 설치한다. 업데이트와 롤백을
  위해 구버전을 즉시 덮어쓰거나 자동 삭제하지 않는다.
- Hosted에서는 호스트가 주입한 runtime root 안에서 애드온 manifest가 요구하는 정확한
  `runtimeId`를 선택하고, Standalone에서는 애드온 로컬 runtime root에서 같은 규칙을 적용한다.
- 구 runtime 정리는 어떤 설치된 애드온 버전도 해당 `runtimeId`를 요구하지 않는다는 사실을
  확인한 뒤에만 수행한다. 자동 정리 기능을 추가하기 전까지는 사용자가 명시적으로 요청하지
  않은 구 runtime을 보존한다.
- 실제 runtime 구성이 처음 변경되는 릴리즈부터 설치·전환·롤백과 구버전 공존을 별도 Gate로
  검증한다.

현재 동일한 `runtimeId`를 요구하는 릴리즈에는 추가 migration이 필요하지 않다. 이 항목은 실제
의존성 구성이 달라지는 첫 업데이트에서 누락되기 쉬운 호환성 경계를 미리 고정하기 위한
주의사항이다.

### 2.5 물리적 컴포넌트 저장소 도입 검토 조건

현재 Hosted 런타임 캐시는 Python·PyTorch·CUDA/cuDNN의 호환 조합을 하나의 기반 환경 폴더로
저장한다. DiffSynth와 ONNX Runtime 같은 애드온 계층은 별도 component ID와 설치 마커를 갖지만,
실제 Python 패키지는 선택한 기반 환경에 추가된다. 따라서 논리적 component ID와 물리적 폴더는
현재 1:1 관계가 아니다.

새 애드온이 CUDA 13.0처럼 기존 기반과 호환되지 않는 조합을 요구하면 새 기반 `runtimeId`와
별도 환경 폴더를 생성한다. 이 방식은 ABI와 DLL 충돌을 격리하는 대신 같은 Python 파일과 일부
패키지가 환경별로 중복될 수 있다.

다음 조건 중 하나가 현실화되면 Python, PyTorch, CUDA와 애드온 계층을 물리적으로 분리한
component 저장소 및 실행 시점 runtime resolver 도입을 별도 설계 항목으로 검토한다.

- 서로 호환되지 않는 PyTorch/CUDA 기반 조합을 두 종류 이상 지속적으로 지원한다.
- 기반 환경 중복이 배포 용량, 로컬 저장 공간 또는 보안 업데이트 비용에 실질적인 문제가 된다.
- 하나의 component를 여러 기반 환경에서 독립적인 생명주기와 버전으로 재사용해야 한다.

물리적 component 구조를 도입할 때는 `PATH`·`PYTHONPATH`와 Windows DLL 검색 순서, Python ABI,
PyTorch/CUDA 호환 행렬, 무결성 검증, 원자적 설치·롤백 및 Standalone 완결성을 함께 해결해야 한다.
이는 현재 구현된 기능이나 공개 호환성 약속이 아니라 향후 확장 주의사항이다.

## 3. 루트와 데이터 소유권

`application root`, `data root`, `dependency root`, `output root`는 서로 다른 개념이며 하나의 전역변수로
뭉개서는 안 된다.

- **application root**: 애드온 코드와 정적 자산의 기준 경로
- **data root**: 설정, 프리셋, 프로젝트, 참조 이미지, 캐시와 로그의 기준 경로
- **dependency root**: 선택된 Electron/Python/CUDA/모델 등 실행 의존성의 기준 경로
- **output root**: 최종 결과 파일 쓰기와 탐색의 기준 경로

Standalone에서는 기본적으로 네 루트가 모두 애드온 폴더 안을 가리키며 output root는
`<AddonRoot>/outputs/`다. Hosted에서도 application root와 data root는 애드온 폴더를 유지하고,
호스트는 dependency root, 공용 service와 `<NainTailRoot>/outputs/<addonId>/` output root를
명시적으로 주입한다. 애드온은 `cwd`, 부모 디렉터리 추측, 실행 파일 위치의 우연한 관계로 루트를
계산해서는 안 된다. 상세 경로와 검증은
[`ADDON_OUTPUT_CONTRACT.md`](ADDON_OUTPUT_CONTRACT.md)를 따른다.

데이터의 schema, migration과 쓰기 규칙은 해당 도메인 애드온이 소유한다. 호스트가 data root나
파일 service를 제공해도 도메인 데이터를 직접 해석하거나 임의로 수정하지 않는다.

현재 데이터와 출력 소유권은 다음과 같이 고정한다.

- NaiTail과 AnimaTail의 설정·프리셋·참조·캐시 데이터는 Hosted와 Standalone 모두 각 애드온
  폴더 안에 저장한다.
- Standalone 출력은 각 애드온의 `outputs/`, Hosted 출력은 NainTail의
  `outputs/<addonId>/`에 저장한다.
- NaiTail, AnimaTail과 CensorTail은 각각 자신의 모델, 설정과 데이터 경계를 소유하며 다른
  애드온이 없어도 독립 실행되어야 한다. AnimaTail과 CensorTail의 Standalone 패키지는 각자
  포터블 Python/CUDA runtime을 포함한다.
- GalleryTail은 특정 생성 애드온에 종속되지 않으며 `requires`를 비워 둔다. Hosted에서는
  `outputRootScope: "host"`로 주입된 공용 출력 루트와 호스트가 명시적으로 공개한 Standalone
  애드온별 포터블 출력 경로를 탐색한다.
- Hosted AnimaTail과 CensorTail은 각 애드온 폴더의 `hosted-runtime-requirements.json`에
  자신이 요구하는 런타임 ID 목록을 선언한다. NainTail은 `runtimeRoot`만 제공하며 특정
  "공용 런타임 구성"이나 애드온 전체의 합집합을 정의하지 않는다.
- 호스트 런타임 캐시는 요청된 ID와 무결성이 이미 설치되어 있을 때만 해당 항목을 건너뛴다.
  AnimaTail과 CensorTail이 같은 Python·PyTorch·CUDA 기반 ID를 요청하면 그 기반만 재사용하고,
  DiffSynth 생성 계층과 ONNX Runtime 검열 계층은 해당 애드온을 처음 실행할 때 각각 별도로
  설치한다. 먼저 실행한 애드온 때문에 다른 애드온 전용 계층을 선제 설치해서는 안 된다.
- Standalone에서는 각 애드온의 `runtime-manifest.json`과 자체 `runtime/`만 사용하며 완전한
  실행 환경을 개별 설치한다. 생성 모델·LoRA·검열 모델도 각 애드온이 계속 소유한다.
- CensorTail이 AnimaTail 결과를 받는 기능은 선택적 artifact 연동이며
  `artifactProviders: ["animatail"]`로 선언한다.

데이터 소유권을 바꾸려면 migration과 하위 호환 계획을 먼저 문서화해야 한다.

## 4. Manifest와 공개 경계

모든 Hosted 애드온은 `naintail.addon/v1` manifest를 가져야 한다.
공통 루트 파일, 공개 adapter, bootstrap과 데이터 폴더의 배치 규칙은
[`ADDON_DIRECTORY_STANDARD.md`](ADDON_DIRECTORY_STANDARD.md)를 따른다. 이 디렉터리 표준은
manifest entry를 대체하지 않으며, 호스트가 애드온 내부 경로를 추측할 권한을 부여하지 않는다.

- `entries`는 호스트가 호출할 진입점만 공개한다.
- `requires`는 로드 전에 존재해야 하는 애드온 ID를 선언한다.
- `artifactProviders`는 해당 애드온이 선택적으로 받을 수 있는 artifact provider ID를 선언한다.
  provider가 없더라도 소비 애드온의 발견·기동·고유 기능을 막지 않는다.
- 애드온 간 파일 공유는 호스트의 `resolveAddonDirectory`처럼 명시적으로 주입된 resolver를 통해
  제공자 루트를 얻은 뒤, 제공자가 문서화한 공개 하위 경로만 사용한다.
- 소비자는 `../AnimaTail` 같은 상대경로, 폴더 이름 추측이나 개발 PC 절대경로로 제공자를 찾아서는
  안 된다.
- `requires`는 제공 애드온의 존재만 보장한다. 특정 runtime/model/API의 버전 호환은 소비 애드온이
  별도로 검사하고 오류를 설명해야 한다.
- `artifactProviders`는 artifact 접근 권한만 부여하며 runtime, 모델 또는 파일 경로 공유 권한으로
  사용해서는 안 된다.

Standalone 지원 애드온은 추가로 `naintail.addon-standalone/v1` manifest를 가져야 한다.
이 manifest는 standalone Electron과 GUI·CLI·MCP launcher, data root를 애드온 상대경로로
기록한다. Electron 자동 설치를 제공하는 경우 `electronBootstrap`과
`electronRuntimeManifest`도 기록한다. 선언한 파일이 빠진 패키지는 포터블 애드온으로
간주하지 않는다.

향후 dependency export/import schema가 추가되기 전까지 `requires`, `artifactProviders`와 host
resolver가 정식 애드온 간 연동 경계다. 새 공유 경로를 암묵적으로 추가하지 않는다.

Standalone 지원 애드온은 애드온 루트의 `VERSION`, `addon.json`, `package.json`에 같은 SemVer를
기록하고 독립적으로 변경한다. NaiTail, AnimaTail과 CensorTail의 초기 공개 기준 버전은 모두
`0.1.0`이다. 한 애드온의 버전 변경이 다른 애드온의 버전 변경을 강제해서는 안 된다.

### 독립 릴리즈 계약

NainTail 호스트와 각 애드온은 다음 태그 namespace로 별도 릴리즈한다.

- `host-vX.Y.Z`
- `naitail-vX.Y.Z`
- `animatail-vX.Y.Z`
- `gallerytail-vX.Y.Z`
- `censortail-vX.Y.Z`

한 릴리즈에는 해당 컴포넌트 ZIP, 그 시점의 전체 `official-addons.json`과 최신 호스트를 가리키는
`official-host.json`만 필수 자산으로 둔다.
다른 컴포넌트의 ZIP을 다시 만들거나 같은 버전으로 올리지 않는다. ZIP 파일명은
`<ComponentName>-vX.Y.Z-win-x64.zip`이며 카탈로그에는 각 애드온의 실제 `releaseTag`, 파일명,
크기와 SHA-256을 기록한다. 호스트 버전은 애드온 카탈로그 버전을 변경하지 않는다.

애드온 릴리즈를 준비할 때는 그 애드온 항목만 새 메타데이터로 바꾸고 `catalogVersion`을
증가시킨다. 나머지 항목은 마지막 공개 릴리즈를 그대로 가리킨다. 카탈로그 변경은 실제 자산
게시와 함께 승격해야 하며 아직 게시하지 않은 태그를 내장 기본 카탈로그에 먼저 확정하지 않는다.

호스트 릴리즈를 준비할 때는 완성된 호스트 ZIP의 크기와 SHA-256으로 별도
`naintail.official-host/v1` manifest를 만든다. 자기 ZIP의 hash를 호스트 ZIP 내부에 넣는 순환
참조를 만들지 않으며, `official-host.json`은 릴리즈 자산과 마지막 정상 캐시로만 배포한다.
호스트 업데이트는 사용자가 승인한 뒤 외부 updater가 실행 중인 호스트의 종료를 기다리고
프로그램 파일만 교체한다. **설치 루트는 이동·삭제하지 않으며 그 폴더가 현재 작업 경로인
BAT/CMD/PowerShell에서도 업데이트와 재실행이 가능해야 한다.** `Addons/`, `config/`,
`outputs/`, `runtime/`은 읽기·이동·덮어쓰기 대상에서 제외하고 제자리에 둔다.

프로그램 파일 목록과 진행 상태는 제품 폴더 바깥 transaction marker에 기록한다.
코드만 완전히 백업한 후 인접 임시 파일을 통한 원자적 파일 교체를 수행한다.
중단 시 유지된 staging으로 재개하고, 적용 실패 시 코드 백업으로 롤백한다.
사용자 데이터 이동으로 보존을 구현하거나 실행 작업 경로를 상위 폴더로 변경해 우회하지 않는다.
기존 폴더 교체 방식에서 이미 중단된 transaction만 호환 복구 경로로 처리한다.

회귀검증에는 설치 루트 내부 실행, 실제 BAT 복구 분기 이후 실행 재개, 설치·사용자 디렉터리
식별자 유지, 부분 백업·적용·롤백 중단 복구를 포함한다. 기존 0.1.5 이하 적용기는 새 ZIP을
받아도 기존 스크립트를 먼저 실행하므로 수정된 적용기 배포 또는 명시적인 일회 복구가 필요하다.

MCP entry를 선언하는 애드온은 추가로
[`ADDON_MCP_PROFILE.md`](ADDON_MCP_PROFILE.md)를 따라야 한다. 상태·discovery·비동기 job·결과
형식은 공통 Profile에 맞추고, Prompt·생성·갤러리·검열 같은 도메인 입력은 애드온 확장 schema로
소유한다. 기존 공개 도구명은 Profile의 호환성 규칙에 따라 adapter canonical operation과
명시적으로 mapping한다.

## 5. Service 주입 계약

호스트 service는 좁고 도메인 중립적이어야 한다. 현재 허용되는 범주는 다음과 같다.

- Electron dialog, shell, safeStorage와 제한된 IPC
- 애드온 창 조회, 홈 전환과 lifecycle event
- 등록된 애드온 directory/dependency resolve
- 명시적 addon-to-addon handoff와 broadcast

애드온은 주입받은 service를 전역 singleton으로 다시 감추지 말고, entry에서 하위 adapter로
전달해야 한다. Core와 Worker는 호스트 객체나 Electron API를 직접 참조해서는 안 된다.

호스트 API가 추가될 때는 최소 두 애드온에서 실제로 반복된 요구인지 확인한다. 한 애드온만의
도메인 편의를 위해 호스트가 그 기능의 의미를 알아서는 안 된다.

## 6. 기능 동일성과 실패 정책

- 같은 입력과 dependency version을 사용하면 Standalone과 Hosted의 Core 해석 결과가 같아야 한다.
- 실행 형태에 따른 차이는 경로, lifecycle, 공용 service와 dependency 출처로 제한한다.
- Hosted 전용 기능은 호스트 handoff처럼 호스트가 있어야만 성립하는 기능에 한정하고 UI에서
  가용 여부를 명확히 표시한다.
- dependency 부족, 버전 불일치, 무결성 실패는 사용자에게 실제 선택 출처와 함께 보고한다.
- 기능을 살리기 위해 검증되지 않은 시스템 dependency로 자동 전환하지 않는다.

## 7. 패키징과 검증 Gate

일반 개발의 완료 조건은 [TESTING.md](TESTING.md)의 변경 영향 범위 개발 테스트다.
관련 기능·코어·테스트·실행 환경이 그대로인 기존 통과 항목은 재실행하지 않는다.
아래 패키징·전체 런타임·실기동 Gate는 **배포 또는 릴리즈 준비 작업에만** 적용하고,
그 외 작업에서는 스킵한다. 해당 실행 로직 자체를 수정한 경우의 개발 테스트는 별개다.

Standalone 지원 애드온의 릴리즈 준비는 다음 검증을 모두 통과해야 완료로 본다.

1. 애드온 폴더만 임시 경로에 복사한다.
2. 부모 NainTailUtil과 시스템 Node/Python 없이 GUI를 기동한다.
3. 선언된 CLI·MCP entry를 실제로 초기화한다.
4. 모든 runtime/resource/data 경로가 복사된 애드온 폴더 안에서 해결되는지 확인한다.
5. 설정·출력 생성 후 폴더를 다시 이동해 상대경로 복원이 되는지 확인한다.

Hosted 릴리즈 준비는 다음 검증을 모두 통과해야 완료로 본다.

1. 호스트 홈에서 애드온을 발견하고 연다.
2. 홈으로 돌아간 뒤 같은 애드온에 재진입하며 renderer와 큐 상태를 보존한다.
3. `requires` 누락 시 애드온을 실행하지 않고 누락 ID를 표시한다.
4. 호스트 dependency와 애드온 로컬 dependency가 함께 있을 때 호스트 쪽이 선택되는지 확인한다.
5. 선택된 dependency 출처가 status/diagnostic에서 확인되는지 검증한다.
6. 호스트 dependency가 손상됐을 때 금지된 시스템/로컬 암묵 fallback 없이 실패하는지 확인한다.
7. 최종 출력이 NainTail `outputs/<addonId>/`에만 기록되고 다른 namespace를 벗어나지 않는지 확인한다.

현재 Standalone 지원 선언은 NaiTail, AnimaTail과 CensorTail에 적용된다. CensorTail은 GUI·MCP,
NaiTail과 AnimaTail은 GUI·CLI·MCP를 지원한다. GalleryTail을 독립 포터블로 배포하려면 이 계약의
standalone manifest, launcher, 로컬 dependency, output root와 위 Gate를 먼저 충족해야 한다.

## 8. 변경 관리

- 이 문서는 애드온 구조에 관한 권위 문서다. README나 구현 메모가 충돌하면 이 계약을 우선한다.
- 계약 변경은 코드 변경과 분리해 이유, 호환성 영향, migration과 검증 항목을 먼저 기록한다.
- 기존 애드온을 계약에서 예외 처리할 때는 대상, 이유와 제거 조건을 이 문서에 명시한다.
- 새로운 애드온은 기능 구현 전에 Standalone 지원 여부, Hosted dependency, 데이터 소유자와 공개
  entry를 먼저 결정한다.

핵심 계약은 한 문장으로 요약된다.

> 애드온은 혼자서 완전한 포터블 유틸이어야 하며, NainTail에 장착된 순간부터는 같은 기능을
> 호스트가 주입한 실행 환경과 의존성으로 조립해 동작해야 한다.
