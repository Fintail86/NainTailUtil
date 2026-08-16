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
- GalleryTail은 AnimaTail의 공개된 출력 경계를 읽으므로 `requires: ["animatail"]`를 선언한다.
- Hosted AnimaTail과 CensorTail은 NainTail이 `runtimeRoot`로 주입한 공용 Python/CUDA runtime을
  사용하며 애드온 로컬 runtime으로 fallback하지 않는다. 생성 모델·LoRA·검열 모델은 각 애드온이
  계속 소유한다.
- CensorTail이 AnimaTail 결과를 받는 기능은 선택적 artifact 연동이며
  `artifactProviders: ["animatail"]`로 선언한다.

데이터 소유권을 바꾸려면 migration과 하위 호환 계획을 먼저 문서화해야 한다.

## 4. Manifest와 공개 경계

모든 Hosted 애드온은 `naintail.addon/v1` manifest를 가져야 한다.

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

Standalone 지원 애드온의 변경은 다음 검증을 모두 통과해야 완료로 본다.

1. 애드온 폴더만 임시 경로에 복사한다.
2. 부모 NainTailUtil과 시스템 Node/Python 없이 GUI를 기동한다.
3. 선언된 CLI·MCP entry를 실제로 초기화한다.
4. 모든 runtime/resource/data 경로가 복사된 애드온 폴더 안에서 해결되는지 확인한다.
5. 설정·출력 생성 후 폴더를 다시 이동해 상대경로 복원이 되는지 확인한다.

Hosted 변경은 다음 검증을 모두 통과해야 완료로 본다.

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
