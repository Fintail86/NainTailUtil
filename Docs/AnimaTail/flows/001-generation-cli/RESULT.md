# Flow 001 생성 CLI 결과

- 완료일: 2026-08-04
- 상태: 1차 범위 구현 및 실제 GPU 검증 완료

## 구현 내용

- `electron/generation-request.cjs`
  - `main.cjs`에 있던 싱글·멀티·리파인 공용 생성 요청 정규화를 분리했다.
  - GUI와 CLI가 같은 모델·LoRA catalog 해석, 프롬프트 결합, 크기·샘플링 제한,
    서브 선택과 원래 슬롯 번호를 사용한다.
- `electron/generation-application.cjs`
  - 창 없이 `JobQueue`와 `InferenceService`를 조립한다.
  - CLI 작업 그룹 완료, 부분 성공, 취소와 worker 종료를 관리한다.
- `cli/main.cjs`, `cli/generation-config.cjs`
  - `capabilities`, `status`, `models list`
  - `presets list/get/save`와 명시적 ID 덮어쓰기
  - `generate single`, `generate multi`
  - Base·일반·네거티브·서브 프롬프트 프리셋 적용
  - 직접 서브 목록 및 프리셋 슬롯 override, 서브별 LoRA와 활성화 필터
  - JSON/JSONL stdout, worker log stderr와 종료 코드
- `config/cli-generation.schema.json`
  - version 1의 AI 입력 계약을 추가했다.
- `AnimaUtil_CLI.bat`
  - 앱 폴더의 로컬 Electron을 `ELECTRON_RUN_AS_NODE=1`로 실행한다.
  - 현재 디렉터리가 아니라 BAT 위치를 앱 루트로 사용한다.
- GUI의 `GENERATION_START` IPC도 새 공용 생성 요청 정규화를 사용한다.
- CLI, 생성, 프리셋과 검증 문서를 현재 코드에 맞게 갱신했다.

## 검증 결과

### 자동 검증

```text
npm run check
Node tests: 90/90 pass
Vite production build: pass
git diff --check: pass
```

추가 회귀 테스트는 다음을 검증한다.

- CLI capabilities와 model catalog의 JSON/JSONL 한 줄 계약
- 알 수 없는 명령·옵션의 안정적인 오류 코드와 종료 코드
- 임시 앱 루트에서 프리셋 신규 저장·조회·명시적 덮어쓰기
- 프리셋 조합과 직접 프롬프트 override
- 서브 프롬프트 프리셋의 비활성 슬롯과 원래 번호 보존
- 공용 GUI/CLI 생성 정규화의 싱글·멀티 payload
- headless 큐 그룹 완료와 부분 성공 집계

### BAT 및 실제 GPU 싱글 생성

```text
command: AnimaUtil_CLI.bat generate single --config ..\artifacts\cli-smoke-single.json --jsonl
model: oneObsessionAnima_v20
LoRA: Turbo-ANIMA-v2.9, strength 1
size: 512x512
sampler/scheduler: er_sde / simple
steps/CFG: 10 / 1
seed: 424242
result: outputs/cli-smoke_1.png
worker generation seconds: 1.153
exit code: 0
```

`ready → validated → queued → loading → progress 1..10 → image → completed` JSONL을
확인했다. PNG metadata에서 `generationMode=standard`, Seed와 Prefix를 다시 읽었다.

### BAT 및 실제 GPU 멀티 생성

```text
command: AnimaUtil_CLI.bat generate multi --config ..\artifacts\cli-smoke-multi.json --jsonl
model: oneObsessionAnima_v20
LoRA mode: hotload
requested slots: 1 enabled, 2 disabled, 3 enabled
seed: 424243 shared across enabled variants
output folder: outputs/multi_20260804064612447_7d93de2b/
slot 1: cli-smoke_multi_1_1.png, 1.288 seconds
slot 3: cli-smoke_multi_3_1.png, 0.877 seconds
exit code: 0
```

비활성 슬롯 2를 생성하지 않았고 슬롯 3을 2로 당기지 않았다. 두 활성 변형은 같은
worker와 로드된 모델을 이어서 사용했다. 두 번째 PNG metadata에서
`generationMode=sub-prompt`, `subPrompt.ordinal=3`, 작업 폴더와 Seed를 확인했다.

## 남은 위험

- CLI 호출 사이는 one-shot이므로 다음 명령에서 모델을 다시 로드한다. 반복 호출 성능이
  실제 사용에서 문제가 되면 daemon 또는 GUI와의 공용 로컬 IPC를 별도 설계해야 한다.
- GUI와 CLI를 동시에 실행해 GPU 작업을 등록하는 상호 배제 장치는 없다. 현재는 호출자가
  동시에 추론하지 않아야 한다.
- 실제 `Ctrl+C` 장시간 생성은 이번 검증에서 직접 중단하지 않았다. JobQueue 전체 취소와
  worker kill은 자동 테스트가 통과했지만 CLI signal 전체 경로는 후속 수동 확인 대상이다.
- GUI 창을 직접 열어 싱글·멀티 버튼을 다시 누르는 수동 회귀는 수행하지 않았다.
  공용 정규화 단위 테스트와 renderer production build는 통과했다.
- 프리셋 삭제는 복구 가능한 headless trash 경계가 없어서 의도적으로 제외했다.

## 후속 작업

1. 실제 AI가 `capabilities → models list → presets list → generate` 순서로 수행하는
   agent-style 사용성 검증
2. 장시간 생성의 `Ctrl+C` 취소와 다음 CLI 생성 복구 수동 검증
3. 호출 간 모델 재로딩 비용 측정 후 상주 backend 필요 여부 결정
4. 필요할 때 현재 CLI를 감싸는 Codex Skill 또는 MCP adapter 추가
