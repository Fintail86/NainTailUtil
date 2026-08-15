# NainTail MCP 애드온 연합 설계

- 상태: 3차 수직 구현 완료 · NaiTail/AnimaTail/CensorTail federation
- 현재 구현: NainTail 단일 stdio router, 3개 Adapter, AnimaTail → CensorTail → 결과 artifact 전달
- 다음 범위: GalleryTail MCP 도메인과 영속 artifact ID 필요성 결정

## 1. 목적

NainTail MCP는 개별 애드온 MCP를 없애는 대체물이 아니다. 하나의 MCP 연결에서 설치된
애드온을 탐색하고, 선택한 애드온의 도구를 호출하며, 그 결과를 AI가 읽고 다음 애드온 작업에
재사용할 수 있게 하는 **연합 router**다.

두 실행 형태는 다음처럼 공존한다.

| 실행 형태 | 용도 |
|---|---|
| NainTail MCP | 여러 애드온의 발견, 호출과 애드온 간 작업 연결 |
| 애드온 Standalone MCP | 특정 애드온만 작은 도구 목록으로 집중 사용, 폴더 단독 포터블 실행 |

여기서 애드온 조작은 GUI의 버튼과 입력창을 원격 제어한다는 뜻이 아니다. 각 애드온이 자기
Core 기능을 MCP 도구로 공개하고, NainTail이 그 도구 호출을 중계한다는 뜻이다.

## 2. 현재 동작

현재 `NainTailUtil_MCP.bat`를 selector 환경변수 없이 실행하면 NainTail federation server가
기동한다. 최초 `tools/list`에는 아래 host routing 도구 5개만 노출한다.

```text
naintail_addons_list
naintail_addon_get
naintail_addon_tools_list
naintail_addon_tool_get
naintail_addon_call
```

NaiTail과 AnimaTail manifest는 별도 `mcpAdapter` entry를 선언한다. Router는 도구 목록·상세를
축약 조회하고 실제 도구를 호출할 때 Adapter를 lazy activation한다. 각 Standalone MCP는 같은
Adapter의 도구 정의와 handler를 기존 stdio server로 감싸므로 기존 16개·10개 도구 계약을 유지한다.

`NAINTAIL_ADDON_ID=naitail` 또는 `animatail`을 명시하면 기존 단일 애드온 MCP entry를 직접
실행하는 호환 모드로 동작한다. 기본 federation에서는 NaiTail과 AnimaTail 모두 `federated`로
표시되고 `addon_call` 대상이 된다. CensorTail도 9개 검출·저장 도구를 Hosted routing으로
제공하며 GalleryTail만 현재 MCP entry가 없다.

## 3. 목표 구조

stdio transport는 NainTail MCP server 하나만 소유한다. 애드온은 transport가 아닌 MCP
adapter를 제공하고, NainTail router가 adapter를 호출한다.

```text
MCP Client
    │ stdio 1개
    ▼
NainTail MCP Server
    │
    └─ Federation Router
         ├─ NaiTail MCP Adapter ─── NaiTail Core       [구현]
         ├─ AnimaTail MCP Adapter ─ AnimaTail Core     [구현]
         ├─ GalleryTail MCP Adapter                    [후속]
         └─ CensorTail MCP Adapter ─ Censor service    [구현]
```

같은 adapter는 Standalone에서 애드온 전용 stdio server로 감싼다.

```text
Addon Core
    ▲
Addon MCP Adapter
    ├─ NainTail Federation Router에서 호출
    └─ Standalone MCP stdio server에서 호출
```

Hosted와 Standalone은 도구 정의, 입력 검증, Core 호출과 결과 serialization을 복제하지 않는다.
달라지는 것은 transport와 composition root뿐이다.

## 4. 애드온 MCP adapter 계약

공통 명령 형태, list/get, job, 결과·오류와 호환성의 규범 계약은
[`ADDON_MCP_PROFILE.md`](../ADDON_MCP_PROFILE.md)를 따른다. 이 문서는 NainTail router에서 그
Profile을 어떻게 조립하는지만 정의한다.

정식 adapter는 다음 기능을 제공한다.

```text
createAdapter(hostContext)
├─ info()
├─ toolsList()
├─ toolGet(toolName)
├─ callTool(toolName, arguments)
└─ close()
```

- `info`: 애드온 ID, 버전, MCP 지원 상태와 간략 capability
- `toolsList`: 도구 선택에 필요한 이름과 짧은 설명만 반환
- `toolGet`: 선택한 도구 하나의 전체 input schema와 annotations 반환
- `callTool`: 기존 애드온 MCP와 같은 검증·Core 호출·결과 형식을 사용
- `close`: Worker, listener와 기타 애드온별 자원을 정리

애드온의 기존 `start()`는 adapter를 stdio server에 연결하는 Standalone composition root로
축소한다. NainTail host는 `start()`를 중첩 호출하지 않고 adapter를 직접 생성한다.

## 5. NainTail MCP의 축약 도구 표면

모든 애드온 도구 schema를 최초 `tools/list`에 펼치면 애드온 수에 비례해 컨텍스트가 커진다.
기본 NainTail MCP는 다음과 같은 얇은 discovery·routing 도구만 노출한다.

| 도구 | 반환·동작 |
|---|---|
| `naintail_addons_list` | `id`, `name`, 가용 상태, MCP 지원 여부만 반환 |
| `naintail_addon_get` | 지정한 애드온 하나의 버전·의존성·capability·상태 반환 |
| `naintail_addon_tools_list` | 지정한 애드온의 도구명과 짧은 설명만 반환 |
| `naintail_addon_tool_get` | 지정한 도구 하나의 전체 schema·annotations 반환 |
| `naintail_addon_call` | `addonId`, `toolName`, `arguments`로 실제 도구 호출 |

ID와 도구명을 이미 알고 있으면 list를 생략하고 get 또는 call로 바로 이동한다. 목록에는
Prompt 본문, 파일 경로, preview, 모델 상세, 결과 metadata와 전체 input schema를 넣지 않는다.

도구 annotations와 비용·파괴적 작업 확인은 `toolGet` 결과에 보존하고 server에서도 다시
검증한다. 범용 `addon_call`이 애드온의 승인 절차, Anlas 상한 또는 입력 검증을 우회해서는 안 된다.

## 6. 결과 무손실 전달

NainTail은 애드온 결과를 `성공` 같은 짧은 문자열로 바꾸거나 임의 요약하지 않는다. AI가
결과를 조회하고 다음 호출에 활용할 수 있도록 다음 필드를 의미 손실 없이 전달한다.

- MCP `content`의 text, image, resource와 resource link
- `structuredContent`
- `isError`와 공개 오류 code·details
- `_meta` 중 공개가 허용된 값
- `jobId`, 상태, 진행률과 후속 호출 식별자
- 생성 결과의 크기, Seed, 모델과 공개 metadata

Router가 반환하는 결과는 호출 출처를 식별할 수 있어야 한다.

```json
{
  "structuredContent": {
    "jobId": "job_123",
    "status": "completed",
    "result": {
      "outputs": [
      {
        "artifactRef": {
          "schema": "naintail.artifact-ref/v1",
          "addonId": "animatail",
          "artifactId": "output_456",
          "kind": "image",
          "scope": "session"
        },
        "width": 1024,
        "height": 1536,
        "seed": 12345
      }
      ]
    }
  },
  "_meta": {
    "naintail": {
      "addonId": "animatail",
      "toolName": "anima_job_wait"
    }
  }
}
```

원본 애드온 결과에 image content나 resource link가 있다면 outer NainTail tool result에도 같은
content type으로 전달한다. 모든 결과를 JSON 문자열 하나로 이중 직렬화하지 않는다.

## 7. 작업과 대기

장시간 작업은 기존 애드온의 비동기 submit → status/wait/cancel 계약을 유지한다. NainTail은
job을 자기 작업인 것처럼 재해석하지 않고, 어느 애드온이 소유하는지 포함한 참조로 routing한다.

```text
<addonId>:<jobId>
animatail:job_123
naitail:job_456
```

현재는 `naintail_addon_call`로 해당 애드온의 기존 job status/wait/cancel을 직접 호출한다.
두 Adapter 동시 검증 결과 한 애드온의 wait가 다른 애드온 호출을 막지 않고, `addonId`가 작업
소유권을 이미 명확히 보존한다. 따라서 공통 Job Router는 현 단계에서 도입하지 않는다. 호스트가
통합 작업 목록이나 애드온 간 자동 파이프라인을 소유하게 될 때만 복합 jobRef를 추가한다.
대기 응답은 timeout마다 결과 본문을 반복하지 않고 축약 상태만 반환하며, terminal 응답에서만
최종 결과를 전달한다.

애드온의 모델 unload, 큐 중단과 취소 정책도 해당 애드온이 계속 소유한다. NainTail 연결을
유지한다는 이유로 활성 또는 대기 작업을 임의 취소해서는 안 된다.

## 8. 애드온 간 결과 재사용

AI는 한 애드온의 구조화된 결과를 읽고 다른 애드온 호출의 입력으로 사용할 수 있다.

```text
AnimaTail 생성
  → anima_job_wait
  → artifactRef 획득
  → host resolver가 CensorTail scan 입력으로 등록
  → CensorTail scan/wait/result_get/save
  → CensorTail 출력 artifactRef 획득
  → GalleryTail에서 후처리 결과 조회               [후속]
```

애드온 간 파일 전달에는 개발 PC 절대경로나 상대 폴더 추측을 사용하지 않는다. 목표 공통 참조는
다음과 같다.

```json
{
  "schema": "naintail.artifact-ref/v1",
  "addonId": "animatail",
  "artifactId": "output_456",
  "kind": "image",
  "scope": "session"
}
```

NainTail resolver가 참조를 실제 자원으로 해석하고, 소비 애드온에는 필요한 읽기 capability만
전달한다. 제공 애드온이 공개하지 않은 내부 폴더 구조를 소비 애드온이 추측해서는 안 된다.

AnimaTail Hosted Adapter는 완료 출력에 session 수명의 `artifactRef`를 붙이고 절대경로를 공개
결과에서 제거한다. Resolver는 소비 애드온의 `requires` 선언과 Provider 폴더 경계를 검사한 뒤
실제 경로를 비공개로 해석한다. CensorTail은 이를 scan 작업으로 받고, 검출 상세는 이미지별
`result_get`으로 조회하며, save 완료 출력에는 CensorTail 소유의 새 artifactRef를 붙인다.

## 9. lifecycle과 동시 연결

- Adapter는 첫 조회 또는 호출 시 lazy activation할 수 있다.
- MCP 연결은 유지하되, idle 모델·Worker 해제 여부는 애드온별 정책을 따른다.
- NainTail 종료 시 활성 adapter의 `close()`를 호출한다.
- 한 애드온의 오류가 NainTail transport와 다른 adapter를 함께 종료해서는 안 된다.
- 같은 애드온을 NainTail MCP와 Standalone MCP로 동시에 열면 서로 다른 프로세스의 큐가 같은
  data root를 사용할 수 있다.

공유 queue broker나 파일 lock 계약이 생기기 전까지는 **애드온 하나당 MCP 연결 하나**를 운영
원칙으로 둔다. 중복 연결을 허용하게 되면 작업 소유권, 동시 쓰기와 중복 생성 방지부터 해결한다.

## 10. 호환성과 구현 상태

기존 애드온 Standalone MCP 도구명과 결과 계약은 유지한다. NainTail router의 관리 도구명은
기존 NaiTail `naintail_*` 도구와 충돌하지 않게 위의 `naintail_addon*` 범위로 제한한다.

| 단계 | 상태 |
|---|---|
| 공통 Adapter 구조 validator와 contract test | 완료 |
| NaiTail transport/Adapter 분리 | 완료 |
| NaiTail Standalone stdio 하위 호환 | 완료 |
| NainTail 단일 stdio와 축약 list/get/call | 완료 |
| text·structuredContent·image·metadata 무손실 routing test | 완료 |
| AnimaTail Adapter 전환 | 완료 |
| NaiTail·AnimaTail 동시 호출과 wait 격리 | 완료 |
| 공통 Job Router | 현 단계 미도입 결정 |
| session `artifactRef` resolver | 완료 |
| AnimaTail → CensorTail 내부 입력 등록 | 완료 |
| CensorTail 공개 MCP 9개 도구와 순차 job queue | 완료 |
| AnimaTail → CensorTail scan/save/output artifact 수직 흐름 | 완료 |
| GalleryTail 공개 MCP 도구 | 후속 |

## 11. 검증 Gate

현재 1차 수직 구현에서 통과한 Gate:

- NainTail MCP 연결 하나의 `tools/list`가 작고 고정된 host routing 도구만 반환한다.
- 애드온 목록과 도구 목록은 선택 식별자만, 상세 schema는 개별 get에서 반환한다.
- NaiTail 호출 결과가 Standalone MCP 결과와 의미상 동일하다.
- text, structured content, image/resource와 오류 결과가 router를 통과해도 손실되지 않는다.
- NainTail과 애드온 `start()`가 같은 stdio를 동시에 점유하지 않는다.
- 유료·파괴적 작업의 기존 확인 절차가 host routing에서도 우회되지 않는다.
- Standalone MCP launcher와 기존 자동화의 하위 호환이 유지된다.

두 번째 Adapter에서 통과한 Gate:

- NaiTail과 AnimaTail 호출 결과가 각 Standalone MCP 결과와 의미상 동일하다.
- 한 애드온의 장시간 작업을 기다리는 동안 다른 애드온 discovery가 가능하다.
- 애드온 오류나 unload가 NainTail MCP 연결과 다른 애드온 job history를 제거하지 않는다.
- Hosted AnimaTail 결과는 절대경로를 노출하지 않고 유효한 session artifactRef를 제공한다.
- 선언되지 않은 Consumer는 Provider artifact 해석을 거부당한다.

핵심 계약은 다음과 같다.

> NainTail MCP는 하나의 transport로 여러 애드온 adapter를 호출하고, 애드온의 구조화된 결과를
> 손실 없이 AI에 되돌려 다음 애드온 작업에 재사용할 수 있게 한다.
