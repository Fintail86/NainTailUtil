# NainTailUtil 애드온 출력 위치 계약

- 상태: 정식 개발 계약
- 적용일: 2026-08-16
- 적용 대상: NainTail host와 출력 파일을 생성하거나 탐색하는 모든 애드온
- 상위 계약: [`ADDON_DEVELOPMENT_CONTRACT.md`](ADDON_DEVELOPMENT_CONTRACT.md)

## 1. 핵심 규칙

애드온의 최종 출력 위치는 실행 형태에 따라 다음처럼 결정한다.

```text
Standalone: <AddonRoot>/outputs/
Hosted:     <ConfiguredHostOutputRoot>/<addonId>/
```

Standalone에서는 애드온 폴더 하나만 복사해도 출력이 함께 이동해야 한다. Hosted에서는 모든
애드온의 최종 출력물을 NainTail이 관리하는 공용 출력 폴더 아래에서 통합 관리하되, manifest의
안정된 소문자 `addonId`로 하위 폴더를 분리한다.

공용 출력 폴더의 기본값은 `<NainTailRoot>/outputs/`다. 사용자가 홈 화면에서 다른 절대경로를
선택하면 NainTail은 `<NainTailRoot>/config/output-settings.json`에 그 경로를 저장하며 Electron,
CLI와 MCP composition root가 모두 같은 설정을 읽는다. 경로 변경은 기존 출력물을 이동하지 않고,
실행 중이던 애드온 runtime을 닫은 뒤 다음 활성화·작업부터 적용한다.

이 규칙은 최종 출력물에만 적용한다. 애드온의 설정, 프리셋, 프로젝트, 참조 이미지, 캐시,
로그, runtime과 모델은 별도 계약이 없는 한 기존 애드온 data/dependency root에 남는다.

## 2. 애드온별 경로

| 애드온 | Standalone | Hosted |
|---|---|---|
| NaiTail | `<NaiTailRoot>/outputs/` | `<HostOutputRoot>/naitail/` |
| AnimaTail | `<AnimaTailRoot>/outputs/` | `<HostOutputRoot>/animatail/` |
| GalleryTail | 자체 출력 없음 | `<HostOutputRoot>/animatail/`을 읽음 |
| CensorTail | `<CensorTailRoot>/outputs/censored/` | `<HostOutputRoot>/censortail/censored/` |

NaiTail의 `single/`, `multi/`, `artist-study/` 같은 모드 하위 구조와 AnimaTail의 생성 결과 구조는
각 애드온이 계속 소유한다. 호스트는 `<addonId>/` 아래의 도메인별 하위 구조를 해석하지 않는다.

## 3. Root 주입 계약

애드온 entry가 구분해야 할 루트는 다음 네 가지다.

- **application root**: 애드온 코드와 정적 자산
- **data root**: 설정, 프리셋, 프로젝트, 참조 이미지, 캐시와 로그
- **dependency root**: 선택된 Electron, Python/CUDA, 모델과 실행 의존성
- **output root**: 최종 결과 파일을 쓰고 탐색하는 경계

Composition root는 절대경로로 정규화된 `outputRoot`를 애드온 entry에 명시적으로 주입해야 한다.
애드온은 `hostRoot`, `cwd`, 실행 파일 위치 또는 `../` 상대경로로 출력 위치를 추측해서는 안 된다.

- Standalone entry는 `<AddonRoot>/outputs/`를 주입한다.
- NainTail Electron, CLI와 MCP composition root는
  `<HostOutputRoot>/<addonId>/`를 동일하게 주입한다.
- GalleryTail처럼 다른 애드온 출력을 읽는 소비자는 폴더 이름을 추측하지 않고 호스트의
  `resolveAddonOutputRoot(addonId)` service를 사용한다.

## 4. 경로와 공개 안전성

- 모든 쓰기, 폴더 열기, 파일 위치 표시와 휴지통 작업은 주입된 `outputRoot` 경계 안에서만 허용한다.
- 애드온이 받는 상대경로는 정규화한 뒤 절대경로, 빈 경로와 `..` 경계 이탈을 거부한다.
- Standalone 결과는 애드온 폴더 이동 후에도 복원 가능한 상대경로를 사용한다.
- Hosted GUI는 실제 파일 작업에 내부 절대경로를 사용할 수 있지만 renderer에 불필요하게 노출하지
  않는다.
- Hosted MCP는 절대경로를 공개 응답에 싣지 않고 NainTail session `artifactRef`를 우선 사용한다.
- 출력 metadata와 artifact provider는 실제로 선택된 `outputRoot`를 기준으로 검증한다.

## 5. 기존 출력과 전환 정책

새 규칙 적용 전에 애드온 폴더에 생성된 파일은 자동으로 이동하거나 삭제하지 않는다. 구현 전환
후 새 Hosted 작업은 호스트 output root에만 기록한다. 기존 파일을 읽어야 할 때는 명시적인 legacy
조회 또는 사용자가 선택한 migration을 제공할 수 있지만, 새 경로와 기존 경로에 같은 결과를
이중 기록해서는 안 된다.

Standalone 출력 구조는 바뀌지 않으므로 애드온 폴더 단독 복사 호환성은 유지한다.

## 6. 구현 순서

1. NainTail Electron·CLI·MCP composition root에 공통 `outputRoot` 계산과 주입을 추가한다.
2. NaiTail `OutputStore`를 data root와 output root가 분리된 형태로 변경한다.
3. AnimaTail 생성 Worker 요청에 output root를 명시하고 결과 경로 검증 기준을 맞춘다.
4. CensorTail 저장 service와 MCP artifact publisher가 주입된 output root를 사용하게 한다.
5. GalleryTail이 AnimaTail 폴더가 아니라 호스트가 공개한 AnimaTail output root를 탐색하게 한다.
6. GUI 폴더 열기·위치 표시·휴지통과 MCP artifactRef를 두 실행 형태에서 검증한다.

## 7. 완료 Gate

- Standalone 애드온 폴더만 복사한 뒤 생성한 결과가 복사된 폴더의 `outputs/` 아래에 있어야 한다.
- Hosted GUI·CLI·MCP 결과가 모두 NainTail `outputs/<addonId>/` 아래에 있어야 한다.
- NainTail federation MCP의 NaiTail·AnimaTail 생성/대기 종단 스모크가 선택된
  `<HostOutputRoot>/<addonId>/`에 실제 파일을 만들고 애드온 로컬 출력에는 이중 기록하지 않아야 한다.
- Hosted 생성 후 애드온 폴더의 `outputs/`에는 같은 결과가 새로 생기지 않아야 한다.
- 한 애드온이 다른 애드온 namespace에 쓰거나 파일 작업을 수행할 수 없어야 한다.
- GalleryTail은 Hosted AnimaTail 출력을 조회하고 설정 handoff를 유지해야 한다.
- CensorTail 결과 artifactRef는 CensorTail namespace를 가리키고 원본 artifactRef와 혼동되지 않아야 한다.
- 기존 자동 테스트, 포터블 검사와 실제 Standalone/Hosted smoke를 모두 통과해야 한다.
