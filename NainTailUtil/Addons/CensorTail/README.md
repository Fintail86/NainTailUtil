# CensorTail

AnimaTail의 자동검열 UI와 Worker lifecycle을 분리한 NainTail 내장 애드온이다.

- UI, 입력 목록, 검출·미리보기·효과 적용과 출력은 CensorTail이 소유한다.
- Python Worker는 `CensorTail/app/censor_worker.py`에서 실행한다.
- Hosted에서는 AnimaTail이 제공하는 검증된 Python/CUDA runtime과 `Models/censor/` 자산을
  manifest dependency로 사용한다.
- 검열 결과는 `CensorTail/outputs/censored/`에 저장한다.

## 독립 포터블 실행

- GUI: `CensorTail.bat`
- 전용 Electron: `runtime/electron/`
- 전용 Python/CUDA: `runtime/versions/`
- 검열 모델: `Models/censor/`
- standalone host: `standalone/`

`CensorTail/` 폴더 하나만 다른 Windows 경로로 복사하면 NainTail host, AnimaTail이나 시스템
Node/Python 없이 실행할 수 있다. Standalone에서는 CensorTail 로컬 runtime과 모델을 사용하고,
Hosted에서는 호스트가 해석한 AnimaTail dependency를 사용한다. CLI와 MCP는 현재 공개하지 않는다.
