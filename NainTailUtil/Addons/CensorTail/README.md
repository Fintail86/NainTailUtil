# CensorTail

로컬 자동검열 UI, Worker lifecycle과 검열 모델을 독립적으로 소유하는 NainTail 내장 애드온이다.

독립 버전은 `VERSION`, `addon.json`, `package.json`의 `0.1.1`이다.
릴리즈 시 세 파일의 SemVer를 함께 변경하고 포터블 entry를 검증한다.

- UI, 입력 목록, 검출·미리보기·효과 적용과 출력은 CensorTail이 소유한다.
- Python Worker는 `CensorTail/app/censor_worker.py`에서 실행한다.
- Standalone은 CensorTail 로컬 Python/CUDA/ONNX runtime을 사용하고, Hosted는 AnimaTail과
  NainTail 공용 runtime ID 한 벌을 재사용한다. `Models/censor/`와 Standalone의
  `onnxruntime-gpu` 계약은 CensorTail이 소유한다.
- 검열 결과는 `CensorTail/outputs/censored/`에 저장한다.
- 폴더는 `+ 폴더` 버튼이나 Explorer 드래그로 입력할 수 있다. 하위 이미지를 재귀적으로
  불러오며, 입력한 폴더 이름부터 시작하는 상대 경로를 `outputs/censored/` 아래에 그대로 유지한다.
- 검열 미리보기의 `다중 선택`을 켜고 이미지 위에 선택 영역을 드래그하면, 영역 안에
  중심점이 들어온 검열 박스를 함께 선택한다. `Ctrl`/`Shift` 클릭과 드래그는 기존 선택에
  박스를 추가하거나 해제하며, 선택 박스 설정의 변경·초기화·삭제는 선택 전체에 적용된다.
- 선택된 박스에서 `F`는 개별 검열 설정을 켜거나 끈다. `Q`/`W`/`E`/`R`/`T`는 개별
  설정을 자동으로 켠 뒤 각각 모자이크/색상 박스/형태 칠하기/그라데이션/포그로 변경한다.

## 독립 포터블 실행

- GUI: `CensorTail.bat`
- 전용 Electron: `runtime/electron/`
- Electron 자동 설치: `bootstrap/ensure-electron.cmd`, `electron-runtime-manifest.json`
- 전용 Python/CUDA/ONNX: `runtime/versions/`
- 검열 모델: `Models/censor/`
- standalone host: `standalone/`

`CensorTail/` 폴더 하나만 다른 Windows 경로로 복사하면 NainTail host, AnimaTail이나 시스템
Node/Python 없이 실행할 수 있다. Electron이 빠져 있으면 첫 실행 시 공식 배포본을 검증해
자동 설치한다. Hosted에서도 AnimaTail을 요구하지 않으며, AnimaTail 결과 입력은
두 애드온이 함께 설치된 경우 호스트가 연결하는 선택적 artifact 기능이다. Hosted Python/CUDA는
NainTail `runtime/`만 사용하고 애드온 로컬 runtime으로 암묵 fallback하지 않는다. GUI와 MCP를 공개한다.
