# AnimaTail

기존 AnimaUtil의 로컬 Anima 생성, Python/CUDA Worker, 모델과 프리셋을 소유하는 NainTail의
두 번째 내장 애드온이다. 갤러리는 GalleryTail, 자동검열은 CensorTail로 분리했다.

독립 기준 버전은 `VERSION`, `addon.json`, `package.json`의 `0.1.0`이다. `npm run check`로 버전과
포터블 entry를 검사하고 `npm run version:set -- <semver>`로 세 파일을 함께 변경한다.

- `electron/`: NainTail 애드온 lifecycle과 Anima IPC adapter
- `dist/renderer/`: AnimaTail GUI
- `app/`: 생성 Python Worker
- `runtime/`: 앱 전용 Python 3.12/CUDA runtime과 standalone Electron runtime
- `Models/`: Anima 생성 모델, LoRA와 AnimaTail 지원 자산
- `Presets/`, `outputs/`: AnimaTail 생성 전용 사용자 데이터. outputs는 GalleryTail이 읽는다.
- `cli/`, `mcp/`: headless adapter

애드온은 개발 PC의 원본 AnimaUtil 절대 경로를 참조하지 않는다. `Addons/AnimaTail/` 경계
안의 자산만 사용한다.

## 독립 포터블 실행

- GUI: `AnimaTail.bat`
- CLI: `AnimaTail_CLI.bat`
- MCP: `AnimaTail_MCP.bat`
- 전용 Electron: `runtime/electron/`
- Electron 자동 설치: `tools/ensure-electron.cmd`, `electron-runtime-manifest.json`
- standalone host: `standalone/`

이 `AnimaTail/` 폴더 하나에 Electron, Python/CUDA, 모델·LoRA, 프리셋과 출력이 모두 들어 있다.
Electron이 빠져 있으면 첫 실행 시 공식 배포본을 검증해 자동 설치한다. 폴더 전체를 복사하면
상위 NainTailUtil이나 시스템 Node/Python 없이 같은 상태로 실행할 수 있다.
NainTail에 장착된 Hosted 실행에서는 애드온 로컬 Python/CUDA 대신 NainTail의 `runtime/`을
주입받아 사용하며, Anima 모델·LoRA·프리셋은 계속 이 애드온 폴더에서 관리한다.
