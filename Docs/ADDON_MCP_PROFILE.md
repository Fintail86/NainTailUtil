# NainTail Addon MCP Profile

- 상태: 정식 개발 계약
- 버전: `naintail.addon-mcp-profile/v1`
- 적용 대상: MCP entry를 선언하는 모든 NainTail 애드온과 NainTail MCP federation router
- 규범 용어: `반드시(MUST)`, `금지(MUST NOT)`, `권장(SHOULD)`은 구현·검증 Gate의 의미를 가진다.

## 1. 목적

이 계약은 애드온마다 다른 도메인 기능을 유지하면서도 AI가 애드온을 바꿀 때 같은 방식으로
상태를 확인하고, 자원을 찾고, 작업을 기다리며, 결과를 다음 호출에 재사용할 수 있게 한다.

통일 대상은 다음과 같다.

- discovery의 list/get 분리
- 상태와 오류 envelope
- 비동기 job submit/status/wait/cancel 생명주기
- 결과와 artifact 참조
- 도구 annotations와 승인 절차
- Hosted adapter와 Standalone MCP의 기능 동일성

Prompt, 생성 설정, 검열 효과, 갤러리 필터처럼 도메인마다 의미가 다른 입력을 하나의 범용
schema로 강제하지 않는다.

## 2. 공통 Profile과 도메인 확장

애드온 MCP 표면은 두 층으로 구성한다.

```text
NainTail Addon MCP Profile
├─ Base                상태·capability·오류·결과
├─ Discovery           <resources>_list / <resource>_get
├─ Async Job           submit / job_status / job_wait / job_cancel
├─ Artifact Provider   artifactRef를 결과로 공개
└─ Artifact Consumer   artifactRef를 입력으로 수신

Addon Domain Extension
├─ NaiTail             Prompt·UC·Vibe·Reference·Anlas
├─ AnimaTail           Model·LoRA·Refine·runtime
├─ GalleryTail         검색·정렬·metadata·파일 작업
└─ CensorTail          검출·threshold·mask·검열 효과
```

- MCP entry를 선언하는 애드온은 Base Profile을 반드시 구현한다.
- 목록형 자원을 공개하면 Discovery Profile을 반드시 구현한다.
- 호출이 즉시 끝나지 않거나 외부 API·Worker를 사용하면 Async Job Profile을 반드시 구현한다.
- 다른 애드온에 결과를 제공하거나 받으면 해당 Artifact Profile을 반드시 구현한다.
- 도메인 확장은 공통 Profile의 상태값, 오류 의미와 결과 envelope를 바꿔서는 안 된다.

## 3. 도구 이름과 canonical operation

NainTail Hosted adapter의 canonical operation은 소문자 snake case를 사용하고 애드온 prefix를
붙이지 않는다. Router가 이미 `addonId`로 namespace를 제공하기 때문이다.

```text
status
projects_list
project_get
generate_single
job_status
job_wait
job_cancel
```

Standalone MCP는 전역 도구명 충돌을 막기 위해 애드온 prefix를 붙일 수 있다.

```text
naitail_generate_single
anima_generate_single
censortail_censor_image
```

기존 공개 도구명은 하위 호환을 위해 유지할 수 있다. Adapter descriptor는 legacy public name과
canonical operation을 명시적으로 연결해야 하며, NainTail router는 문자열 prefix를 잘라
operation을 추측해서는 안 된다.

도구명 규칙은 다음과 같다.

- 목록은 `<resources>_list`, 상세 조회는 대응하는 `<resource>_get`을 사용한다.
- 비동기 작업 공통 동작은 `job_status`, `job_wait`, `job_cancel`을 사용한다.
- 잃어버린 job ID 복구가 필요할 때만 축약 `jobs_list`를 추가한다.
- 도메인 action은 `generate_single`, `censor_image`처럼 동사와 대상을 드러낸다.
- `run`, `do`, `process`처럼 대상과 효과를 알 수 없는 이름은 금지한다.
- 같은 의미의 동작에 애드온마다 `fetch`, `read`, `inspect`를 임의로 섞지 않는다.

## 4. Base Profile

### 4.1 상태

모든 MCP 애드온은 canonical `status`를 제공해야 한다. 최소 structured result는 다음과 같다.

```json
{
  "addonId": "animatail",
  "version": "0.1.0",
  "ready": true,
  "state": "ready",
  "issues": []
}
```

`state`의 공통 값은 다음으로 제한한다.

```text
ready       새 작업을 받을 수 있음
busy        정상 동작 중이지만 즉시 새 작업을 받지 못할 수 있음
degraded    일부 capability나 dependency가 사용 불가
unavailable 필수 dependency 또는 초기화 실패로 핵심 기능 사용 불가
```

애드온은 queue, credential, model과 runtime 상태를 추가할 수 있지만 Prompt, token, 절대경로와
전체 job history를 기본 status에 넣어서는 안 된다.

### 4.2 Capability

애드온 manifest와 MCP adapter는 지원 Profile과 주요 capability를 식별자로 공개해야 한다.

```json
{
  "profiles": ["base", "discovery", "async-job", "artifact-provider"],
  "capabilities": ["single", "multi", "refine"]
}
```

Capability는 도구 schema를 대신하지 않는다. 선택과 가용성 판단에 필요한 짧은 식별자만 둔다.

## 5. Discovery Profile

목록은 말 그대로 **선택용 목록**이어야 한다. 전체 본문은 명시적인 개별 get에서만 반환한다.

### 5.1 List

List 결과에는 기본적으로 다음만 허용한다.

- 안정된 `id`
- 사용자에게 보일 `name`
- 선택에 반드시 필요한 소수의 discriminator
- `itemCount`, `enabled`, `type` 같은 짧은 상태

다음 항목은 list에 넣어서는 안 된다.

- Prompt·UC·설정 본문과 preview
- 파일명·절대경로·내부 상대경로
- 이미지 base64와 결과 metadata 전체
- 크기·mtime·dependency 해석 과정
- 개별 항목의 전체 input schema

ID를 이미 알면 list를 호출하지 않고 바로 get 또는 action을 호출할 수 있어야 한다.

### 5.2 Get

Get은 안정된 ID 하나를 받아 해당 항목의 전체 공개 정보를 반환한다.

- 존재하지 않는 ID는 빈 결과가 아니라 안정된 `*_NOT_FOUND` 오류로 반환한다.
- secret, credential과 내부 절대경로는 get에도 포함하지 않는다.
- list와 get의 ID는 같은 저장 schema와 수명을 사용해야 한다.
- list 항목마다 전체 get을 자동 호출하는 N+1 discovery 흐름을 권장해서는 안 된다.

## 6. Async Job Profile

장시간 작업 action은 완료 결과를 기다린 뒤 반환하지 않고 가능한 한 빨리 `jobId`를 반환한다.

```json
{
  "jobId": "job_123",
  "status": "queued"
}
```

공통 job 상태는 다음과 같다.

```text
queued     아직 실행 시작 전
running    실행 중
completed  전체 성공
partial    일부 성공 또는 일부 결과 보존
failed     terminal 실패
cancelled  정책에 따라 취소 완료
```

애드온 내부의 더 세밀한 상태는 이 공통 상태로 mapping하고 `details.phase`처럼 추가할 수 있다.

### 6.1 Job 응답

`job_status`, `job_wait`와 terminal submit 결과가 사용하는 공통 필드는 다음과 같다.

```json
{
  "jobId": "job_123",
  "status": "running",
  "progress": {
    "completed": 1,
    "total": 4
  },
  "artifacts": [],
  "error": null
}
```

- `job_wait`는 terminal 상태까지 server 내부에서 기다리는 기본 대기 수단이다.
- timeout 응답은 `timedOut: true`와 축약 진행 상태만 반환하고 결과·오류 본문을 반복하지 않는다.
- `jobs_list`는 잃어버린 ID 복구용이며 ID, 종류, 상태와 축약 진행률만 반환한다.
- terminal 결과의 공개 artifact와 오류 상세는 `job_status` 또는 `job_wait`에서 조회할 수 있어야 한다.
- 결과 대기에 짧은 `job_status` 반복 polling을 기본 흐름으로 안내해서는 안 된다.

### 6.2 취소와 unload

- `job_cancel`은 실제로 보장하는 중단 경계를 설명해야 한다.
- 외부 API에 이미 전달된 작업, 생성 비용 환불 또는 GPU kernel 즉시 중단을 보장하지 않으면
  그렇게 표현해서는 안 된다.
- model/Worker unload는 idle에서만 허용하는 것을 기본으로 한다.
- active 또는 queued 작업이 있을 때 unload가 작업을 취소해서는 안 되며 안정된 busy 오류를
  반환해야 한다.
- unload는 MCP 연결과 완료 job history를 종료하거나 제거해서는 안 된다.

## 7. 결과와 오류 계약

### 7.1 MCP CallToolResult

Hosted와 Standalone은 MCP `CallToolResult` 의미를 동일하게 유지한다.

- `content`: text, image, audio, resource, resource link type 보존
- `structuredContent`: AI가 다음 호출에 사용할 수 있는 구조화 결과
- `isError`: 도구 실행 오류 여부
- `_meta`: 공개가 허용된 transport·resource metadata

NainTail router는 애드온 결과를 성공 문자열로 축약하거나 모든 content를 JSON 문자열 하나로
이중 직렬화해서는 안 된다. 결과를 감쌀 때도 원본 content type과 structured fields를 보존한다.

### 7.2 오류 envelope

애드온 공개 오류는 최소한 다음 형태를 사용한다.

```json
{
  "code": "MODEL_NOT_READY",
  "message": "모델이 준비되지 않았습니다.",
  "retryable": true,
  "details": {}
}
```

- `code`는 대문자 snake case의 안정된 기계 식별자다.
- `message`는 사용자에게 바로 표시할 수 있는 짧은 설명이다.
- `retryable`은 같은 입력의 재호출 가능성을 뜻하며 자동 재시도 명령이 아니다.
- `details`에는 수정 가능한 조건과 안전한 진단만 넣는다.
- stack, token, 개인 경로와 원본 provider 응답 전체를 공개해서는 안 된다.
- Router는 host routing 오류와 addon 오류의 출처를 구분해 보존한다.

## 8. Artifact Profile

다른 애드온이 재사용할 수 있는 결과는 개발 PC 절대경로 대신 다음 참조를 사용한다.

```json
{
  "schema": "naintail.artifact-ref/v1",
  "addonId": "animatail",
  "artifactId": "output_456",
  "kind": "image",
  "scope": "session"
}
```

- Provider는 `artifactId`의 생성, 수명과 공개 metadata를 소유한다.
- NainTail resolver는 `addonId`와 `artifactId`를 통해 실제 자원을 찾는다.
- Consumer는 제공 애드온의 폴더 구조와 파일명을 추측해서는 안 된다.
- `session` 참조는 Provider Adapter가 살아 있는 동안만 유효하며 재시작 뒤 영속 ID로 간주하지 않는다.
- Hosted 결과는 절대경로를 제거하고, resolver만 Provider 경계 안의 실제 경로를 Consumer에 비공개로 전달한다.
- Consumer manifest의 `requires`가 Provider를 선언하지 않으면 resolver는 접근을 거부한다.
- 참조가 삭제·이동·만료됐으면 안정된 `ARTIFACT_NOT_FOUND` 또는 `ARTIFACT_EXPIRED`로 실패한다.
- 입력을 변경하는 작업은 원본을 덮어쓸지 새 artifact를 만들지 schema에 명시해야 한다.

현재 AnimaTail 완료 출력은 Hosted 호출에서 이 참조를 발행한다. NainTail resolver가 이를
CensorTail scan 입력으로 전달하고, CensorTail 저장 출력도 새 session artifactRef를 발행한다.

## 9. 승인과 annotations

- 모든 도구는 `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`를 실제 동작에
  맞게 선언해야 한다.
- NainTail `addon_call`은 선택한 도구의 annotations와 애드온 내부 승인 검증을 우회해서는 안 된다.
- 유료 외부 작업은 애드온이 비용 내역과 수치 상한을 확인한 뒤에만 submit한다.
- 파일 삭제, 덮어쓰기와 queue clear는 명확한 destructive 의미를 유지한다.
- Generic router의 client-side annotation 한계를 server-side 검증 약화의 이유로 사용하지 않는다.
- credential과 secret은 도구 인자·결과·job history·artifact metadata에 저장하지 않는다.

## 10. Hosted와 Standalone 동일성

같은 adapter, 입력과 dependency version을 사용하면 Hosted와 Standalone의 도구 해석 결과가
의미상 같아야 한다.

- Hosted: NainTail이 transport, adapter lifecycle과 routing을 소유한다.
- Standalone: 애드온 launcher가 같은 adapter를 자기 stdio server에 연결한다.
- 애드온은 Hosted에서 자기 `start()`를 다시 호출해 stdin/stdout을 점유해서는 안 된다.
- 두 형태는 Core, 입력 검증, 결과 serialization과 오류 mapping을 복제해서는 안 된다.
- data root와 dependency 우선순위는 `ADDON_DEVELOPMENT_CONTRACT.md`를 따른다.

같은 애드온의 Hosted MCP와 Standalone MCP를 동시에 실행하면 별도 프로세스 queue가 같은 data
root를 사용할 수 있다. 공유 broker나 lock 계약이 구현되기 전에는 애드온 하나당 MCP 연결
하나를 운영 원칙으로 둔다.

## 11. 호환성 규칙

현재 NaiTail과 AnimaTail의 공개 도구명은 기존 자동화 호환을 위해 유지한다. Profile 적용은
기존 도구를 즉시 삭제하거나 이름만 바꾸는 작업이 아니다.

- 기존 public tool name은 legacy alias로 유지할 수 있다.
- 새 adapter descriptor에 canonical operation을 명시한다.
- NainTail router는 canonical operation과 legacy name을 모두 조회할 수 있어야 한다.
- alias와 canonical operation은 같은 handler와 schema를 사용해야 한다.
- alias 제거가 필요하면 versioned migration과 deprecation 기간을 별도로 문서화한다.

현재 전환 상태는 다음과 같다.

| 애드온 | 현재 MCP | Profile 전환 |
|---|---|---|
| NaiTail | Standalone stdio와 `naintail_*` 도구 | Adapter 분리·Hosted routing 완료 |
| AnimaTail | Standalone stdio와 `anima_*` 도구 | Adapter 분리·Hosted routing 완료 |
| GalleryTail | MCP entry 없음 | 도메인 요구 확정 후 결정 |
| CensorTail | Standalone stdio와 `censortail_*` 9개 도구 | Adapter·Hosted routing 완료 |

## 12. 검증 Gate

MCP Profile 적용 애드온은 다음을 검증해야 한다.

1. Base `status`가 공통 필드와 실제 가용 상태를 반환한다.
2. 모든 list가 선택용 필드만 반환하고 개별 get이 전체 공개 내용을 반환한다.
3. list ID를 get과 action에 그대로 사용할 수 있다.
4. 비동기 action이 즉시 job ID를 반환하고 wait이 terminal 결과를 보존한다.
5. timeout wait이 결과 본문을 반복하지 않는다.
6. cancel과 unload가 보장하지 않는 강제 중단·환불을 주장하지 않는다.
7. text, structured content, image/resource와 오류가 Hosted routing에서도 손실되지 않는다.
8. 유료·파괴적 action의 annotations와 server-side 승인이 유지된다.
9. Standalone과 Hosted가 같은 adapter contract test를 통과한다.
10. 기존 public tool name을 사용하는 자동화가 호환 계층에서 계속 동작한다.

핵심 규칙은 다음과 같다.

> 애드온 MCP는 상태·발견·작업·결과의 공통 문법을 따르되, 각 도메인의 입력 의미는 자기
> 확장 schema로 소유한다.
