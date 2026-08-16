# NaiTail

NainTail의 기본 NovelAI 내장 애드온이다. 기존 NAI 기능 전체를 하나의 두꺼운 모듈로 소유한다.

독립 기준 버전은 `VERSION`, `addon.json`, `package.json`의 `0.1.0`이다. 릴리즈 시 세 파일의
SemVer를 함께 변경하고 포터블 entry를 검증한다.

- `app/core/`: 작품·프리셋·큐·비용·참조 자산을 포함한 현재 NaiTail Core
- `app/workers/`: NovelAI 전송 Worker
- `dist/renderer/`: Single, Multi, 작례 연구기, 작품, 프리셋, 설정 UI
- `electron/`: 제한된 IPC와 자격증명 adapter
- `cli/`, `mcp/`: headless adapter

NainTail 호스트 안에서 실행하거나 `NaiTail.bat`로 단독 실행하는 경우 모두 이 NaiTail 폴더
자체가 application·data root다. `Projects/`, `Presets/`, `References/`, `outputs/`, `cache/`,
`config/`, `logs/`는 실행 형태와 관계없이 이 애드온이 직접 소유한다. Hosted 실행에서 달라지는
것은 호스트가 공용 runtime과 service를 주입한다는 점뿐이다.

## 독립 포터블 실행

- GUI: `NaiTail.bat`
- CLI: `NaiTail_CLI.bat`
- MCP: `NaiTail_MCP.bat`
- 전용 Electron: `runtime/electron/`
- Electron 자동 설치: `bootstrap/ensure-electron.cmd`, `electron-runtime-manifest.json`
- standalone host: `standalone/`

따라서 이 `NaiTail/` 폴더 하나만 다른 Windows 경로로 복사해 상위 NainTailUtil 없이 실행할 수 있다.
Electron이 빠져 있으면 첫 실행 시 공식 배포본을 크기·SHA-256 검증 후 자동 설치한다. 기존
standalone 데이터까지 옮기려면 폴더 전체를 그대로 복사한다.
