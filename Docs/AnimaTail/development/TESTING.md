# 개발 검증 명령과 범위

- 기준일: 2026-07-27
- 원칙: 빠른 정적·단위 검증과 실제 Electron/GPU 검증을 구분한다.

## 기본 명령

일반 앱 검증 명령은 워크스페이스가 아니라 실행 프로젝트에서 수행한다.

```powershell
cd .\AnimaUtil
```

| 명령 | 포함 범위 | 포함하지 않는 범위 |
|---|---|---|
| `npm test` | Node 서비스, 큐, 경로 검증, 프리셋, 메타데이터 parser | React 실제 렌더링, Python 계산, GPU |
| `npm run build` | Vite React production build | Electron 실행, GPU |
| `npm run check` | `npm test` + production build | Electron 실제 실행, Python 테스트, GPU 생성 |
| `npm run cli -- capabilities --json` | CLI 명령·schema·제한의 기계 판독 계약 | Python worker, GPU 생성 |
| `node --test tests/mcp-*.test.cjs` | MCP 작업 수명주기, schema와 공식 client protocol 왕복 | 실제 Python worker, GPU 생성 |

Electron 실제 화면과 GPU 생성은 제품 메인 프로세스에 테스트 자동화를 내장하지 않고
개발 실행에서 수동으로 확인한다. 생성 결과는 `outputs/`에 PNG로 저장되며 같은 stem의
JSON sidecar를 만들지 않는다.

React/JSX/CSS 파일에서 특정 한글 문구, class 이름, 픽셀값을 정규식으로 찾는 테스트는
보안 설정처럼 정적 검사가 계약 자체인 경우를 제외하고 추가하지 않는다. 이런 검사는
실제 동작을 증명하지 못하면서 정상적인 UI 재구성에도 깨지므로 빌드와 수동 화면 확인으로
검증한다.

CLI 관련 Node 테스트는 공용 생성 요청 정규화, 프리셋 병합, 멀티 슬롯 보존,
headless queue 완료, JSONL 한 줄 계약과 종료 코드를 검증한다. 실제 CUDA worker는
단위 테스트에서 실행하지 않는다.

MCP 관련 Node 테스트는 공식 MCP client와 메모리 transport를 사용해 초기화, 도구 목록,
입력 검증, 생성 등록과 상태 조회의 실제 프로토콜 왕복을 검증한다. 실제 GPU 검증에서는
stdio client가 `mcp/server.mjs`를 자식 프로세스로 시작하게 해야 한다.

## Python 단위 테스트

실행 프로젝트의 manifest가 가리키는 앱 전용 Python을 사용한다. 시스템 Python이나
사용자 `PATH`의 Python으로 바꾸지 않는다.

```powershell
$manifestPath = if (Test-Path .\runtime-manifest.local.json) {
  ".\runtime-manifest.local.json"
} else {
  ".\runtime-manifest.json"
}
$manifest = Get-Content $manifestPath | ConvertFrom-Json
$python = Join-Path ".\runtime\versions\$($manifest.runtimeId)" $manifest.entrypoint

& $python -m unittest `
  tests.test_anima_adapter `
  tests.test_anima_sampling `
  tests.test_censor_worker
```

현재 Python 테스트는 다음을 검증한다.

- 체크포인트 필수 key·shape와 추가 key 워닝 경계
- DiffSynth/Kohya LoRA 정규화와 alpha 처리
- 샘플러·스케줄러 조합의 유한값·고정 Seed 재현
- 포그 중심 가림·밀도·비정형 외곽
- 검열 PNG/JPG/WebP 내장 메타데이터, JSON 미생성, 깊은 상대 경로 저장

## Electron·GPU 수동 확인

```powershell
npm run au
```

최소 확인 항목은 싱글 생성 1장, 멀티 생성의 서브 프롬프트 전환, 자동검열 모델 로드와
검출·미리보기·저장이다. 실제 생성은 사용자 모델과 앱 전용 런타임을 사용하므로 출력과
프리셋을 자동 테스트 데이터로 수정하지 않는다.

생성 CLI를 변경했으면 추가로 다음을 확인한다.

```powershell
.\AnimaUtil_CLI.bat capabilities --jsonl
.\AnimaUtil_CLI.bat generate single --config <single.json> --jsonl
.\AnimaUtil_CLI.bat generate multi --config <multi.json> --jsonl
```

싱글은 최종 `completed`와 PNG 상대경로를 확인한다. 멀티는 비활성 슬롯이 생성되지 않고
남은 결과의 원래 슬롯 번호, 작업별 출력 폴더와 SubPrefix 파일명이 유지되는지 확인한다.

생성 MCP를 변경했으면 공식 MCP client 또는 Inspector에서 아홉 도구가 보이는지 확인하고,
실제 생성은 다음 순서로 검증한다.

```text
anima_generate_single 또는 anima_generate_multi
  -> 반환 jobId로 anima_job_wait 대기
  -> timeout이면 anima_job_wait 재호출
  -> 필요하면 anima_job_cancel로 queued/running 작업 취소
  -> completed의 result.outputs 절대경로와 PNG 존재 확인
```

MCP stdio 서버의 stdout에는 프로토콜 이외의 로그가 없어야 한다. 시작 안내와 Python
worker 경고는 stderr에만 기록한다.

## 현재 회귀 항목

2026-07-27 문서 감사 시점의 대표 자동 검증은 다음과 같다.

- 완료 내역을 포함한 큐 100개 상한, 오래된 완료 작업 우선 정리
- 대기 작업 순서 변경·삭제와 실행 작업 보호
- 큐 progress 250ms 스로틀과 이미지/lifecycle 즉시 전달
- PNG `AnimaUtil` chunk를 읽는 갤러리와 legacy sidecar 비우선 처리
- 자동검열 205장 입력의 `200 + 5` 배치 처리
- 드롭 폴더의 다단계 하위 경로 보존과 출력 루트 탈출 차단
- 서브 프롬프트별 Seed 공유와 결과 그룹화
- 프롬프트·환경 프리셋 다섯 분류의 생성·수정·덮어쓰기·경로 traversal 차단

파일 수정 후 최소 기준은 `npm test`, `npm run build`, `git diff --check`다. Electron
main/preload/React 상호작용을 바꿨으면 개발 실행에서 화면을 확인하고, Python 계산이나
이미지 저장을 바꿨으면 Python 단위 테스트를 추가한다. 실제 생성 경로를 바꿨으면
마지막에 GPU 생성을 수동으로 확인한다.

## Gate 재현

런타임 설치·복구·격리 검증은 일반 기능 테스트와 분리한다.
아래 명령은 바깥 워크스페이스 루트에서 실행한다.

```powershell
.\tools\gate-b\test-gate-b-bootstrap.ps1
.\tools\gate-b\test-gate-b-recovery.ps1
.\tools\gate-b\test-gate-b-cuda-runtime.ps1
```

필요한 원본 아카이브와 빌드 절차는
[`GATE_B_RESULT.md`](../results/GATE_B_RESULT.md)에 기록되어 있다.
