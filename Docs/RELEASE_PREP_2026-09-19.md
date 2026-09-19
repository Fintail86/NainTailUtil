# 2026-09-19 개별 릴리즈 준비

| 컴포넌트 | 이전 | 후보 | 태그 |
|---|---|---|---|
| NainTail 호스트 | 0.1.4 | 0.1.5 | `host-v0.1.5` |
| NaiTail | 0.1.0 | 0.1.1 | `naitail-v0.1.1` |
| CensorTail | 0.1.1 | 0.1.2 | `censortail-v0.1.2` |

AnimaTail 0.1.1과 GalleryTail 0.1.0은 제품 코드 변경이 없어 유지한다.

## 변경 내용

- NaiTail: Searching/Pounding/Finalize/Mixing/Favorites 작례 연구 흐름,
  선호 이미지 저장·평가·라운드 JSON·가중치 조정, 공통 이미지 미리보기,
  캐릭터 의상 및 이름 기반 프리셋 참조, GUI 암호화 인증정보의 Windows MCP 재사용.
- CensorTail: 형태 마스크 및 검열 대상별 설정, 설정 편집 확인·취소,
  마스크 번짐 제한, 관련 MCP 설정 지원.
- 호스트: MCP 서비스 전달 및 서버 버전 표시 동기화, 업데이트 카탈로그 v12.

## 패키징

각 컴포넌트는 `AddonRelease/<태그>/`의 별도 ZIP으로 준비한다.
ZIP SHA-256과 크기는 공식 카탈로그 및 `SHA256SUMS.txt`에 기록한다.
세 릴리즈의 `official-addons.json`, `official-host.json`은 최종 값으로 동일하게 맞춘다.
호스트 ZIP의 내장 애드온 카탈로그도 최종 카탈로그와 일치한다.

로컬 Favorites, 프리셋, 프로젝트, 참조 이미지, 생성물, 캐시, 로그, 인증정보,
Electron 프로필, 런타임 및 모델은 배포하지 않는다. 업데이트 보존 목록은 유지한다.
기존 패키징 도구에서 빠졌던 Favorites 제외와 금지 파일 검증을 보강했다.
배포 파일 전체를 Git 추적 제품 파일과 대조하고, ZIP 추출 파일 해시도 대조했다.
로컬 도구·테스트는 기존 Git 제외 정책을 유지한다.

## 검증 기록

- 대상 개발 회귀검증: 28개 suite 이번 실행 통과, 10개 기존 통과 지문 재사용.
- 최초 차단된 CensorTail Python suite 3개는 테스트 실행기가 호스트의 standalone
  manifest를 조회한 문제였다. hosted 요구 manifest를 지정한 뒤 29개 Python 테스트 통과.
  실행기 관련 suite도 재검증했다. 런타임 설치·다운로드는 하지 않았다.
- 후속 카탈로그/MCP 버전 변경: Hub MCP federation 및 addon installer suite 통과.
- 대상 릴리즈 자동검사: 11개 suite 통과. 최종 호스트 재패키징 후 host manifest 및
  portable suite 재검증 통과.
- 실제 깨끗한 패키지 복사본: 빈 호스트 MCP, NaiTail/CensorTail standalone MCP,
  두 애드온의 hosted MCP 호출, NaiTail CLI help 통과. 기존 Electron을 Node 모드로 사용했다.
- AnimaTail/GalleryTail 개별 회귀·릴리즈 suite는 대상 밖으로 스킵했다.

## 발행 전 남은 항목

GUI 재진입·이동 후 재기동, 실제 유료 API 이미지 생성 및 GPU 검열은 이번 검증에서
실행하지 않았다. 따라서 전체 수동 릴리즈 Gate 통과로 간주하지 않는다.

GitHub에는 초안으로 준비한다. 수동 확인 후 애드온 두 개를 먼저 발행하고,
호스트를 마지막으로 발행하여 Latest로 지정한다. 공개 릴리즈의 최신 매니페스트를
조회하는 업데이트 기능 특성상 세 후보를 함께 발행하는 것이 필요하다.
