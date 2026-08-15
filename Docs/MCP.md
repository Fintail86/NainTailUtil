# NainTailUtil MCP

## 현재 구조와 목표 구조

MCP BAT는 범용 `app/mcp/main.cjs` 호스트를 실행한다. selector를 지정하지 않은 기본 연결은
NainTail federation server이며, host routing 도구 5개를 통해 MCP Adapter를 선언한 애드온을
조회·호출한다. 현재 federation 대상은 NaiTail과 AnimaTail이다.

`NAINTAIL_ADDON_ID=naitail` 또는 `animatail`을 설정하면 해당 애드온의 기존 MCP entry를 직접
실행하는 호환 모드가 된다. transport 소유권, 축약 list/get/call, 결과 무손실 전달과
`artifactRef` 계약은
[`NainTail/MCP_FEDERATION.md`](NainTail/MCP_FEDERATION.md)를 따른다.

모든 애드온 MCP의 공통 명령·상태·list/get·job·결과 형식은 정식
[`ADDON_MCP_PROFILE.md`](ADDON_MCP_PROFILE.md)를 따른다. 도메인별 입력 schema는 각 애드온이
계속 소유한다.

- 전송: 로컬 stdio
- 런처: 제품 루트 `NainTailUtil_MCP.bat`
- 런타임: 제품에 포함된 Electron을 `ELECTRON_RUN_AS_NODE=1`로 실행
- 프로토콜: MCP `2025-06-18`, `2025-03-26`, `2024-11-05` 협상 지원

MCP는 GUI나 CLI를 자동 조작하지 않는다. NainTail은 단일 stdio transport와 routing을 소유하고,
선택된 애드온 Adapter가 자기 Core·저장소·Worker를 사용한다. stdout은 JSON-RPC 전용이며
시작·오류 로그는 stderr로만 보낸다.

## 호스트 등록

Windows에서 BAT를 직접 실행하지 못하는 MCP host는 `cmd.exe`를 사용한다. MCP Node 프로세스에는
GUI의 Windows `safeStorage` 복호화 권한을 전달하지 않는다. 생성 기능을 사용할 host 환경에
`NAINTAIL_NAI_TOKEN`을 설정한다.

```json
{
  "mcpServers": {
    "naintailutil": {
      "command": "C:\\Windows\\System32\\cmd.exe",
      "args": [
        "/d",
        "/s",
        "/c",
        "D:\\Portable\\NainTailUtil\\NainTailUtil_MCP.bat"
      ],
      "env": {
        "NAINTAIL_NAI_TOKEN": "YOUR_PERSISTENT_NAI_TOKEN"
      }
    }
  }
}
```

AnimaTail만 별도 MCP 서버로 등록할 때는 같은 launcher를 사용하고 selector만 추가한다.

```json
{
  "mcpServers": {
    "animatail": {
      "command": "C:\\Windows\\System32\\cmd.exe",
      "args": ["/d", "/s", "/c", "D:\\Portable\\NainTailUtil\\NainTailUtil_MCP.bat"],
      "env": {
        "NAINTAIL_ADDON_ID": "animatail"
      }
    }
  }
}
```

AnimaTail은 `anima_status`, 축약 `anima_models_list`·`anima_presets_list`, 개별
`anima_preset_get`, 비동기 generate/status/wait/cancel과 idle model unload를 제공한다. 목록은
선택용 최소 필드만 반환하고 전체 프리셋 내용은 개별 get으로 읽는 규칙을 그대로 유지한다.

## NainTail federation 호출 순서

기본 NainTail MCP 연결은 다음 순서를 사용한다.

```text
ID를 모를 때만 naintail_addons_list
  → naintail_addon_get(addonId)
  → 도구명을 모를 때만 naintail_addon_tools_list(addonId)
  → 사용할 하나만 naintail_addon_tool_get(addonId, toolName)
  → naintail_addon_call(addonId, toolName, arguments)
```

현재 NaiTail과 AnimaTail은 `federated`, GalleryTail·CensorTail은 `none`으로 표시된다.
Router는 각 Adapter를 최초 상세 조회 또는 호출 시 lazy activation하며, 종료 시 Adapter의
`close()`를 호출한다. `addon_call` 결과는 원본 `content`, `structuredContent`, `isError`와 `_meta`를
보존하고 출처 `addonId`·`toolName`만 metadata에 추가한다.

AnimaTail 완료 결과는 Hosted 호출에서 절대경로 대신 session `artifactRef`를 제공한다. 이 참조는
호스트 resolver가 dependency와 폴더 경계를 검사해 CensorTail 내부 입력으로 해석한다. 공개
CensorTail MCP 도구는 아직 없으므로 현재 AI가 검열까지 호출하는 표면은 후속 범위다.

## 애드온 폴더 단독 등록

전체 NainTailUtil host 없이 애드온 폴더 하나만 배치한 경우 각 폴더의 전용 MCP launcher를
직접 등록한다. selector 환경변수는 필요하지 않다.

```text
<NaiTail 폴더>\NaiTail_MCP.bat
<AnimaTail 폴더>\AnimaTail_MCP.bat
```

두 launcher 모두 같은 애드온 폴더의 `runtime/electron/electron.exe`를 Node mode로 실행하며,
저장소·런타임·모델 경로도 상위 NainTailUtil이 아니라 해당 폴더를 기준으로 계산한다.

토큰을 설정하지 않아도 discovery와 저장 데이터 조회는 가능하지만 생성은
`NAI_TOKEN_MISSING`으로 거부된다. 토큰은 프로젝트·프리셋·작업 기록이나 도구 응답에 포함하지 않는다.

## 토큰 절약 discovery 계약

- `naintail_projects_list`: `id`, `name`, `characterCount`, `generalSlotCount`만 반환
- `naintail_project_get`: 지정한 작품 하나의 전체 Prompt·UC·설정·카드·슬롯 반환
- `naintail_presets_list`: `id`, `name`, `type`, `itemCount`만 반환
- `naintail_preset_get`: 지정한 프리셋 하나의 전체 내용 반환
- `naintail_artist_study_get`: 저장된 연구 설정 전체 반환

목록 응답에는 파일명·경로·Prompt 미리보기·본문·결과 metadata를 넣지 않는다. ID를 이미 알면 목록을
건너뛰고 바로 `get` 또는 생성 도구를 호출한다.

## 생성과 Anlas 승인

- `naintail_generate_single`
- `naintail_generate_multi`
- `naintail_generate_artist_study`
- `naintail_generate_project`

생성 도구는 설정을 materialize하고 구독 상태를 최대 5분 캐시해 실제 작업 수 기준 예상 Anlas를
계산한다. 무료 예상이면 즉시 Core 큐에 넣고 `jobId`를 반환한다. 예상 비용이 1 이상이면 첫 호출은
`ANLAS_CONFIRMATION_REQUIRED`와 `details.estimate`, 권장 재호출 값을 반환하며 큐를 변경하지 않는다.

사용자가 승인한 뒤 같은 요청에 아래 두 필드를 넣어 다시 호출한다.

```json
{
  "allowPaidAnlas": true,
  "maxAnlas": 25
}
```

새 예상액이 `maxAnlas`를 넘으면 `ANLAS_LIMIT_EXCEEDED`로 다시 중단한다. 이 구조는 MCP host의 일반
도구 승인과 별개로 NAI 유료 요청에 수치 상한을 둔다.

## 비동기 작업과 축약 응답

- `naintail_jobs_list`: 현재 세션의 `jobId`, 모드, 상태, 진행 수, 예상 Anlas만 반환해 ID 복구에 사용
- `naintail_job_status`: 지정한 작업의 현재 상태를 한 번 확인
- `naintail_job_wait`: terminal 상태까지 서버 내부에서 대기
- `naintail_job_cancel`: 해당 Run의 미전송 작업만 취소
- `naintail_queue_clear`: 모든 Run의 미전송 작업 취소
- `naintail_queue_resume`: 실패로 일시정지된 Core 큐 재개

`job_wait` 자동 시간은 `clamp(예상 이미지 수 × 5초, 30초, 60초)`다. timeout이면 Prompt·결과·오류
본문을 반복하지 않고 상태와 진행 수만 반환한다. `wait.timedOut=true`이면 같은 도구를 다시 호출한다.
terminal 응답은 생성 이미지의 경로·Seed·크기·모델·슬롯 식별 정보와 축약 오류만 반환한다.

`job_cancel`과 큐 클리어는 NAI에 이미 전송된 한 장을 강제 abort하지 않는다. 해당 이미지는 결과를
수신·저장하고 아직 전송하지 않은 작업만 취소한다.

## 권장 호출 순서

```text
필요할 때만 naintail_status
  -> ID를 모를 때만 projects_list / presets_list
  -> 내용이 필요한 한 항목만 project_get / preset_get
  -> generate_* 호출
  -> 유료 확인 오류면 사용자 승인 후 allowPaidAnlas + maxAnlas로 재호출
  -> jobId 보관
  -> 일반적으로 job_wait
  -> timedOut=true이면 job_wait 재호출
  -> jobId를 잃었을 때만 jobs_list
```

MCP 작업 기록은 현재 서버 세션 안에서 최대 100개, 활성 작업은 최대 20개다. 이미지 요청은 Core
큐에서 계속 `n_samples: 1`, 동시 전송 1을 유지한다.
