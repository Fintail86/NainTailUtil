# GalleryTail

AnimaTail의 출력 탐색과 metadata 확인을 분리한 NainTail 내장 애드온이다.

- 원본 이미지와 출력은 `AnimaTail/outputs/`에 그대로 둔다.
- GalleryTail은 파일 탐색, Prompt·설정 확인, 폴더 표시와 휴지통 이동만 소유한다.
- `설정 불러오기`는 host handoff로 AnimaTail을 열고 해당 metadata를 전달한다.
- `gallerytail:` protocol은 허용된 AnimaTail output 이미지만 읽는다.
