# CensorTail 문서 안내

CensorTail이 소유하는 로컬 자동검열 문서는 이 폴더에서 관리한다.

## 범위

- 자동검열 입력·검출·박스와 마스크 편집
- 모자이크·색상·형태·그라데이션·포그 효과
- Python ONNX Worker와 CUDA provider
- 검열 모델 다운로드·무결성 검증과 라이선스 경계
- `outputs/censored/` 저장과 이미지 내장 metadata
- Hosted 공유 런타임과 Standalone 포터블 런타임
- CensorTail Electron service, preload와 renderer
- Hosted/Standalone MCP Adapter, 비동기 검출·저장 queue와 artifactRef 계약

세부 기능과 모델 계약은 [`features/AUTO_CENSOR.md`](features/AUTO_CENSOR.md)를 따른다.
MCP 도구와 작업·결과 계약은 [`features/MCP.md`](features/MCP.md)를 따른다.
Hosted·Standalone 의존성 규칙은
[`../ADDON_DEVELOPMENT_CONTRACT.md`](../ADDON_DEVELOPMENT_CONTRACT.md)를 따른다.
