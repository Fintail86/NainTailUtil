# NainTailUtil MVP 구현 결과

작성일: 2026-08-15  
제품 버전: 0.1.0  
제품 루트: `NainTailUtil/`

NainTailUtil은 NainTail 애드온 호스트와 내장 애드온을 함께 제공하는 포터블 배포본이다.
NainTail은 홈·registry·실행 lifecycle을 소유하고, 아래 생성·갤러리·검열 기능은 각 애드온이
소유한다.

## 1. 구현 상태

MVP 제품 코드는 모두 개발 워크스페이스 안의 중첩 `NainTailUtil/` 폴더에만 들어 있다.
이 폴더에는 실행에 필요한 Electron 43.1.1 런타임도 포함되어 시스템 Node.js 없이 GUI와
CLI를 실행할 수 있다. 테스트, QA 하네스와 캡처 결과는 각각 루트 `Tests/`, `Tools/`,
`Artifacts/`에 분리했다.

구현한 수직 기능은 다음과 같다.

- `naintail.addon/v1` manifest와 `NaiTail`, `AnimaTail`, `GalleryTail`, `CensorTail` 내장 애드온
- NAI 의미를 알지 않는 얇은 NainTail Electron·CLI·MCP host와 애드온 registry
- NainTail MCP 단일 stdio와 축약 애드온 list/get/call, NaiTail Adapter lazy routing
- NaiTail MCP의 Core·도구 Adapter와 Standalone stdio composition root 분리
- manifest 수에 맞춘 동적 host 홈, 네 애드온 카드와 각 헤더의 홈 복귀
- 홈과 현재 활성 애드온 창의 숨김 전환에 의한 같은 애드온 재진입 상태 보존
- 기존 Core·Worker·UI·작품·프리셋·큐 전체의 `Addons/NaiTail/` 소유권 이동
- 기존 AnimaUtil의 생성 UI, CLI/MCP, Python 생성 Worker, CUDA runtime, 모델·LoRA,
  프리셋·출력의 `Addons/AnimaTail/` 소유권 이동
- 갤러리 UI·탐색 service의 `GalleryTail`, 자동검열 UI·Worker·출력의 `CensorTail` 분리
- CensorTail 폴더 단독 GUI 실행용 Electron·Python/CUDA·검열 모델과 standalone host 포함
- GalleryTail 설정 재사용의 host handoff와 CensorTail의 AnimaTail runtime/model 공유 의존성
- AnimaTail의 `anima:` protocol 사전 등록, 독립 IPC 생명주기와 애드온 종료 시 Worker 정리
- AnimaTail 헤더 브랜딩·홈 버튼과 홈 재진입 시 renderer 상태 보존
- 애드온 부재 시 정상 기동하는 host fallback과 애드온 entry 경계 이탈 차단
- 기존 제품 루트 사용자 데이터를 `Addons/NaiTail/`로 SHA-256 검증 이전하고
  `naintail.*` 저장 스키마는 그대로 유지
- headless Core, stdio JSONL NAI Worker, Electron/CLI adapter 분리
- Single V4.5 Full/Curated txt2img
- Single의 로컬 배치·큐와 `배치 × 큐` 총 장수 계산, 최대 100장 제출 제한
- Single·독립 멀티의 최대 16개 V4+ Vibe Transfer 카드와 Strength·Information Extracted·정규화
- `References/vibes/` 원본 해시 저장, 모델·Information Extracted별 `/ai/encode-vibe` 결과 캐시
- 캐시 여부에 따른 인코딩 비용과 4개 초과 생성 비용 표시, Precise Reference와 상호배타 처리
- Single·독립 멀티의 V4.5 Precise Reference 카드, 세 가지 참조 종류와 Strength·Fidelity
- 권장 3개 캔버스 중 최근접 종횡비 선택, 검은 레터박스 PNG 처리와 `References/precise/` 해시 저장
- 큐·결과 metadata에는 상대경로만 보존하고 Worker 직전에만 base64로 hydrate하는 참조 자산 경계
- NAI `director_reference_*` payload와 참조당 5 Anlas 비용 경고
- 공홈 웹 클라이언트 식 버전을 기록한 Core Anlas 예측기와 Single·멀티·작례 연구기·작품
  일반/캐릭터/전체 범위의 실제 작업 비용 합산
- 모든 생성 버튼의 `예상 N Anlas` 표시와 유료 예상 시 기본·Precise·Vibe 내역 확인 후 큐 등록
- V4.5 8개 Sampler, 4개 Scheduler, Guidance Rescale와 Decrisper의 UI·저장·복원·payload 연결
- 현재 V4.5 웹 계약에 맞춘 `autoSmea: false`와 구형 `sm`/`sm_dyn` 미전송
- 2026-08-11 웹 클라이언트 build 기준 Full/Curated Quality Tags 접미사 고정과 `text:` 절 앞
  삽입 시 구분자 정규화
- 독립 멀티 탭의 공통 작례·Prompt·UC, V4 캐릭터, 생성 설정과 최대 20개 슬롯
- 활성 멀티 슬롯의 원래 순번 보존, 공통값 합성, 한 Run·한 장 단위 순차 큐 materialization
- 멀티의 `활성 슬롯 × 로컬 배치 × 큐` 전개와 큐 → 슬롯 → 배치의 안정된 작업 순서
- 멀티 슬롯별 세션 이미지 무제한 누적과 PNG를 보존하는 명시적 화면 클리어
- 서브슬롯 프리셋을 fresh ID 멀티 슬롯으로 Append
- 작품 공통 prompt, UC와 생성 설정
- 캐릭터 없는 일반 슬롯 리스트
- 캐릭터 카드와 카드별 실제 슬롯 리스트
- Single과 작품의 V4 멀티 캐릭터 Prompt·UC, 활성 상태, 순서와 5×5 위치 선택
- 작품 슬롯 생성에서 모든 활성 카드를 독립 Character Caption으로 전송하고 소유 슬롯만 해당 카드에 합성
- 전역 서브슬롯 프리셋 CRUD와 일반/카드 리스트 Append
- 전역 프리셋 메뉴의 서브슬롯·작례 타입 분리
- 작례 프리셋 Prompt·UC CRUD와 싱글 작례 영역 불러오기
- 싱글 작업화면에서 작례 새 프리셋 저장·선택 프리셋 덮어쓰기
- 싱글의 기본 접힘 작례 영역과 기본 펼침 현재 프롬프트 영역
- 작례 연구기 탭의 등록 작가 리스트, 사용 체크박스와 0.05 단위 가중치 슬라이더
- 번호 직접 입력 재정렬과 제한 높이 세로 스크롤을 사용하는 2단 작가 카드
- 사용 체크 우선, 가중치 내림차순의 원클릭 작가 소팅
- 작례 연구기의 동일 폭 2열 작업면: 싱글형 현재 Prompt·캐릭터·생성 설정과 작례 Prompt·작가 슬라이더
- 활성 작가 가중치와 작례 Prompt·UC를 작례 프리셋으로 등록하고 싱글 선택 목록을 즉시 갱신
- 활성 작가만 대상으로 하는 범위 랜덤 조절·랜덤 1장 생성과 연구 설정 재시작 복원
- 연구 결과 카드에서 해당 이미지의 사용 작가·가중치 조합을 등록 목록에 다시 적용
- Append 시 fresh slot ID를 발급하는 독립 복사
- 한 요청 한 장, 동시 실행 1의 로컬 순차 큐
- 모든 반복 작업의 NAI `nSamples: 1` 강제와 Single·멀티 생성부의 실시간 총 장수 표시
- 이미 전송된 한 장까지만 완료하는 큐 클리어와 현재 이미지 후 중단
- 실패 Run의 미전송 항목 취소와 수동 재개
- NAI ZIP 응답 PNG 추출, 상대경로 출력 저장, NainTailUtil iTXt metadata
- 작품 JSON에 결과의 작품/캐릭터/슬롯 관계 복원
- Electron `safeStorage` 토큰 저장과 CLI 환경변수 토큰
- 제한된 IPC, context isolation, sandbox와 strict CSP
- GUI Single/멀티/작례 연구기/작품/프리셋/설정/큐 화면
- AnimaUtil 생성 작업면을 참조한 Single 좌측 고정 제어부, 중앙 대형 미리보기·최근 결과
  스트립과 우측 상시 생성 큐 레이아웃
- Single 전용 2열 기본 생성 설정과 접이식 고급 설정, 한 줄 Prompt·UC를 쓰는 접이식
  캐릭터 카드
- Single 미리보기의 화면 맞춤·1:1·10%–800% 휠 줌·제한된 드래그 이동과 배율 표시
- 선택 결과의 Prompt·UC·캐릭터·생성 설정 복원, 폴더에서 보기와 Windows 휴지통 이동
- Single 결과에서 Vibe·Precise 카드와 각 조절값 복원
- Pretendard Variable 일반 UI와 JetBrains Mono Variable 숫자·식별자 typography
- 22/15/13/12/11px 공통 텍스트 토큰과 전역 `:focus-visible`
- 앱 내부 삭제 확인과 저장 전 편집의 저장·버리기·취소 dirty-state 처리
- 비동기 action 중복 제출 방지와 큐의 전송 전/전송됨/저장 완료 상태 문구
- 포터블 BAT GUI 및 CLI launcher
- 포터블 stdio MCP launcher와 dependency-free JSON-RPC/MCP protocol adapter
- NaiTail·AnimaTail 폴더별 standalone GUI·CLI·MCP host와 전용 Electron runtime
- standalone 모드의 애드온 내부 데이터 루트와 host 모드의 기존 데이터 경계 동시 유지
- 작품·프리셋의 식별자 전용 list와 명시적 개별 get, 세션 job ID 복구용 축약 jobs list
- 즉시 jobId를 반환하는 Single·멀티·작례 연구기·작품 생성과 30~60초 `job_wait`
- timeout wait의 결과·오류 본문 생략, terminal 결과의 경로·Seed·크기·슬롯 정보 축약
- MCP 유료 예상의 `allowPaidAnlas`·`maxAnlas` 2단계 승인과 Run 단위 미전송 작업 취소

## 2. 포터블 경계

- 제품 코드와 release asset: `NainTailUtil/`
- 개발 문서: `Docs/`
- 자동 테스트: `Tests/`
- 검증 도구: `Tools/`
- 시각 QA 캡처: `Artifacts/` (Git 제외)
- Electron runtime: `NainTailUtil/runtime/electron/`, 43.1.1, 75 files, 347.27 MiB
- AnimaTail Python/CUDA runtime: r1 local runtime ready, 지원 자산 ready
- AnimaTail catalog: 생성 모델 5개, LoRA 5개
- NaiTail standalone 경계: 130 files, 349.62 MiB
- AnimaTail standalone 경계: 34,866 files, 26.91 GiB
- GalleryTail: 16 files, 2.35 MiB · CensorTail: 17 files, 2.43 MiB

프로젝트와 프리셋, 출력, 자격증명은 모두 제품 루트 안에 저장된다. 작품 결과에는
`relativePath`만 저장하며 개발 PC의 절대경로나 file URL은 저장하지 않는다.

## 3. 검증 결과

자동 검증 명령:

```powershell
npm run check
```

검증 범위:

- Core 및 저장소 계약 테스트
- 네 manifest 발견, 명시적 순서·의존성·protocol 선언, entry 경계와 기본 애드온 선택
- host 홈 4카드 동적 구성, 각 애드온 선택과 공통 홈 버튼 IPC 계약
- AnimaTail 번들의 Gallery/Censor 표면 부재와 분리 renderer별 전용 API 표면
- GalleryTail 설정 handoff의 초기 이벤트 버퍼링과 CensorTail 공유 runtime 경로
- 애드온이 없는 제품 루트의 host fallback과 host source의 NAI 의미 비소유
- 이동 후 기존 제품 데이터 루트와 Addons 내부 Worker 경로 호환
- 프리셋 독립 Append와 중복 ID 거부
- 작례·서브슬롯의 별도 schema/디렉터리 저장과 타입 오용 거부
- 싱글 작례 Prompt·UC의 선행 합성
- 작례 연구기의 활성 작가 NAI 가중치 직렬화, 비활성 제외와 1장 materialization
- 작례 연구기의 현재 Prompt와 등록용 작례 Prompt 분리, 캐릭터 전달과 작례 프리셋 등록 범위
- 작례 연구 설정 재시작 복원과 전용 output 경로
- 일반/캐릭터 멀티 materialization
- 독립 멀티의 비활성 슬롯 제외·원래 순번 보존·공통-only 변형·슬롯 설정 override
- Single `배치 × 큐`와 멀티 `활성 슬롯 × 배치 × 큐` 전개 순서, 100장 제한과 요청당 1장 불변
- Precise Reference descriptor 검증, 자산 해시 저장·hydrate, base64 metadata 비포함과 director payload mapping
- Vibe descriptor·상호배타 검증, 원본 hydrate, V4 인코딩 캐시 키와 Strength 정규화 payload mapping
- 같은 슬롯의 Run 간 결과 누적, 슬롯별 그룹 표시와 세션 클리어
- 최대 6명 제한, 비활성 카드 제외, A1~E5 좌표 중심값과 캐릭터별 UC payload
- 빈 최종 prompt의 외부 큐 진입 전 거부
- 큐 clear/stop의 active-one-completes 계약
- 실패 Run 중단과 pause
- V4.5 한 장 payload, Opus 무료 조건, 비Opus 기본비와 Precise·Vibe 수치 비용 계산
- 작례 연구기와 작품 범위별 슬롯 수 비용 계산, 유료 예상 시 큐 진입 전 확인
- V4.5 고급 설정 wire mapping과 Quality Tags 정확 문자열·삽입 순서 회귀 검사
- NAI ZIP PNG 추출
- PNG metadata 주입과 교체
- mock Worker 기반 output 저장, 재시작 복원과 상대경로 보존
- Electron 보안 설정과 release 폴더 test/fixture 부재
- 전체 제품 JavaScript 문법 검사
- 임시 경로로 제품 코드 복사 후 CLI help smoke
- MCP initialize, tools/list, status와 축약 작품 list의 실제 포터블 BAT stdio round-trip

별도 runtime 검증:

- 범용 CLI host → NaiTail CLI entry의 `status`와 Worker ping: 성공
- 범용 CLI host → AnimaTail CLI entry의 `status`: runtime ready, 모델 5개·LoRA 5개
- NaiTail 폴더 전용 CLI `status`와 로컬 Worker ping: 성공, data root가 NaiTail 폴더임을 확인
- AnimaTail 폴더 전용 CLI `status`: runtime ready, 모델 5개·LoRA 5개
- 폴더 전용 MCP round-trip: NaiTail 16 tools, AnimaTail 10 tools와 status 성공
- 각 폴더의 전용 Electron standalone GUI 초기화와 상위 host 홈 버튼 부재 확인: 성공
- NainTail federation host의 5개 축약 도구 → NaiTail 16개 도구 조회·상세·status·작품 list
  무손실 routing round-trip: 성공
- `NAINTAIL_ADDON_ID=naitail` 호환 selector → NaiTail MCP 16개 도구 round-trip: 성공
- `NAINTAIL_ADDON_ID=animatail` → AnimaTail MCP initialize/tools/list/status round-trip: 10 tools 성공
- 실제 Electron의 host 홈에서 네 애드온 각각 홈 복귀·재진입과 renderer 상태 보존 smoke: 성공
- 같은 Electron 프로세스의 NaiTail → AnimaTail → GalleryTail → CensorTail 교차 활성화: 성공
- `Addons/`를 제외한 임시 host 복사본의 실제 Electron fallback 초기화 smoke: 종료 코드 0
- 포터블 Electron을 Node mode로 실행한 CLI `status`: 성공
- NAI Worker `ping`: protocol 1 ready
- 실제 Electron main/preload/renderer 숨김 초기화 smoke: 종료 코드 0
- mock IPC를 사용한 실제 renderer 6화면 PNG 캡처와 시각 검사
- 1480 × 940 및 1080 × 720 host 홈의 4카드 렌더링과 스크롤 부재 시각 검사
- AnimaTail·GalleryTail·CensorTail 분리 화면의 실제 Electron 캡처와 레이아웃 검사
- 시각 검사에서 발견한 hidden empty-state 중복 표시를 수정하고 재검증
- 번들 Pretendard와 JetBrains Mono의 실제 Electron font load 및 렌더 최소 글자 11px 확인
- 기본 창, 1080 × 720, 삭제 확인창과 dirty-state 저장·버리기·취소 화면 시각 검사
- Single 빈 상태와 실제 결과 이미지 상태에서 대형 미리보기·선택 결과 스트립 렌더링 검사
- 미리보기 1:1 전환·휠 확대·화면 맞춤 복귀와 생성값 복원을 실제 Electron DOM에서 검사
- 선택 결과 파일 action은 `outputs/` 바깥 경로 거부와 작품 결과 참조 제거를 자동 검사
- code/config 경계를 새 임시 경로로 복사한 뒤 BAT `status`와 Worker ping 성공
- 원본 AnimaUtil 대비 AnimaTail `Models`, `outputs`, `runtime/versions` read-only mirror 비교:
  세 영역 모두 차이 없음(robocopy `/L` 종료 코드 0)
- 원본과 다른 `Addons/AnimaTail/` 위치에서 runtime locator·지원 자산·model catalog 상태 확인 성공

## 4. 아직 수행하지 않은 외부 검증

실제 NovelAI 계정에 대한 생성 POST는 수행하지 않았다. 토큰 사용과 계정 외부 요청은 별도
승인이 필요한 gate이며, 현재 검증은 PeroPix 요청 구조 대조, payload 단위 테스트와 mock
Worker 통합까지다. 따라서 코드와 포터블 앱 MVP는 완성했지만 실제 NAI click-to-output 및
실제 생성 중단 타이밍은 유효한 토큰을 GUI에 저장한 뒤 한 장 요청으로 acceptance 해야 한다.

NaiTail Adapter의 Hosted·Standalone stdio round-trip과 AnimaTail 기존 MCP server는 검증했다.
CensorTail의 자동검열 UI와
Worker는 공유 Python/CUDA runtime·모델 readiness 및 화면 로딩까지 확인했다. 다만 이번 분리
검증에서는 실제 로컬 Anima 이미지 생성과 이미지에 대한 자동검열 GPU 추론은 새로 수행하지 않았다.
