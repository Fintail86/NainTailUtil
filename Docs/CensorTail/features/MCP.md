# CensorTail MCP

- 상태: Hosted federation + Standalone stdio 구현
- Adapter profile: `naintail.addon-mcp-profile/v1`
- 입력 경계: Hosted `artifactRef`, Standalone 로컬 `inputPaths`
- 작업 모델: 단일 Worker를 공유하는 순차 비동기 queue

## 도구

| 도구 | 역할 |
|---|---|
| `censortail_status` | runtime·ONNX dependency·model·queue 준비 상태 |
| `censortail_scan` | 이미지 검출 작업 등록 후 즉시 `jobId` 반환 |
| `censortail_save` | 완료된 scan 결과를 효과 설정으로 저장 작업 등록 |
| `censortail_jobs_list` | 현재 세션 작업의 선택용 축약 목록 |
| `censortail_job_status` | 작업 상태 즉시 조회 |
| `censortail_job_wait` | 최대 60초 서버 내부 대기 |
| `censortail_job_cancel` | queued 작업 취소, running 작업은 계속됨을 명시 |
| `censortail_result_get` | scan 이미지 한 장의 검출 상세 조회 |
| `censortail_model_unload` | idle Worker와 ONNX model 해제 |

## Hosted 흐름

```text
AnimaTail generate → job_wait
  → output.artifactRef
  → CensorTail scan(artifactRefs)
  → CensorTail job_wait
  → 필요한 이미지만 result_get
  → CensorTail save(scanJobId, options)
  → CensorTail job_wait
  → censortail artifactRef
```

Hosted Adapter는 개발 PC 절대경로를 입력이나 결과에 노출하지 않는다. NainTail resolver가
Consumer의 `requires` 선언과 Provider 폴더 경계를 검사한 뒤 private 경로를 CensorTail service에
등록한다. 저장 출력은 `naintail.artifact-ref/v1`, `scope: session` 참조로 다시 공개한다.

## Standalone 흐름

Standalone MCP에는 다른 애드온의 session resolver가 없으므로 `censortail_scan.inputPaths`에
로컬 이미지 또는 폴더 절대경로를 전달한다. Hosted에서는 이 필드를 거부한다.

```text
CensorTail_MCP.bat
  → censortail_status
  → censortail_scan(inputPaths)
  → censortail_job_wait
  → censortail_save
```

## 결과 절약

scan의 terminal status와 wait은 이미지별 `imageId`, 크기, 검출 수와 label별 개수만 반환한다.
좌표·confidence가 필요한 이미지 하나에만 `censortail_result_get`을 호출한다. Instance mask의
base64 payload는 MCP 결과에 포함하지 않고 크기·box metadata만 공개하며, 실제 mask는 service가
save 작업까지 내부에서 보존한다.

## 취소와 unload

- queued job은 즉시 `cancelled`로 전환한다.
- 이미 시작된 ONNX detect 또는 save 요청은 Worker를 강제 종료하지 않는다. 취소 응답은
  `cancelled: false`, `activeContinues: true`를 반환한다.
- model unload는 queued/running 작업이 하나라도 있으면 `CENSOR_MODEL_BUSY`로 거부한다.
- idle unload는 MCP 연결과 완료 job history를 유지한다.

## 준비 실패

`censortail_status`가 runtime, ONNX dependency 또는 model 문제를 보고하면 GUI의 설치 흐름으로
준비를 완료한다. MCP 호출이 대형 runtime이나 model 다운로드를 암묵적으로 시작하지 않는다.
