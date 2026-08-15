# AnimaUtil Gate B 포터블 런타임 검증 결과

- 검증일: 2026-07-19
- 결과: **통과**
- 범위: 최초 런타임 설치, SHA-256 검증, 원자적 활성화, 시스템 환경 격리, 실제 PyTorch CUDA 실행, 폴더 이동
- 제품 UI/로컬 모델 선택/Anima 전체 생성: Gate C 범위

## 2026-08-01 공개 배포 부트스트랩 후속 변경

Gate B 당시 검증한 사설 런타임의 버전과 핵심 파일 계약은 유지하되, 공개 배포에서는
완성된 2.72GiB ZIP을 AnimaUtil 저장소나 자체 Release에 올리지 않는다. 최초 실행 시
`runtime-manifest.json` schema 3을 사용해 다음 공개 원본을 직접 조립한다.

- Python 3.12.13: `python-build-standalone` 20260320 고정 자산
- 설치 도구: `uv` 0.12.1 고정 자산
- PyTorch 2.11.0+cu128 및 torchvision 0.26.0+cu128: 공식 고정 wheel URL
- DiffSynth: 기존 검증 commit `fb337fbb90945ff829de69dbd44ded618f73e889`
- 그 외 패키지: `config/runtime-requirements.lock.txt`의 고정 버전

공개 자산은 HTTPS, 크기, SHA-256을 확인한다. 설치 후에는 기존 Gate B와 같은 핵심 파일
검증과 CUDA/BF16/ONNX Runtime probe를 통과한 staging만 활성화한다. 이 후속 구현도
시스템 Python 폴백과 시스템 CUDA 환경 변수 사용을 허용하지 않는다. 아래 본문은 당시
완성 ZIP 방식으로 수행한 Gate B 검증 기록으로 보존한다. DiffSynth는 긴 Windows 임시
wheel 빌드 경로를 피하기 위해 검증된 source archive의 순수 Python package directory를
직접 설치하며, 실패 시 앱 내부 `uv` cache를 보존해 재시도 다운로드를 줄인다.

## 1. 결론

AnimaUtil은 시스템 Python, 시스템 CUDA Toolkit 경로 및 사용자 `PATH`에 의존하지
않고 앱 폴더에 설치한 사설 런타임만으로 RTX 5090 CUDA 연산을 실행할 수 있다.

부트스트랩은 `runtime-manifest.json`을 읽어 런타임이 없을 때만 ZIP을 받고,
`runtime/versions/<runtime-id>/python.exe`를 절대경로로 실행한다. Windows의 시스템
환경변수나 레지스트리는 변경하지 않는다.

검증 중 부모 프로세스에는 고의로 다음과 같은 잘못된 값을 지정했다.

- `PYTHONHOME=C:\invalid-system-python`
- `PYTHONPATH=C:\invalid-system-site-packages`
- `CUDA_PATH=C:\invalid-system-cuda`
- `CUDA_HOME=C:\invalid-system-cuda-home`
- `PATH=C:\invalid-parent-path`

워커에서는 위 값이 모두 제거됐고 앱 런타임, `torch/lib`, Windows `System32`만 담은
프로세스 전용 `PATH`가 사용됐다.

## 2. 구현한 경계

### Windows 부트스트랩

원본 저장소의 `tools/gate-b/bootstrap-src/Program.cs`는
다음을 담당한다.

1. manifest schema, 플랫폼, 상대경로 및 SHA-256 형식 검증
2. 필요한 디스크 공간 사전 확인
3. HTTPS 다운로드 및 중단 파일 Range 재개
4. 테스트에 한해서만 명시적 `--allow-file-url` 허용
5. 전체 아카이브 SHA-256 검증
6. Zip Slip을 차단한 staging 디렉터리 압축 해제
7. 핵심 런타임 파일의 크기와 SHA-256 재검증
8. 검증 완료 후 version 디렉터리 원자적 활성화
9. 손상된 기존 런타임을 삭제하지 않고 `runtime/quarantine/`으로 이동
10. 앱 전용 환경 블록을 구성해 사설 `python.exe`를 절대경로로 실행

동시 설치는 `runtime/.install.lock`으로 차단한다. 장경로가 있는 PyTorch와
Transformers 패키지를 풀 수 있도록
원본 저장소의 `tools/gate-b/bootstrap-src/app.manifest`와
`tools/gate-b/bootstrap-src/AnimaUtil.exe.config`에 Windows 장경로
지원을 선언했다.

### 런타임 manifest

원본 저장소의 `AnimaUtil/runtime-manifest.example.json`은
제품용 schema 예시다.
실제 릴리스에서는 빌드된 런타임 아카이브의 URL, 전체 크기, 해제 크기, SHA-256과
핵심 파일 hash를 채운 고정 manifest를 앱과 함께 배포한다.

manifest나 런타임이 없을 때 시스템 Python으로 폴백하는 경로는 만들지 않았다.

## 3. 실제 CUDA 런타임 팩

Gate A에서 통과한 환경을 Python standalone 배포판에 이식했다.

| 구성 | 값 |
|---|---|
| Python | 3.12.13 standalone, `python-build-standalone` 20260320 |
| Python 원본 SHA-256 | `61e26d4ddd7e4345a8f980c4b3730aa9b388e5ac909555a6ad2ef9bae3b9f1ac` |
| PyTorch | 2.11.0+cu128 |
| torchvision | 0.26.0+cu128 |
| transformers | 5.14.1 |
| DiffSynth | 2.0.17, commit `fb337fbb90945ff829de69dbd44ded618f73e889` |
| 런타임 파일 수 | 29,843 |
| ZIP 크기 | 2,920,186,028 bytes, 약 2.72GiB |
| ZIP SHA-256 | `0c1aec37347f4c6cb186b562d471350b6973be73e36c1cdedde149fa971603c9` |
| 압축 해제 크기 | 4,888,292,334 bytes, 약 4.55GiB |

개발 가상환경의 editable DiffSynth 경로는 제거하고 실제 `diffsynth/` 패키지를 런타임에
복사했다. 빌드 머신 절대경로가 들어 있는 `.pth` 파일이 남으면 빌드를 실패시키며,
경로 종속적인 `__pycache__`와 `.pyc`는 런타임 팩에서 제거한다.

빌더는
원본 저장소의 `tools/gate-b/build-gate-b-cuda-runtime.ps1`이다.

## 4. CUDA 격리 실행 결과

원본 저장소의 `AnimaUtil/app/runtime_probe.py`를 앱 전용
런타임으로 실행한 결과다.

| 항목 | 결과 |
|---|---|
| 실행 Python | `runtime/versions/anima-py31213-torch2110-cu128-win-x64-r1/python.exe` |
| Python | 3.12.13 |
| PyTorch | 2.11.0+cu128 |
| CUDA runtime | 12.8 |
| GPU | NVIDIA GeForce RTX 5090 |
| Compute capability | 12.0 |
| `sm_120` | 포함 |
| BF16 2048×2048 행렬 곱 | 성공, finite 결과 |
| cold import | 11.561초 |
| cold CUDA 연산 | 0.102초 |
| warm/moved-path import | 3.756초 |
| warm/moved-path CUDA 연산 | 0.088초 |
| `PYTHONHOME`/`PYTHONPATH` | 없음 |
| `CUDA_PATH`/`CUDA_HOME` | 없음 |
| 부모 `PATH` 유출 | 없음 |

설치된 전체 `dist/` 폴더를 `한글 CUDA 이동`이라는 한글·공백 경로로 옮긴 뒤에도 같은
런타임을 다시 다운로드하지 않고 CUDA 연산을 통과했다.

## 5. 복구 및 보안 검증

작은 Python-only fixture와 실제 CUDA 팩을 나누어 검증했다.

| 시나리오 | 결과 |
|---|---|
| 빈 런타임에서 최초 설치 | 통과 |
| 이미 설치된 버전 재사용 | 통과 |
| 부모 Python/CUDA/PATH 오염 차단 | 통과 |
| 부분 다운로드 이어받기 | 통과 |
| 전체 ZIP hash 불일치 | 실패 폐쇄, 활성 런타임 없음 |
| 핵심 DLL 손상 | 감지 후 quarantine 이동 및 재설치 |
| 한글·공백 경로 이동 | 통과 |
| 장경로 패키지 압축 해제 | 통과 |
| 시스템 환경변수/레지스트리 수정 | 수행하지 않음 |

관련 테스트:

- `tools/gate-b/test-gate-b-bootstrap.ps1`
- `tools/gate-b/test-gate-b-recovery.ps1`
- `tools/gate-b/test-gate-b-cuda-runtime.ps1`

## 6. 남은 경계

Gate B는 앱 전용 Python/CUDA 런타임의 설치와 실행 경계를 검증했다. 다음 사항은 Gate C
및 릴리스 QA에서 처리한다.

1. 생성된 `runtime-manifest.json`에 들어갈 GitHub 저장소와 runtime release를 실제로 게시
2. 완료: Electron main/renderer에 분할 다운로드, 이어받기, 진행률, 취소, SHA-256 검증과 원자적 활성화 연결
3. `Models/`의 사용자 제공 모델 검색·검증과 Anima 추론 워커를 제품 IPC에 연결
4. 런타임에서 불필요한 패키지를 제거해 2.72GiB ZIP을 추가 축소
5. 쓰기 금지 폴더에서 `%LOCALAPPDATA%` 대체 위치 또는 명확한 경로 선택 UI 제공
6. 별도 깨끗한 Windows 사용자/PC에서 최종 설치 검증
7. 런타임 라이선스와 NOTICE 원문 패키징

현재 구현은 앱 폴더가 쓰기 가능한 포터블 ZIP 배포를 기본으로 한다.

## 7. 재현 명령

Python standalone 원본이 준비된 상태에서:

```powershell
.\tools\gate-b\build-gate-b-fixture.ps1 -PythonRuntimeArchive C:\tmp\cpython-3.12.13-standalone.tar.gz
.\tools\gate-b\test-gate-b-bootstrap.ps1
.\tools\gate-b\test-gate-b-recovery.ps1

.\tools\gate-b\build-gate-b-cuda-runtime.ps1 -PythonRuntimeArchive C:\tmp\cpython-3.12.13-standalone.tar.gz
.\tools\gate-b\test-gate-b-cuda-runtime.ps1
```

`artifacts/`, 실제 런타임, 다운로드 캐시와 검사 결과는 `.gitignore` 대상이다.
