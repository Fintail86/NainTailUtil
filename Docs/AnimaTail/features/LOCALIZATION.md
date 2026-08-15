# 로컬라이즈

## 기본 동작

- 기본 언어는 한국어다.
- 설정의 `표시 언어`에서 한국어와 영어를 선택한다.
- 선택값은 renderer `localStorage`의 `animautil.locale`에 저장되어 다음 실행에 복원된다.
- 앱 시작 시 실행 루트의 `locales/*.json`을 검색한다.
- 유효하고 중복되지 않은 locale `id`를 가진 파일은 별도 코드 수정 없이 언어 목록에 추가된다.
- 선택한 파일에 번역이 없는 문장은 한국어 원문으로 fallback한다.

## 파일 형식

```json
{
  "id": "ja",
  "name": "日本語",
  "messages": {
    "설정": "設定",
    "총 {count}장": "合計 {count} 枚"
  }
}
```

`messages`의 key는 UI의 한국어 원문이고 value가 번역문이다. `{count}`처럼 이름이 붙은
placeholder는 동적 수치나 이름을 보존하므로 번역문에도 같은 이름으로 넣는다. 부분 번역
파일도 허용하며 빠진 key는 한국어로 표시한다.

## 검증과 보안 경계

- locale id는 ASCII 언어 코드 형태만 허용한다.
- locale 이름과 모든 message는 문자열만 허용한다.
- prototype 오염에 사용될 수 있는 key와 과도하게 큰 파일 계약은 거부한다.
- renderer에는 검증된 문자열 데이터만 전달하고 locale 파일이 코드나 HTML을 실행하지 못하게 한다.
- 잘못된 JSON, 중복 id와 계약 위반 파일은 드롭다운에서 제외하고 설정 화면에 오류 개수를 표시한다.

JSX 공통 런타임은 본문, 버튼, placeholder, title, 접근성 label과 동적으로 결합된 문자열을
같은 번역표로 처리한다. 한국어 원문을 직접 수정하면 `en.json` 및 추가 locale의 해당 key도
함께 갱신해야 한다.

프롬프트, 프리셋 이름, 모델명, LoRA명, 파일명처럼 사용자 작성 또는 외부 입력 문자열은
번역하지 않는다. 이런 값을 렌더링하는 요소에는 `data-localize="off"`를 지정한다.
