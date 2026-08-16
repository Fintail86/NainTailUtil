# Tail 공용 상단 헤더 계약

- 기준 목업: `tail_header_spec.html`, `tail_header_spec_v2.html`
- 적용 범위: NaiTail, AnimaTail, GalleryTail, CensorTail
- 제품 기준 구현: `NainTailUtil/ui/tail-header-*`

## 1. 목업 해석 범위

목업의 **R-01부터 R-08까지 규칙 카드만 제품 계약**이다. 화면에 함께 있는 데모 존,
redline, 비교용 정적 데이터와 참고 렌더는 계약이 아니며 제품 UI에 이식하지 않는다. 목업의
알림 스택 JavaScript도 상태 병합·수명·표시 상한을 설명하기 위한 동작 참고다. 제품은 각
애드온의 실제 연결·런타임·작업 이벤트를 `tail-header.js` 어댑터에 전달한다.

목업 CSS의 공용 값은 `tail-header-tokens.css`로 추출한다. `--slotA`, `--ok`, `--warn`,
`--alert`, `--nai`, `--anima`, `--gallery`, `--censor`, `--mono`, `--sans`는 네 애드온에서
동일한 이름과 값을 사용한다. `--bg`, `--panel`, `--text`처럼 기존 작업면 토큰과 충돌할 수
있는 일반 이름은 `.tail-header` 안에만 한정한다. 목업의 9.5px role 표기는 참고 렌더이므로
공용 UI 최소 글자 크기 계약에 따라 11px로 표시한다.

## 2. R-01부터 R-08

### R-01 · Identity

- 보조 문구는 호스트와 애드온 관계를 설명하는 문장이 아니라 대문자 역할 라벨 한 줄이다.
- NaiTail `NOVELAI ADD-ON`, AnimaTail `LOCAL STUDIO`, GalleryTail `OUTPUT BROWSER`,
  CensorTail `LOCAL CENSOR`를 사용한다.

### R-02 · Navigation

- 애드온 로고를 누르면 해당 애드온의 첫 번째 기본 탭으로 이동한다.
- Hosted에서 NainTail 홈으로 돌아가는 동작은 로고가 아니라 별도 좌측 chevron이 담당한다.
- 활성 탭은 accent 글자색과 하단 2px line으로 표시하고 비활성 아이콘은 단색 회색이다.

### R-03 · Badges

- 가장 오른쪽의 32px 상태 표시는 지금 작업 가능한지를 항상 답한다.
- 도메인별 동적 자원 또는 문맥은 상태 표시 바로 왼쪽에 둔다.
- 정적인 버전, Electron, Python, CUDA 문자열은 헤더에 두지 않는다.

### R-04 · Meta

- 제품 버전과 기술 런타임 버전은 설정 또는 About에서 확인한다.
- 정적 meta 문자열로 헤더 공간을 소비하지 않는다.

### R-05 · Slot A

- 애드온 identity는 `--slotA: 176px` 고정 폭이다. Hosted chevron 폭은 이 값에 포함하지 않는다.
- 긴 이름과 역할은 한 줄 말줄임으로 제한한다.
- 같은 실행 형태 안에서는 애드온을 전환해도 탭과 우측 상태의 기준 위치가 흔들리지 않는다.

### R-06 · State

- 상태 표시는 32px 고정이다: Ready는 녹색 원, Warning은 황색 삼각형, Alert는 적색 팔각형이다.
- hover와 keyboard focus에서 현재 설명을 표시하고, 클릭하면 최근 상태 기록을 연다.
- 색상뿐 아니라 모양과 접근 가능한 상태 문구로 의미를 전달한다.

### R-07 · Notification

- Warning과 Alert 카드는 상태 표시 아래에 고정한다.
- Warning은 기본 5초 후 사라지고 Alert는 해결되거나 사용자가 닫을 때까지 유지한다.
- 같은 원인의 알림은 새 카드를 늘리지 않고 횟수를 합친다.
- 화면에는 최대 3개만 보이고 나머지는 `+N`으로 요약한다.

### R-08 · Hosted

- NainTail Hosted일 때만 identity 맨 앞에 홈 복귀 chevron을 주입한다.
- Standalone은 로고부터 시작하며 chevron의 빈자리를 남기지 않는다.
- chevron은 실제 preload가 제공하는 `window.nainTailHost.goHome()`만 호출한다.

## 3. 공용 파일과 포터블 사본

원본은 다음 세 파일이다.

```text
NainTailUtil/ui/
├─ tail-header-tokens.css
├─ tail-header.css
└─ tail-header.js
```

각 애드온은 독립 실행을 위해 같은 파일의 byte-identical 사본을
`Addons/<Tail>/dist/renderer/`에 소유한다. `addon-header.css`에는 공용 파일 import와 해당
애드온 작업면에만 필요한 offset만 둔다. 공용 원본을 바꾸면 네 사본과 검증 테스트를 같은
변경에서 갱신한다.

## 4. 제품 이벤트 어댑터

공용 스크립트는 기존 DOM의 실제 상태를 우선 읽으며, 애드온이 명시적으로 상태를 보낼 때는
다음 제품 이벤트 또는 동일한 `window.tailHeader` API를 사용한다.

```js
window.dispatchEvent(new CustomEvent("tail-header:status", {
  detail: { level: "warning", message: "런타임 준비 중" }
}));

window.dispatchEvent(new CustomEvent("tail-header:notify", {
  detail: { level: "alert", message: "모델 로드 실패", persistent: true }
}));
```

`level`은 `ready`, `warning`, `alert` 중 하나다. 데모 버튼이나 목업용 타이머를 제품에
연결하지 않으며, 오류의 실제 원인과 해결 여부는 해당 애드온의 worker/event source가
소유한다. 명시 상태를 보낸 애드온은 해결 시 다음 상태도 직접 보내며, 다시 DOM 기반 자동
판정으로 돌아갈 때는 `window.tailHeader.clear()`를 호출한다.
