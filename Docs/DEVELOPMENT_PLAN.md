# NainTailUtil 개발 계획

- 상태: MVP 구현 완료 · 4개 내장 애드온 경계 적용
- 기준일: 2026-08-15
- 대상 워크스페이스: 저장소 루트
- 실제 포터블 제품 루트: `NainTailUtil/`

## 1. 제품 목표

NainTailUtil은 NainTail 애드온 호스트와 내장 애드온을 함께 제공하는 Windows용 포터블
플랫폼이다. NainTail은 manifest 기반 홈, 실행·전환과 공용 의존성 연결을 소유하고, 실제
생성·갤러리·검열 기능은 각 애드온에 남긴다.

NAI 기능 전체는 `NaiTail`, 로컬 Anima 생성은 `AnimaTail`, 생성 결과 탐색은 `GalleryTail`,
로컬 자동검열은 `CensorTail`이 소유한다. 얇은 NainTail 호스트는 manifest와 의존성을 발견해
지원되는 GUI, CLI, MCP 진입점을 실행하고, 도메인 로직·Worker·사용자 데이터는 각 애드온
경계에 남긴다. Hosted Python/CUDA 런타임은 NainTail이 통합 관리하고, 각 Standalone 애드온은
자기 포터블 런타임을 포함한다. 생성 모델·LoRA·검열 모델은 해당 애드온이 소유한다.

GUI는 NainTail 호스트가 manifest 수에 맞춰 동적으로 만드는 홈에서 시작한다. 현재 네 카드는
NaiTail, AnimaTail, GalleryTail, CensorTail 순서다. 애드온 작업창은 헤더의 홈 버튼으로 복귀한다.
홈과 현재 활성 애드온 창은 숨김 전환하므로 같은 애드온 재진입 시 renderer 상태를 보존한다.
다른 애드온을 선택하면 이전 runtime과 창을 종료한 뒤 새 애드온을 활성화한다.

핵심 문장은 다음과 같다.

> NainTailUtil은 독립 실행 가능한 포터블 애드온을 하나의 홈에서 발견·실행하는 호스트와,
> 각 도메인 기능을 소유한 내장 애드온을 함께 배포하는 애드온 플랫폼이다.

## 2. 하드 프로젝트 경계

애드온의 독립 실행과 호스트 결합 시 의존성 우선순위는
[`ADDON_DEVELOPMENT_CONTRACT.md`](ADDON_DEVELOPMENT_CONTRACT.md)를 정식 개발 계약으로 따른다.
요약하면 애드온은 폴더 하나로 Standalone 실행을 보장하고, NainTail에 장착되면 같은 코드를
호스트가 주입한 runtime, service와 dependency로 조립한다. Hosted에서는 호스트 dependency가
애드온 로컬 사본보다 우선하며 암묵적인 시스템 fallback은 금지한다.

개발 워크스페이스와 실제 제품 폴더를 분리한다.

```text
NainTailUtil/                 # 개발 워크스페이스와 Git 루트
├─ Docs/                     # 공통 계약과 애드온별 개발 문서
│  ├─ README.md              # 문서 소유권·라우팅 인덱스
│  ├─ NainTail/              # 호스트 홈·registry·lifecycle 문서
│  ├─ NaiTail/               # NovelAI 기능 문서
│  ├─ AnimaTail/             # 로컬 Anima 생성·런타임 문서
│  ├─ GalleryTail/           # 결과 탐색·handoff 문서
│  └─ CensorTail/            # 자동검열 문서
├─ Tests/                    # 로컬 개발 전용 테스트와 fixture, 배포 Git 제외
├─ Tools/                    # 로컬 개발 전용 Gate·검증·패키징 도구, 배포 Git 제외
├─ Artifacts/                # 다시 만들 수 있는 검증 결과, 배포 Git 제외
└─ NainTailUtil/             # 이 폴더만 복사해 사용하는 실제 제품
```

제품 폴더에는 실제 실행과 사용자 데이터에 필요한 항목만 둔다.

```text
NainTailUtil/
├─ app/                      # 애드온 registry와 범용 Electron/CLI/MCP host
├─ Addons/
│  ├─ NaiTail/               # NAI 기능 전체를 소유한 기본 내장 애드온
│  │  ├─ addon.json
│  │  ├─ app/                # Core, Worker, GUI, Electron, CLI, MCP adapter
│  │  └─ Presets/, Projects/, References/, outputs/, cache/, config/, logs/
│  ├─ AnimaTail/             # 로컬 Anima 생성을 소유한 두 번째 내장 애드온
│  │  ├─ addon.json
│  │  ├─ app/                # Python 생성 Worker
│  │  ├─ electron/, cli/, mcp/, dist/
│  │  └─ runtime/, Models/, Presets/, outputs/
│  ├─ GalleryTail/           # 워크스페이스·포터블 결과 탐색 GUI
│  │  └─ addon.json, electron/, dist/
│  └─ CensorTail/            # 자동검열 GUI·Worker·출력
│     └─ addon.json, app/, electron/, dist/, runtime/, Models/, outputs/, standalone/
├─ outputs/                  # Hosted 최종 출력, addonId별 namespace
├─ runtime/                  # 공용 Electron runtime
├─ licenses/                 # 포함 구성 요소 라이선스
├─ NainTailUtil.bat
├─ NainTailUtil_CLI.bat
└─ NainTailUtil_MCP.bat
```

다음 규칙은 예외 없이 지킨다.

- 제품 런타임은 바깥 워크스페이스, Git, `Docs/`, `Tests/`, `Tools/`에 의존하지 않는다.
- 테스트 코드, fixture, 검증 산출물, 개발용 임시 파일은 제품 폴더에 넣지 않는다.
- 시스템 Node, Python, CUDA Toolkit과 사용자 `PATH`를 실행 전제로 삼지 않는다.
- 개발 PC의 절대경로를 제품 설정이나 실행 계약에 기록하지 않는다.
- 제품 내부 경로는 이동 가능한 제품 루트를 기준으로 계산한다.
- 호스트 루트의 `runtime/`과 `licenses/`는 공용 실행 종속성이다. 프리셋, 작품, 참조 이미지,
  캐시, 설정과 로그는 각 소유 애드온 폴더 안에 둔다.
- 최종 출력은 Standalone에서 각 애드온의 `outputs/`, Hosted에서 호스트의
  `outputs/<addonId>/`에 둔다. 기존 출력은 자동 이동·삭제하거나 두 경로에 이중 기록하지 않는다.
- 최종 포터블 판정은 제품 폴더 하나만 별도 경로에 복사한 뒤 수행한다.
- NaiTail, AnimaTail과 CensorTail은 전체 제품 복사 외에도 각 애드온 폴더 단독 복사를 정식
  포터블 경계로 지원한다. 각 폴더는 자체 Electron, standalone GUI host와 데이터 루트를 가진다.
  NaiTail과 AnimaTail은 CLI·MCP launcher를, CensorTail은 GUI·MCP launcher를 제공한다.
- 같은 애드온을 NainTail host에서 실행할 때는 manifest entry와 호스트 dependency를 사용하고,
  standalone에서는 애드온의 launcher와 로컬 dependency를 사용한다. 두 경우 모두 애드온
  application/data root는 해당 애드온 폴더이며, output root만 실행 형태에 따라 분리한다.
- 세부 출력 위치, root 주입과 전환 검증은 `ADDON_OUTPUT_CONTRACT.md`를 따른다.

## 3. 계층 구조

```text
GUI / CLI / MCP
       │
       ▼
NainTail Host + Addon Registry
       │
       ▼
       ├─ NaiTail Addon
       │  ├─ Application Core
       │  └─ NAI Worker
       ├─ AnimaTail Addon
       │  ├─ Electron/CLI/MCP adapters
       │  └─ Python/CUDA generation Worker + standalone runtime package
       ├─ GalleryTail Addon ── workspace + portable result browser
       └─ CensorTail Addon ── censor Worker/model + standalone runtime package
```

호스트는 NAI, Anlas, Vibe, Precise Reference나 Anima 모델·검열의 의미를 알지 않는다.
작품·프리셋·큐를 포함한 기능 전체는 섣불리 범용화하지 않고 각 애드온 안에 유지한다.
여러 애드온에서 실제로 반복되고 계약이 검증된 기능만 호스트 서비스로 승격한다.

### 3.1 Application Core

Core는 UI와 특정 프로세스 실행 방식에 독립적인 정식 동작을 소유한다.

- 생성 요청 schema와 검증
- 작품, 캐릭터 카드, 슬롯 목록 관리
- 프롬프트와 생성 설정 해석
- 로컬 작업 큐와 상태 전이
- 큐 클리어와 생성 중단 정책
- 프리셋 읽기·쓰기·적용
- 출력 이름, 경로와 결과 연결
- 이미지 metadata 저장·복원 계약
- Worker 요청/응답/이벤트 계약
- CredentialStore, ProjectStore, PresetStore, OutputStore, WorkerPort 경계

Core는 Electron, React, MCP SDK와 특정 HTTP/Python 라이브러리를 직접 알지 않는다.

### 3.2 NAI Worker

NAI Worker는 해석이 끝난 단일 이미지 요청 하나를 받아 실행한다.

- NAI 인증과 API 통신
- NAI 요청 payload 작성
- 모델별 요청값과 해상도 정규화
- Vibe 인코딩과 캐시
- Character/Precise Reference payload mapping
- Img2Img/Inpaint 이미지와 마스크 처리
- 응답 이미지와 NAI metadata 보존
- 네트워크 오류, 타임아웃과 재시도 가능한 오류 분류

작품 구조, 프리셋 라이브러리, GUI 상태와 MCP 공개 응답은 Worker가 관리하지 않는다.

### 3.3 Anima 계열 애드온 계층

AnimaTail은 기존 AnimaUtil의 로컬 생성 기능과 앱 전용 Python 3.12/CUDA runtime,
모델·LoRA·지원 자산을 두 번째 내장 애드온으로 가져온다. GalleryTail과 CensorTail은 이 작업면의
부가 기능을 별도 manifest·renderer·IPC 생명주기로 분리한다.

- 로컬 Anima 싱글·멀티·Refine 생성
- 모델·LoRA·지원 자산 준비와 진단
- 생성 취소, 실패와 Worker 복구
- 전용 프리셋·출력 관리
- GUI·CLI·MCP에서 같은 AnimaTail 경계 사용
- GalleryTail: 전체/워크스페이스/애드온별 포터블 출력 탐색·휴지통과 폴더 열기
- CensorTail: 자체 검열 Worker·출력, 이미지 검출·박스·마스크·검열 효과와 취소

각 애드온은 자기 renderer와 Worker 생명주기를 소유한다. GalleryTail은 특정 생성 애드온에
종속되지 않고 주입된 공용 출력과 명시적으로 공개된 포터블 출력 루트를 탐색한다. CensorTail은 자체 Worker와 모델로 독립
기동하며 `artifactProviders: ["animatail"]`는 선택적인 결과 입력 권한만 선언한다. Python/CUDA는
Standalone에서 각 애드온 사본을 사용한다. Hosted에서는 각 애드온이 요구 ID 목록을 소유하고,
NainTail runtime 캐시에 같은 ID·무결성이 있으면 그 항목만 재사용한다. 호스트는 창 전환,
manifest entry 로딩, runtime 캐시 root 주입과 명시적 handoff만 제공하고 갤러리나 검열 의미를 알지 않는다.

현재 Hosted 캐시는 Python·PyTorch·CUDA 호환 조합별 기반 환경을 물리적 최소 단위로 사용한다.
향후 CUDA 13.0 등 비호환 조합이 늘어나 기반 환경 중복이 실제 용량·업데이트 문제가 되면,
개별 component 폴더와 실행 시점 resolver 구조를 별도 단계로 설계한다. 현 MVP에는 포함하지 않는다.

### 3.4 Interface adapters

- GUI: NaiTail은 빌드 단계 없는 renderer, Anima 계열 세 애드온은 분리된 React 빌드 결과와
  Electron IPC adapter를 사용한다. 제품에는 실행에 필요한 release 결과만 넣는다.
- CLI: 명령행 입력을 Core 요청으로 변환하고 JSON/JSONL 결과 출력
- MCP: 비동기 작업 등록, 대기, 상태, 취소와 최소 discovery 제공

세 인터페이스는 생성 로직을 복제하지 않고 같은 Core 계약을 사용한다. Electron main이나
renderer가 정식 큐와 생성 규칙의 소유자가 되어서는 안 된다.

## 4. 작품과 멀티 생성 모델

### 4.1 작품

작품은 멀티 제작 데이터의 최상위 단위다.

```text
작품
├─ 작품 공통 설정
├─ 일반 멀티 슬롯 리스트
└─ 캐릭터 카드 목록
   └─ 각 카드가 자기 슬롯 리스트 소유
```

캐릭터 카드가 없는 작품도 유효하다. 이 경우 작품의 일반 멀티 슬롯 리스트만 사용해
기존 형태의 멀티 생성을 수행한다.

초기 저장 모델은 다음 정도로 시작한다. 실제 필드와 schema version은 구현 전에 별도
계약 문서에서 확정한다.

```js
Project {
  id,
  name,
  commonSettings,
  generalSlots: [],
  characters: []
}

CharacterCard {
  id,
  name,
  prompt,
  negativePrompt,
  enabled,
  position, // null 또는 a1~e5
  characterSettings,
  slots: []
}

Slot {
  id,
  name,
  prompt,
  negativePrompt,
  enabled
}
```

V4 멀티 캐릭터 프롬프트는 Base Caption과 Character Caption을 분리한다.

```text
일반 슬롯 Base = 작품 공통값 + 일반 슬롯 값
일반 슬롯 Characters = 활성 캐릭터 카드의 Prompt·UC
캐릭터 슬롯 Base = 작품 공통값
캐릭터 슬롯 Characters = 활성 캐릭터 카드 전체
소유 카드 Character Caption = 카드 Prompt·UC + 해당 카드 슬롯 Prompt·UC
```

카드의 슬롯은 다른 캐릭터 Caption이나 Base Caption에 섞지 않는다.

### 4.2 서브슬롯 프리셋과 카드 슬롯의 구분

서브슬롯 프리셋과 캐릭터 카드 슬롯 리스트는 서로 다른 데이터다.

- 서브슬롯 프리셋: 사용자가 프리셋 관리에서 등록·수정·삭제하는 재사용 템플릿
- 카드 슬롯 리스트: 특정 캐릭터 카드가 직접 소유하는 실제 작업 목록
- 일반 슬롯 리스트: 작품이 직접 소유하며 카드 없이 사용하는 실제 작업 목록

프리셋을 슬롯 리스트에 Append할 때는 항목 내용을 복사하고 새로운 슬롯 ID를 발급한다.
Append가 끝난 슬롯은 원본 프리셋과 독립적으로 수정·교체·추가·삭제·순서 변경할 수 있다.
MVP에서는 `sourcePresetId`, `sourcePresetItemId` 같은 출처 추적 필드를 두지 않는다.

슬롯 리스트가 제공할 최소 편집 기능은 다음과 같다.

- 서브슬롯 프리셋 전체 Append
- 개별 슬롯 추가
- 개별 슬롯 내용 교체·수정
- 개별 슬롯 삭제
- 순서 변경
- 생성 대상 선택·해제

### 4.3 작례 프리셋

프리셋 전역 메뉴는 여러 재사용 타입을 담으며, 서브슬롯과 작례를 서로 다른 schema와
디렉터리로 저장한다.

- 서브슬롯 프리셋: `naintail.sub-slot-preset/v1`, `Presets/sub-slots/`
- 작례 프리셋: `naintail.example-preset/v1`, `Presets/examples/`
- 작례 프리셋은 재사용할 Prompt와 Undesired Content 한 쌍을 가진다.
- 싱글 생성에서 작례를 불러오면 독립된 로컬 입력으로 복사되며 원본과 연결되지 않는다.
- 최종 싱글 요청은 `작례 Prompt → 현재 Prompt`, `작례 UC → 현재 UC` 순서로 합성한다.
- 작례 프리셋은 슬롯 리스트에 Append할 수 없다.

### 4.4 NAI V4 멀티 캐릭터

- 한 요청에 Prompt가 있는 활성 캐릭터를 최대 6명까지 보낸다.
- 카드 배열 순서는 NAI의 `use_order: true` 순서 힌트로 유지한다.
- 위치 `null`은 AI 선택, `a1~e5`는 5×5 그리드 위치다.
- A1~E5 셀 중심은 X/Y 각각 `0.1, 0.3, 0.5, 0.7, 0.9`로 직렬화한다.
- 하나라도 위치를 지정하면 `use_coords: true`이며, 미지정 카드는 중앙값을 사용한다.
- 캐릭터 Prompt와 UC는 `characterPrompts`, `v4_prompt.char_captions`,
  `v4_negative_prompt.char_captions`에 같은 순서로 기록한다.
- `source#`, `target#`, `mutual#` Action Tag는 Character Prompt의 원문 기능으로 보존한다.

### 4.5 당장 만들지 않는 조합 기능

다음 기능은 실제 MVP 사용 경험을 얻은 뒤 확장한다.

- 캐릭터 카드의 데카르트 자동 조합
- 의상·표정·행동·상황을 독립 축으로 만든 데카르트 조합
- 조건부 override와 제외 조합 규칙
- 구성 요소 출처와 버전 계보 추적
- 결과 승인·채택 워크플로

## 5. 싱글 생성

싱글 생성은 기존 이미지 생성 유틸과 크게 다르게 만들지 않는다.

MVP 최소 범위는 다음과 같다.

- 기본 접힘인 작례 Prompt·UC와 기본 펼침인 현재 Prompt·UC 입력
- 저장된 작례 프리셋 불러오기
- 최대 6명의 V4 Character Prompt·UC·순서·AI 선택/5×5 위치
- 모델, 해상도, Steps, Guidance와 V4.5의 8개 Sampler, Scheduler, Guidance Rescale,
  Decrisper, Seed, UC·Quality Tags 설정
- 구독 등급·해상도·Steps·로컬 총 장수와 참조 기능을 합산한 예상 ImageAnlas 비용 표시
- 로컬 배치 `1–8`과 큐 반복 `1–20` 설정. 총 작업은 `배치 × 큐`이며 한 번에 최대 100장
- 진행·성공·실패 상태
- 결과 저장과 metadata 복원
- 결과 설정 다시 불러오기

Vibe와 Precise Reference는 MVP에 포함한다. Img2Img와 Inpaint는 같은 요청 계약 위에서 후속 확장한다.

### 5.1 독립 멀티 모드

작품 모델 확장과 별개로 빠른 변형 생성을 위한 세션형 멀티 탭을 둔다.

- 공통 작례 Prompt·UC, 현재 공통 Prompt·UC, V4 캐릭터와 생성 설정을 활성 슬롯 전체에 적용한다.
- 슬롯은 이름, 사용 여부, Prompt·UC, 순서와 선택적인 설정 override를 가진다.
- 활성 슬롯은 원래 순번을 보존하고 같은 Run에 속한 한 장 단위 작업으로 materialize한다.
- 로컬 총 작업은 `활성 슬롯 수 × 배치 × 큐`다. 큐 반복 → 슬롯 순서 → 배치 순서로 펼치며
  NAI API Batch는 쓰지 않는다.
- 서브슬롯 프리셋은 fresh slot ID로 Append하며 최대 20개 슬롯을 지원한다.
- 출력은 `outputs/multi/`에 저장하지만 GUI 결과 목록은 디스크에서 재구성하지 않는다.
- 슬롯별 이미지는 프로그램 종료 또는 명시적인 세션 `클리어` 전까지 Run을 넘어 계속 누적한다.
- 세션 `클리어`는 PNG 파일과 전역 큐를 건드리지 않고 renderer의 누적 결과만 비운다.

### 5.2 V4+ Vibe Transfer

Single과 독립 멀티 공통값에 NAI V4+ Vibe Transfer를 지원한다.

- 원본 종횡비와 해상도를 유지한 PNG를 SHA-256 이름으로 `References/vibes/`에 저장한다.
- 카드별 Strength `0.00–1.00`, Information Extracted `0.01–1.00`을 조절한다. V4.5 Full의
  기본 Information Extracted는 `0.70`, 그 밖의 V4 계열은 `1.00`이다.
- Worker는 생성 직전에 `/ai/encode-vibe`를 호출하고 원본 해시·모델·Information Extracted 조합별
  결과를 `cache/vibes/`에 보관한다. Strength만 바꾸면 다시 인코딩하지 않는다.
- 여러 Strength 합이 1을 넘을 때 정규화하는 옵션을 기본으로 켠다.
- 한 요청에 최대 16개를 허용한다. 첫 인코딩과 Information Extracted 변경 비용, 4개 초과 생성
  비용을 UI 비용 상태에 구분해 표시한다.
- Vibe Transfer와 Precise Reference는 NAI 계약상 동시에 materialize하지 않는다.

### 5.3 V4.5 Precise Reference

Single과 독립 멀티 공통값에 NAI V4.5 Image Precise Reference를 지원한다.

- PNG·JPEG·WebP 원본을 Electron의 제한된 파일 선택 IPC로 읽고 renderer에 임의 파일 경로를 노출하지 않는다.
- NAI 권장 캔버스 `1024×1536`, `1536×1024`, `1472×1472` 중 원본 종횡비와 가장 가까운 것을
  선택해 검은 레터박스 PNG로 처리한다.
- 처리된 실제 전송 자산은 SHA-256 이름으로 `References/precise/`에 보관한다. 큐와 PNG metadata에는
  base64나 개발 PC 절대경로 대신 제품 상대경로만 기록한다.
- 참조별 종류는 `character&style`, `character`, `style`, 조절값은 Strength·Fidelity `-1.00–1.00`이다.
- Worker 직전에만 상대경로 자산을 base64로 hydrate하고 NAI `director_reference_*` 필드로 직렬화한다.
- 참조당 각 생성 이미지에 5 Image Anlas 추가 비용이 있음을 생성부와 비용 판정에 표시한다.
- NainTailUtil은 한 요청에 최대 16개로 제한한다. Precise Reference는 V4.5 전용이며 Vibe
  Transfer와 동시에 materialize하지 않는다.

### 5.4 작례 연구기

싱글 이미지 생성 위에 작가 가중치 조합을 빠르게 비교하는 전용 탭을 둔다.

- 연구 설정은 `naintail.artist-study/v1` schema로 `config/artist-study.json`에 저장한다.
- 등록 작가는 ID, 이름, 사용 여부, `0.00–2.00` 범위의 가중치를 가진다.
- 가중치는 텍스트 입력 대신 `0.05` 단위 슬라이더로 조절한다.
- 활성 작가는 `가중치::artist:작가명::` 형식으로 기본 Prompt 앞에 직렬화한다.
- 사용 체크가 꺼진 작가와 이름이 빈 행은 최종 Prompt에서 제외한다.
- 랜덤 범위의 기본값은 `0.40–1.60`이며 활성 작가만 `0.05` 단위로 다시 뽑는다.
- `현재 조합 생성`과 `랜덤 생성`은 모두 기존 Core 큐에 정확히 한 장을 등록한다.
- 두 생성 action은 현재 구독·설정 기준 예상 Anlas를 표시하며 1 Anlas 이상이면 명시적 확인 뒤
  랜덤화·저장·큐 등록을 수행한다.
- 연구 결과의 `값 적용`은 이미지에 기록된 작가 조합을 등록 목록에 복원한다. 사용된 작가는
  활성화하고 가중치를 되돌리며, 미사용 작가는 비활성화하고 목록에 없는 사용 작가는 추가한다.
- 연구 설정과 결과는 작품·작례 프리셋과 별개다. 출처 프리셋 연결 필드는 두지 않는다.

## 6. NAI 큐와 중단 규칙

### 6.1 기본 실행 정책

NAI 작업 큐는 NovelAI 서버가 아니라 NainTailUtil Core가 관리한다.

- NAI lane 동시 실행 수는 1이다.
- 이미지 생성 요청은 항상 한 장 단위로 펼친다.
- Single과 독립 멀티의 `배치`는 한 변형을 몇 장 만들지, `큐`는 전체 변형 세트를 몇 번
  반복할지를 뜻한다. 둘 다 NainTailUtil이 materialize하는 로컬 카운트이며 모든 실제 payload의
  `nSamples`는 1이다.
- 한 번의 생성 action은 최대 100개 로컬 작업까지만 큐에 등록한다.
- 한 장의 결과를 수신·저장한 뒤에만 다음 요청을 전송한다.
- 작품이나 카드에 슬롯이 여러 개 있어도 NAI에는 순차적으로 한 장씩 요청한다.
- Opus 무료 생성 조건과 수치 비용식은 2026-08-11 NAI 웹 클라이언트 계약을 버전 고정해 예측한다.
  실제 계정 차감액 검증은 유료 요청 승인 뒤 별도 acceptance로 남긴다.

기본 상태는 다음과 같다.

```text
pending    아직 NAI에 전송하지 않음
in_flight 이미 전송했고 결과를 기다리는 중
completed 결과 저장 완료
failed    요청 실패
cancelled 전송 전에 취소됨
```

### 6.2 큐 클리어

- 현재 `in_flight` 한 장은 중단하지 않고 결과를 끝까지 수신한다.
- 수신된 결과는 정상 저장한다.
- 아직 전송하지 않은 모든 `pending` 항목을 `cancelled`로 전환한다.
- 현재 결과 저장 후 다음 요청을 전송하지 않고 idle로 돌아간다.

### 6.3 생성 중단

MVP의 생성 중단은 transport를 강제로 끊는 즉시 중단이 아니다.

- 사용자가 중단을 요청하면 Core에 `stopRequested`를 기록한다.
- 이미 NAI에 전송된 한 장은 결과를 수신하고 저장한다.
- 결과 저장 직후, 다음 항목을 꺼내기 전에 중단 상태를 다시 확인한다.
- 남은 대상 항목은 NAI에 전송하지 않고 `cancelled`로 처리한다.
- UI에는 동작을 오해하지 않도록 `현재 이미지 후 중단` 의미를 표시한다.

다음 요청 전송 여부 확인과 큐 상태 변경은 하나의 원자적 scheduler 경계에서 처리해,
중단 요청 직후 다음 장이 실수로 전송되는 경쟁 조건을 막는다.

향후 HTTP stream abort를 도입하더라도 서버 추론 중단이나 ImageAnlas 환불을 보장하는
기능으로 표현하지 않는다.

## 7. MVP 범위

### 7.1 MVP에 포함

- Core/Worker/Interface 경계와 versioned 요청·이벤트 계약
- 작품 생성·저장·불러오기
- 작품 공통 설정
- 캐릭터 없는 일반 멀티 슬롯 리스트
- 캐릭터 카드 생성·편집·삭제·순서 관리
- 캐릭터 카드별 슬롯 리스트
- 서브슬롯 프리셋 관리와 슬롯 리스트 Append
- 싱글 NAI 생성
- 일반 및 캐릭터 멀티의 한 장 단위 순차 생성
- 큐, 진행 상태, 큐 클리어, 현재 이미지 후 중단
- 출력 저장과 작품/카드/슬롯 연결
- 생성 설정 metadata 저장·복원
- Single·독립 멀티 Vibe Transfer와 재사용 가능한 V4 인코딩 캐시
- V4.5 Precise Reference와 Vibe의 상호배타 검증
- GUI에서 전체 수직 흐름 실행
- 동일 Core를 사용하는 최소 CLI 실행 증명
- 제품 폴더 단독 복사 smoke 검증
- 두 번째 내장 AnimaTail과 전용 Python/CUDA runtime·모델·프리셋·출력
- AnimaTail 로컬 생성·Refine GUI와 CLI/MCP entry
- GalleryTail 워크스페이스·포터블 생성 결과 탐색 GUI
- CensorTail 자동검열 GUI·Worker·검열 모델과 독립 Standalone Python/CUDA runtime
- 홈 → 각 애드온 → 홈 → 같은 애드온 재진입 시 창과 renderer 상태 보존

### 7.2 MVP 이후

- NainTail MCP 단일 stdio·축약 discovery/get/call과 NaiTail Adapter 수직 구현: 완료
- AnimaTail을 두 번째 federation Adapter로 전환하고 다중 애드온 lifecycle 검증
- 애드온 결과를 다른 애드온 입력으로 넘기는 `naintail.artifact-ref/v1` 계약
- 여러 애드온을 한 워크플로로 잇는 결과 전달/후처리 조합 계약
- 장시간 영속 job history
- 복잡한 조합 규칙과 자동 조합
- 캐시 용량 표시·개별 제거 등 고급 Vibe 캐시 관리
- Img2Img/Inpaint 편집 UX
- 결과 채택·분류 워크플로
- 업데이트와 배포 패키징 안정화

MCP와 자동검열은 AnimaTail 통합까지 포함해 제품에 들어왔다. 다음 확장은 호스트가 양쪽 도메인을
직접 아는 방식이 아니라, 실제 사용에서 검증된 애드온 간 결과 전달 계약으로 진행한다.

## 8. 구현 단계와 Gate

### Phase 0 — 계약과 저장 구조

- 제품 폴더 skeleton 생성
- 작품, 캐릭터 카드, 슬롯, 프리셋 schema v1 확정
- Core↔Worker 요청·응답·이벤트 계약 확정
- 출력 metadata 최소 계약 확정
- CredentialStore 정책 결정

Gate:

- 제품 경계 밖을 참조하는 런타임 경로가 없다.
- schema fixture 왕복과 잘못된 입력 거부가 통과한다.
- 아직 runtime/model 다운로드나 유료 NAI 요청을 수행하지 않는다.

### Phase 1 — Headless Core

- ProjectStore와 PresetStore
- 작품/카드/슬롯 편집 use case
- 프리셋 Append와 독립 복사
- 요청 해석과 한 장 단위 작업 materialization
- 큐 상태 전이와 중단 scheduler

Gate:

- 일반 멀티와 캐릭터 멀티가 예상한 단일 이미지 작업 목록으로 펼쳐진다.
- 큐 클리어와 현재 이미지 후 중단에서 다음 요청이 전달되지 않는다.
- 테스트 코드는 제품 폴더 밖에 존재한다.

### Phase 2 — NAI Worker와 싱글 생성

- 토큰 검증과 구독 상태
- 기본 txt2img 요청
- 비용 사전 계산
- 응답 이미지 저장과 metadata 보존
- 오류 분류와 timeout. 생성 POST는 중복 과금 위험 때문에 자동 재시도하지 않는다.

Gate:

- 테스트용 mock transport 계약이 통과한다.
- 사용자 승인 후 실제 NAI 한 장 생성으로 click/CLI-to-output을 검증한다.
- 실제 요청 전 예상 비용과 요청 요약을 확인할 수 있다.
- 예상 비용이 1 Anlas 이상이면 사용자가 비용 내역을 확인하고 명시적으로 승인하기 전에는 큐에 넣지 않는다.

### Phase 3 — 작품 기반 멀티

- 일반 슬롯 리스트 생성
- 캐릭터 카드별 슬롯 리스트 생성
- 프리셋 Append와 개별 편집
- 한 장 단위 순차 실행
- 결과를 작품/카드/슬롯에 연결
- 실패·취소 뒤 선택 재시도 기반 마련

Gate:

- 여러 슬롯을 등록해도 NAI 동시 요청이 1을 넘지 않는다.
- 중단 시 이미 전송된 한 장까지만 저장하고 다음 항목을 전송하지 않는다.
- 앱 재시작 뒤 작품, 슬롯과 결과 관계가 복원된다.

### Phase 4 — GUI MVP

- 싱글 생성 화면
- 작품 선택·생성·저장 화면
- 일반 슬롯 리스트
- 캐릭터 카드와 카드별 슬롯 리스트
- 큐/결과 패널
- 최소 설정과 런타임 상태

Gate:

- GUI는 제한된 IPC만 사용한다.
- renderer가 파일시스템, 자격증명 저장소와 Worker를 직접 호출하지 않는다.
- 새 작품부터 결과 복원까지 MVP 사용자 시나리오가 통과한다.

### Phase 5 — Headless adapter 증명

- 최소 CLI status/project/generate 명령
- GUI와 동일한 schema와 Core 사용
- JSON/JSONL 진행 이벤트

Gate:

- GUI 없이 작품 파일을 읽고 같은 요청을 생성할 수 있다.
- GUI와 CLI가 같은 입력을 서로 다르게 해석하지 않는다.

### Phase 6 — MCP, 자동검열과 포터블 완성

- MCP 비동기 job adapter: 구현 완료. 축약 list/개별 get, jobs list/status/wait/cancel,
  queue clear/resume와 유료 Anlas 승인 상한 포함
- Python/CUDA runtime manifest와 installer: AnimaTail 경계로 포함 완료
- 생성 Worker: AnimaTail 경계로 포함 완료
- Censor Worker와 자동검열 UI: CensorTail 경계로 분리 완료
- 범용 GUI·CLI host와 MCP 호환 selector, NainTail federation host: 완료
- 최종 launcher와 standalone smoke: 완료

Gate:

- GUI·CLI·MCP가 동일 Core 계약을 사용한다. MCP 실제 stdio initialize/tools/list/tool-call
  round-trip까지 검증한다.
- 제품 폴더만 새 위치로 복사한 환경에서 모든 경로가 해결된다.
- 시스템 Python/CUDA와 부모 워크스페이스 없이 상태 확인과 필요한 작업을 실행한다.

## 9. MVP 완료 시나리오

MVP는 다음 수직 흐름을 실제로 완료해야 한다.

1. 새 작품을 만든다.
2. 작품 공통 프롬프트와 생성 설정을 입력한다.
3. 일반 슬롯을 직접 추가하거나 서브슬롯 프리셋에서 Append한다.
4. 캐릭터 카드를 만들고 카드 공통값을 입력한다.
5. 카드 슬롯을 직접 추가하거나 프리셋에서 Append한 뒤 일부를 개별 수정·삭제한다.
6. 일반 슬롯과 캐릭터 슬롯을 큐에 등록한다.
7. NAI에 한 장씩 순차 요청하고 결과를 저장한다.
8. 실행 도중 `현재 이미지 후 중단` 또는 큐 클리어를 실행해 다음 요청이 전송되지 않음을 확인한다.
9. 앱을 재시작하고 작품, 카드, 슬롯과 결과 관계를 복원한다.
10. 같은 작품 파일을 최소 CLI adapter에서도 읽고 실행할 수 있음을 확인한다.
11. 제품 폴더만 다른 경로에 복사해 같은 흐름을 다시 smoke 검증한다.

## 10. 검증 원칙

검증 결과는 다음 단계를 서로 대신하지 않는다.

- 소스 및 schema 검사
- 자동 테스트
- mock transport 통합 테스트
- 실제 NAI 단일 요청
- GUI click-to-output
- CLI headless 실행
- 실제 중단 타이밍 검증
- 제품 폴더 단독 복사 검증
- 자동검열 단계의 실제 GPU/ONNX 검증

실제 NAI 요청, 유료 ImageAnlas 가능성이 있는 요청, Python/CUDA runtime과 모델 다운로드는
계획과 예상 비용·용량을 먼저 확인하고 명시적인 승인 뒤 실행한다.

## 11. MVP에서 확정한 구현 결정

초기 사용 경험 없이 과도하게 일반화하지 않는다는 원칙 아래 MVP에서는 다음처럼 고정한다.

- 병합 순서는 작품 공통값 → 캐릭터 카드 값 → 슬롯 값이다. 일반 슬롯은 작품 → 슬롯이다.
- 캐릭터 카드는 NAI Director Reference가 아니라 작품 관리 단위이며 MVP 요청은 일반
  V4.5 txt2img 한 장으로 materialize한다.
- 슬롯은 prompt, UC, enabled와 생성 설정 override 객체를 가진다. GUI의 고급 override
  편집 UX는 실제 사용 뒤 확장한다.
- NAI 요청 실패 시 같은 Run의 미전송 항목을 취소하고 큐를 일시정지한다. 생성 POST는
  자동 재시도하지 않는다.
- 결과는 제품 루트 상대경로로 작품에 연결하고, 작품/카드/슬롯 식별자를 PNG iTXt에
  기록한다. 절대경로와 file URL은 작품 JSON에 저장하지 않는다.
- GUI 토큰은 Electron `safeStorage`, CLI 토큰은 `NAINTAIL_NAI_TOKEN`만 사용한다. 제품
  폴더를 다른 PC로 옮기면 GUI 토큰은 다시 입력한다.
- MVP 고급 기능은 V4.5 Full/Curated, 8개 Sampler와 4개 Scheduler, Guidance Rescale,
  Decrisper, 품질/UC 프리셋, Vibe Transfer와 Precise Reference까지 포함한다. V4/V4.5 웹
  요청에서 제거되는 구형 `sm`/`sm_dyn` SMEA 토글은 노출하지 않는다. Img2Img와 Inpaint는
  후속 단계다.
- Quality Tags 접미사는 2026-08-11 공개 웹 클라이언트 build `c410ef7-production`의 Full/Curated
  실제 문자열에 고정하고 `text:` 절보다 앞에 삽입한다. 설명 문서와 실제 wire 문자열이 다르면
  V4.5 웹 요청 계약과 payload 회귀 테스트를 우선한다.
- AnimaTail Python/CUDA runtime과 자동검열 모델은 기존 검증된 로컬 설치본을 포터블 경계로
  가져왔다. 향후 runtime/model 교체나 대규모 다운로드는 별도 용량·성능 계획과 승인을 거친다.

## 12. 참고 구현의 역할

- PeroPix: 슬롯 중심 대량 생성, NAI payload, Vibe/Reference/Inpaint, 비용과 metadata 동작을
  조사하는 현재 참고 구현
- AnimaUtil: Core/Worker/UI 분리, 포터블 runtime, 큐, 출력 metadata, CLI/MCP adapter를
  `AnimaTail` 두 번째 내장 애드온의 실구현으로 가져온 원본

참고 구현의 코드를 그대로 구조의 권위로 삼지 않는다. 현재 NAI 공식 계약과 실제 파일
배선을 다시 확인하고, NainTailUtil의 제품 경계에 맞는 최소 계약으로 재구성한다.
