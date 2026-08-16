# NainTailUtil 포터블 제품

NainTail 애드온 호스트와 내장 애드온을 함께 담은 포터블 Windows 제품 폴더다. NainTail은
애드온을 발견해 홈에 표시하고 GUI·CLI·MCP entry를 실행하는 관리 계층이며, 이미지 생성이나
검열 같은 도메인 기능은 직접 소유하지 않는다.

NovelAI 기능 전체는 기본 내장 애드온 `NaiTail`, 로컬 Anima 생성은 `AnimaTail`로
제공된다. 생성 결과 탐색과 설정 재사용은 `GalleryTail`, 로컬 자동검열은 `CensorTail`이 각각
소유한다. NainTail 호스트는 각 manifest를 발견하고 지원하는 Electron·CLI·MCP 진입점을
실행한다. Hosted AnimaTail과 CensorTail의 Python/CUDA는 NainTail의 `runtime/`에서 통합
관리하며, 생성 모델·LoRA·검열 모델은 각 애드온 폴더가 소유한다.

이 폴더가 실제 제품 루트다. 실행 중 필요한 프로젝트, 프리셋, 출력, 캐시와 로그는 모두
이 폴더 아래에 저장되며 부모 개발 워크스페이스에 의존하지 않는다. Hosted 최종 출력은
기본 `outputs/<addonId>/`, 애드온 단독 실행 출력은 각 애드온의 `outputs/`에 저장한다.
홈의 공용 출력 폴더 설정을 바꾸면 Hosted GUI·CLI·MCP는 선택한 폴더의 `<addonId>/`를 함께 사용한다.

V4.5 Precise Reference로 가져온 이미지는 NAI 권장 캔버스 PNG로 처리해 NaiTail data root의
`References/precise/`에 해시 이름으로 보관한다. 이 폴더도 애드온과 함께 복사해야 결과의
참조 설정을 다시 불러올 수 있다.

Vibe Transfer 원본은 비율을 유지한 PNG로 NaiTail data root의 `References/vibes/`에 보관한다. V4 인코딩 결과는
이미지·모델·Information Extracted 조합별로 `cache/vibes/`에 저장하므로 Strength만 바꾼 재생성은
인코딩 비용을 다시 만들지 않는다. Vibe Transfer와 Precise Reference는 동시에 사용할 수 없다.

Single·멀티·작례 연구기와 작품의 일반/캐릭터/전체 생성 버튼은 구독 등급, 해상도, Steps,
실제 생성 장수와 참조 비용을 합산한 예상 Anlas를 표시한다. 예상치가 1 이상이면 비용 내역을
승인한 뒤에만 큐에 등록한다. 이 값은 제품에 기록된 NAI 웹 과금식 기준의 예측치이며 실제 서버
차감액과 차이가 날 수 있다.

V4.5 고급 설정은 8개 Sampler, 4개 Scheduler, Guidance Rescale, Decrisper, Seed, UC와 Quality
Tags를 저장·복원하고 같은 값으로 API payload를 만든다. 구형 모델용 SMEA/SMEA DYN은 현재 V4.5
웹 요청에서 제거되는 필드라 노출하지 않는다.

## 호스트와 애드온 실행 경계

- GUI: `NainTailUtil.bat`
- CLI: `NainTailUtil_CLI.bat`
- MCP: `NainTailUtil_MCP.bat`
- Host registry: `app/host/addon-registry.cjs`
- Host Electron/CLI/MCP entry: `app/electron/`, `app/cli/`, `app/mcp/`
- NaiTail manifest: `Addons/NaiTail/addon.json`
- NaiTail Core: `Addons/NaiTail/app/core/`
- NAI Worker: `Addons/NaiTail/app/workers/nai/`
- NaiTail Electron adapter: `Addons/NaiTail/app/electron/`
- NaiTail Renderer: `Addons/NaiTail/app/renderer/`
- AnimaTail manifest: `Addons/AnimaTail/addon.json`
- AnimaTail Electron adapter/GUI: `Addons/AnimaTail/electron/`, `Addons/AnimaTail/dist/renderer/`
- AnimaTail Python/CUDA Worker: `Addons/AnimaTail/app/`
- Hosted Python/CUDA runtime: `runtime/`
- AnimaTail Standalone runtime/model/data: `Addons/AnimaTail/runtime/`, `Models/`, `Presets/`, `outputs/`
- GalleryTail manifest/UI/service: `Addons/GalleryTail/`
- CensorTail manifest/UI/Worker/output: `Addons/CensorTail/`

GUI 홈은 발견된 애드온 수에 맞춰 카드를 동적으로 만든다. 현재 순서는 `NaiTail`, `AnimaTail`,
`GalleryTail`, `CensorTail`이다. 각 작업창 상단 브랜드 옆의 `홈` 버튼으로 돌아간다. 홈과 현재
활성 애드온 창은 숨김 전환하므로 홈 복귀 뒤 같은 카드에 재진입하면 renderer 상태를 유지한다.
다른 애드온을 열면 이전 runtime과 창을 종료하고 새 애드온을 활성화한다. 애드온이 없어도
호스트 홈은 빈 상태를 표시하며 정상 기동한다.
NaiTail과 AnimaTail의 설정·프리셋·프로젝트·참조·캐시 데이터는 Hosted와 Standalone 모두 각
애드온 경계 안에 저장한다. 최종 출력은 Standalone에서 애드온의 `outputs/`, Hosted에서
`outputs/<addonId>/`를 사용한다. GalleryTail은 호스트가 공개한 AnimaTail output root를 읽고,
`설정 재사용`은 host handoff로 AnimaTail을 열어 값을 전달한다. Hosted CensorTail 결과는
`outputs/censortail/censored/`에 저장한다.

전용 Electron runtime이 없으면 BAT가 Windows PowerShell 부트스트랩을 먼저 실행한다.
부트스트랩은 애드온이 고정한 공식 Electron ZIP의 크기와 SHA-256을 검증해
`runtime/electron/`에 설치한 뒤 원래 GUI·CLI·MCP 실행을 계속한다. 개발 중 순수 Core와
CLI는 Node.js로 직접 검증할 수 있지만 최종 포터블 실행은 시스템 Node에 의존하지 않는다.

NovelAI 토큰은 프로젝트나 프리셋에 저장하지 않는다. GUI에서는 Windows 보호 저장소를
사용하고 CLI·MCP에서는 `NAINTAIL_NAI_TOKEN` 환경변수를 사용한다. MCP는 stdio 호환성을 위해
포터블 Electron을 Node 모드로 실행하므로 GUI 암호화 토큰을 복호화하지 않는다.

## 큐 동작

- NAI에는 항상 `n_samples: 1`, 동시 실행 1로 요청한다.
- `현재 이미지 후 중단`과 `대기열 비우기`는 아직 NAI에 보내지 않은 요청을 취소한다.
- 이미 전송된 한 장은 응답을 받아 PNG로 저장하며, 그 다음 요청은 보내지 않는다.
- 생성 실패 시 같은 Run의 남은 요청을 전송하지 않고 큐를 일시정지한다.
- 생성 요청은 중복 과금 위험을 피하기 위해 자동 재시도하지 않는다.

## CLI 예시

```bat
NainTailUtil_CLI.bat status
NainTailUtil_CLI.bat projects list
NainTailUtil_CLI.bat plan project --id project_xxx --scope all
NainTailUtil_CLI.bat generate project --id project_xxx --scope all --jsonl

NainTailUtil_CLI.bat --addon animatail status --json
NainTailUtil_CLI.bat --addon animatail models list --json
```

## 후속 경계

MCP adapter는 포함되어 있으며 축약 discovery, 비동기 job wait/status/cancel과 유료 Anlas 승인
상한을 제공한다.

AnimaTail과 CensorTail의 Standalone 폴더에는 각각 포터블 Python 3.12/CUDA 런타임이 포함된다.
Hosted에서는 두 애드온 모두 NainTail `runtime/`을 사용한다. AnimaTail은 생성 모델·LoRA를,
CensorTail은 검열 Worker·`Models/censor`와 출력을 독립적으로 소유한다.
GalleryTail은 현재 GUI 전용이다. CensorTail은 Hosted/Standalone MCP에서 검출·저장·작업 대기와
모델 언로드를 제공하며 AnimaTail artifactRef를 직접 입력으로 받는다.

## 애드온 단독 포터블 실행

애드온은 하나의 코드베이스를 두 composition root로 실행한다. Standalone에서는 애드온 폴더의
runtime·resource·data root를 사용하고, NainTail host에 장착되면 호스트가 주입한 공용
service와 dependency를 우선 사용한다. 시스템 전역 설치나 개발 PC 경로로 조용히 우회하지 않는다.
output root는 Standalone의 `<AddonRoot>/outputs/`와 Hosted의
`<NainTailRoot>/outputs/<addonId>/`로 분리한다. 세부 우선순위, 데이터 소유권과 검증 Gate는
워크스페이스의 개발 문서를 따른다.
문서는 `../Docs/README.md`의 애드온별 소유권 규칙으로 관리하며,
`../Docs/ADDON_DEVELOPMENT_CONTRACT.md`와 `../Docs/ADDON_OUTPUT_CONTRACT.md`를 정식 개발
계약으로 따른다.

`Addons/NaiTail/`, `Addons/AnimaTail/`, `Addons/CensorTail/`은 NainTail host에 장착되는
내장 애드온인 동시에,
각 폴더 하나만 복사해 직접 실행할 수 있는 standalone 포터블 유틸이다.

```text
Addons/NaiTail/NaiTail.bat
Addons/NaiTail/NaiTail_CLI.bat
Addons/NaiTail/NaiTail_MCP.bat

Addons/AnimaTail/AnimaTail.bat
Addons/AnimaTail/AnimaTail_CLI.bat
Addons/AnimaTail/AnimaTail_MCP.bat

Addons/CensorTail/CensorTail.bat
Addons/CensorTail/CensorTail_MCP.bat
```

각 폴더의 `runtime/electron/`이 전용 Electron을 제공한다. standalone과 NainTail host 실행 모두
해당 애드온 폴더를 application/data root로 사용하되 output root는 분리한다. Hosted에서는 호스트가
주입한 공용 runtime, service와 `outputs/<addonId>/`를 우선하고, standalone에서는 애드온 로컬
runtime과 `outputs/`를 사용한다. 로컬 Electron이 없으면 각 폴더의 `tools/ensure-electron.cmd`가
공식 배포본을 검증·설치한다. 시스템 Node나 Python은 필요하지 않다.
CensorTail은 GUI와 MCP standalone을 제공한다.

## MCP 등록

MCP host가 `cmd.exe /d /s /c <제품 절대경로>\NainTailUtil_MCP.bat`를 실행하도록 등록한다.
생성이 필요하면 host의 server 환경변수에 `NAINTAIL_NAI_TOKEN`을 설정한다. stdout은 MCP
프로토콜 전용이며 로그는 stderr로만 출력한다.

기본 MCP 서버는 NainTail federation router다. 현재 `mcpAdapter`가 연결된 NaiTail, AnimaTail과 CensorTail
도구를 축약 list/get/call로 조회·실행한다. AnimaTail MCP만 직접 쓰려면 server 환경변수에
`NAINTAIL_ADDON_ID=animatail`을 설정한다. 기존 직접 연결 도구명은 호환성을 위해 유지한다.

`projects_list`와 `presets_list`는 선택 식별자만 반환한다. 본문은 각각 `project_get`,
`preset_get`으로 한 항목씩 읽는다. 생성 도구가 반환한 `jobId`는 짧은 status 반복 호출 대신
`job_wait`으로 기다리며, ID를 잃었을 때만 축약 `jobs_list`를 사용한다.

## Third-party notices

NAI V4.5 요청 구조와 일부 기본 품질/UC 프리셋은 MIT 라이선스인 PeroPix 구현을
참고했다. 고지문은 `licenses/PeroPix-MIT.txt`에 포함한다. Electron과 Chromium의
라이선스 고지문은 `runtime/electron/`에 원본 그대로 포함한다.

GUI는 제품에 번들한 Pretendard Variable과 JetBrains Mono Variable을 사용한다. 두 폰트의
SIL Open Font License 1.1 고지문은 각각 `licenses/Pretendard-OFL-1.1.txt`와
`licenses/JetBrains-Mono-OFL-1.1.txt`에 포함한다.
