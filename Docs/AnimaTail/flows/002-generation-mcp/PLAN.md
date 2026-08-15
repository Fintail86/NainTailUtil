# Flow 002 생성 MCP 계획

- 작성일: 2026-08-04
- 상태: 1차 구현 완료
- 대상 앱 버전: `0.1.0` 개발 트리

## 목표

Flow 001에서 분리한 공용 생성 계층 위에 로컬 stdio MCP adapter를 추가한다. AI가
구조화된 인자로 싱글·멀티 생성을 등록하고, 긴 GPU 추론을 MCP 도구 호출에 묶어두지
않은 채 별도 상태 도구로 완료 결과를 확인할 수 있어야 한다.

## 1차 범위

- `anima_status`, `anima_models_list`
- `anima_presets_list`, `anima_preset_get`
- `anima_generate_single`, `anima_generate_multi`, `anima_job_status`, `anima_job_wait`, `anima_job_cancel`
- 공식 TypeScript MCP SDK의 stdio transport
- FIFO 비동기 작업 관리자
- MCP 프로세스 수명 동안 Python worker와 모델 재사용
- 최대 활성 작업 및 완료 기록 제한
- 결과 PNG의 안전하게 계산한 절대경로와 최소 생성 메타데이터
- Windows BAT 실행기와 MCP host 설정 예시

## 비범위

- 자동검열과 리파인
- 프리셋·모델 catalog 편집 MCP 도구
- 개별·전체 취소 도구
- GUI·CLI·MCP 사이의 OS 수준 GPU 상호 배제
- HTTP transport와 원격 접근
- MCP experimental tasks API

공식 SDK의 tasks API는 아직 실험적이므로 AnimaUtil 자체 `jobId + status` 계약을 먼저
사용한다.

## 성공 조건

1. 공식 MCP 클라이언트가 stdio 서버를 초기화하고 아홉 도구를 조회할 수 있다.
2. 생성 도구가 설정을 검증한 뒤 추론 완료를 기다리지 않고 `jobId`를 반환한다.
3. 두 생성 요청이 동시에 GPU를 사용하지 않고 FIFO로 실행된다.
4. 상태 조회가 진행률, 실패 code와 완료 이미지 경로를 구조화된 결과로 제공한다.
5. 동일 MCP 서버의 연속 요청에서 Python worker를 매번 닫지 않는다.
6. 실제 모델로 MCP 싱글 한 장을 생성하고 결과 PNG를 확인한다.
7. 기존 Node 테스트와 renderer production build가 통과한다.

## 변경 대상

- `AnimaUtil/mcp/`: MCP 서버, Zod 입력 schema와 작업 관리자
- `AnimaUtil/AnimaUtil_MCP.bat`: 프로젝트 위치 기준 stdio 실행기
- `AnimaUtil/package.json`: MCP 실행 script와 공식 SDK 의존성
- `AnimaUtil/tests/`: 작업 수명주기와 실제 프로토콜 통합 테스트
- `docs/features/MCP.md`: 등록, 도구와 운영 경계

## 검증 계획

```powershell
cd .\AnimaUtil
node --test tests/mcp-job-manager.test.cjs tests/mcp-server.test.cjs
npm run check
```

실제 GPU 검증은 공식 MCP client의 stdio transport로 서버를 실행하고
`anima_generate_single -> anima_job_wait`로 완료를 기다린다. 완료 이미지의 파일 존재,
해상도와 반환 경로를 확인한다.
