# NainTailUtil

NovelAI 이미지 생성을 작품, 일반 슬롯 목록, 캐릭터 카드별 슬롯 목록으로 관리하는
포터블 Windows 유틸리티다.

이 폴더가 실제 제품 루트다. 실행 중 필요한 프로젝트, 프리셋, 출력, 캐시와 로그는 모두
이 폴더 아래에 저장되며 부모 개발 워크스페이스에 의존하지 않는다.

V4.5 Precise Reference로 가져온 이미지는 NAI 권장 캔버스 PNG로 처리해
`References/precise/`에 해시 이름으로 보관한다. 이 폴더도 제품과 함께 복사해야 결과의
참조 설정을 다시 불러올 수 있다.

Vibe Transfer 원본은 비율을 유지한 PNG로 `References/vibes/`에 보관한다. V4 인코딩 결과는
이미지·모델·Information Extracted 조합별로 `cache/vibes/`에 저장하므로 Strength만 바꾼 재생성은
인코딩 비용을 다시 만들지 않는다. Vibe Transfer와 Precise Reference는 동시에 사용할 수 없다.

Single·멀티·작례 연구기와 작품의 일반/캐릭터/전체 생성 버튼은 구독 등급, 해상도, Steps,
실제 생성 장수와 참조 비용을 합산한 예상 Anlas를 표시한다. 예상치가 1 이상이면 비용 내역을
승인한 뒤에만 큐에 등록한다. 이 값은 제품에 기록된 NAI 웹 과금식 기준의 예측치이며 실제 서버
차감액과 차이가 날 수 있다.

V4.5 고급 설정은 8개 Sampler, 4개 Scheduler, Guidance Rescale, Decrisper, Seed, UC와 Quality
Tags를 저장·복원하고 같은 값으로 API payload를 만든다. 구형 모델용 SMEA/SMEA DYN은 현재 V4.5
웹 요청에서 제거되는 필드라 노출하지 않는다.

## MVP 실행 경계

- GUI: `NainTailUtil.bat`
- CLI: `NainTailUtil_CLI.bat`
- MCP: `NainTailUtil_MCP.bat`
- Core: `app/core/`
- NAI Worker: `app/workers/nai/`
- Electron adapter: `app/electron/`
- Renderer: `app/renderer/`

전용 Electron runtime이 없으면 BAT는 실행하지 않고 명확한 오류를 표시한다. 개발 중
순수 Core와 CLI는 Node.js로 직접 검증할 수 있지만 최종 포터블 실행은 시스템 Node에
의존하지 않는다.

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
```

## 후속 경계

MCP adapter는 포함되어 있으며 축약 discovery, 비동기 job wait/status/cancel과 유료 Anlas 승인
상한을 제공한다.

Python/CUDA 기반 자동검열 Worker는 다음 단계다. `runtime-manifest.json`이 이 상태를 명시하며,
현재 제품은 NAI 생성용 Electron 런타임만 포함한다.

## MCP 등록

MCP host가 `cmd.exe /d /s /c <제품 절대경로>\NainTailUtil_MCP.bat`를 실행하도록 등록한다.
생성이 필요하면 host의 server 환경변수에 `NAINTAIL_NAI_TOKEN`을 설정한다. stdout은 MCP
프로토콜 전용이며 로그는 stderr로만 출력한다.

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
