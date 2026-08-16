# CensorTail

AnimaTail의 자동검열 UI와 Worker lifecycle을 분리한 NainTail 내장 애드온이다.

독립 버전은 `VERSION`, `addon.json`, `package.json`의 `0.1.0`을 기준으로 시작한다.
`npm run check`로 세 파일의 버전 일치와 소스 로딩 계약을 검사한다.
다음 버전은 `npm run version:set -- 0.1.1`처럼 세 파일에 함께 반영한다.

- UI, 입력 목록, 검출·미리보기·효과 적용과 출력은 CensorTail이 소유한다.
- Python Worker는 `CensorTail/app/censor_worker.py`에서 실행한다.
- Hosted에서는 AnimaTail이 제공하는 검증된 Python/CUDA runtime과 `Models/censor/` 자산을
  manifest dependency로 사용한다.
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
- 전용 Python/CUDA: `runtime/versions/`
- 검열 모델: `Models/censor/`
- standalone host: `standalone/`

`CensorTail/` 폴더 하나만 다른 Windows 경로로 복사하면 NainTail host, AnimaTail이나 시스템
Node/Python 없이 실행할 수 있다. Standalone에서는 CensorTail 로컬 runtime과 모델을 사용하고,
Hosted에서는 호스트가 해석한 AnimaTail dependency를 사용한다. CLI와 MCP는 현재 공개하지 않는다.

## worktree 개발 환경

worktree에는 CensorTail 소스만 두고, 큰 런타임과 모델은 메인 체크아웃의 무시된 자산을 공유한다.

```powershell
cd NainTailUtil/Addons/CensorTail
npm run dev:setup
npm run dev:status
```

`dev:setup`은 Git common directory에서 메인 체크아웃을 찾아
`config/dev-assets.local.json`과 `config/dev-assets.local.cmd`만 생성한다. 두 파일은 이 폴더의
`.gitignore`에 포함되며, 런타임·모델을 복사하거나 다운로드하지 않는다. 다른 자산 보관소를
사용하려면 `node tools/dev-setup.cjs --source C:\absolute\path\to\CensorTail`로 지정한다.

실행 시 포터블 로컬 `runtime/electron/electron.exe`가 있으면 그것을 우선하고, 없으면 개발 설정의
공용 Electron을 사용한다. Python runtime manifest와 애드온 소스는 현재 worktree 기준을 유지하며,
실제 `runtime/versions/`와 `Models/censor/` 바이트만 공용 경로에서 읽는다.
