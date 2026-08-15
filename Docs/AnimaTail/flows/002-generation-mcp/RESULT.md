# Flow 002 생성 MCP 결과

- 완료일: 2026-08-04
- 상태: 1차 범위 구현 및 실제 GPU 검증 완료

## 구현 내용

- 공식 `@modelcontextprotocol/server` 2.0.0 기반 stdio 서버
- `anima_status`, `anima_models_list`, `anima_presets_list`, `anima_preset_get`
- `anima_generate_single`, `anima_generate_multi`, `anima_job_status`, `anima_job_wait`, `anima_job_cancel`
- 생성 도구가 즉시 `jobId`를 반환하는 자체 비동기 작업 계약
- 한 MCP 서버에서 FIFO 직렬 실행 및 `GenerationApplication` 재사용
- 활성 작업 20개, 전체 기록 100개 상한과 오래된 완료 기록 우선 정리
- CLI schema와 같은 프리셋·LoRA·샘플링·서브 슬롯 입력 검증
- 진행 이벤트, 기계 판독 오류 code와 결과 PNG 절대경로
- 완료 결과에서 중복 상대경로·파일명·프롬프트 원문을 제거한 슬림 출력 계약
- 생성 수 계산을 Electron JobQueue와 공유하고 terminal 상태 전이·waiter 알림을 단일화
- 공개 결과 직렬화와 안전한 출력 경로 계산을 `mcp/job-public-view.cjs`로 분리
- 앱 폴더 기준 `AnimaUtil_MCP.bat` 실행기와 MCP host 설정 문서

공식 SDK의 experimental tasks API는 사용하지 않았다. 장시간 작업 호환성을 우선해
일반 도구 호출에서 `jobId`를 반환하고 `anima_job_wait`가 예상 이미지 수를 기준으로
30~60초 동안 서버 내부에서 기다리는 안정적인 경계를 사용한다. 시간 초과 응답은 진행
요약만 반환한다.

## 자동 검증

```text
npm run check
Node tests: 98/98 pass
Vite production build: pass
git diff --check: pass
npm audit --omit=dev: 0 vulnerabilities
```

MCP 전용 테스트에서 공개 catalog의 절대경로 제거와 Turbo 판정, 이름 기반 프리셋 조회, FIFO
직렬 실행, 안전한 출력 경로, worker 실패 code, 활성 작업 상한, 공식 MCP client의
초기화·아홉 도구 호출과 manager 실행 전 입력 차단을 확인했다. 공식 stdio client가
`cmd.exe /c AnimaUtil_MCP.bat`를 실행한 경로에서도 도구 목록을 정상 수신했다.
사용자 Codex 설정에도 `animautil` stdio 서버를 등록했고 `codex mcp get animautil`에서
`enabled: true`를 확인했다. 이미 열린 작업의 도구 목록은 갱신되지 않으므로 새 작업에서
실제 Codex 도구 노출을 확인해야 한다.

### 실제 discovery 왕복

새 stdio 연결에서 도구 목록을 확인한 뒤 다음을 실제 앱 데이터로 조회했다.

- `anima_status`: `readyForGeneration=true`
- `anima_models_list`: diffusion model 5개, LoRA 5개와 Turbo 판정
- `anima_presets_list(category=base)`: Base 프리셋 2개
- `anima_preset_get`: 선택한 Base 프리셋의 이름·category·본문

상태와 catalog 결과에 앱 및 모델의 절대경로가 포함되지 않는 것도 확인했다.

## 실제 MCP GPU 싱글

```text
client: @modelcontextprotocol/client 2.0.0 StdioClientTransport
tool: anima_generate_single -> anima_job_status
jobId: mcp-gpu-smoke-20260804
model: oneObsessionAnima_v20
LoRA: Turbo-ANIMA-v2.9, strength 1
size: 512x512
steps/CFG: 10/1
seed: 860804
status: completed
worker generation: 0.953 seconds
result: outputs/mcp-smoke_1.png
```

상태 도구가 반환한 절대경로의 PNG 존재와 512×512 결과를 직접 확인했다.

## 실제 MCP GPU 멀티

```text
tool: anima_generate_multi -> anima_job_status
jobId: mcp-multi-smoke-20260804
sub slots: 1 spring, 2 winter
seed: 860805 shared
status: completed, 2/2 jobs, 2 images
folder: outputs/multi_20260804083416463_e744f857/
slot 1: mcp-multi-smoke_season_1_1.png, 1.417 seconds
slot 2: mcp-multi-smoke_season_2_1.png, 0.893 seconds
```

두 이미지에서 검은 머리·보라색 눈 캐릭터와 봄 벚꽃/겨울 눈 배경이 각각 반영됐고,
상태 결과가 원래 슬롯 번호와 서브 프롬프트 정보를 보존했다.

## 남은 경계

- 개별 작업 취소 도구는 없으며 서버 종료 시 전체 작업만 정리한다.
- GUI, 별도 CLI와 MCP 사이의 OS 수준 GPU 상호 배제는 없다.
- stdio만 지원하며 원격 HTTP 서버는 제공하지 않는다.
- 실제 GUI와 MCP의 동시 실행 충돌은 의도적으로 수행하지 않았다.
