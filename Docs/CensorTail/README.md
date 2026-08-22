# CensorTail 문서 안내

CensorTail이 소유하는 로컬 자동검열 문서는 이 폴더에서 관리한다.

CensorTail은 Standalone에서 자기 폴더의 Python/CUDA/ONNX runtime을 사용한다. Hosted에서는
자신이 선언한 ID 중 NainTail 런타임 캐시에 이미 있는 동일 ID·무결성 항목만 재사용하고,
ONNX Runtime 계층은 CensorTail을 처음 실행할 때 별도로 설치한다. `Models/censor/`와 검열 Worker,
Standalone ONNX Runtime 계약도 CensorTail이 소유하며
AnimaTail 설치를 요구하지 않는다. AnimaTail 결과 입력은 양쪽 애드온이
설치된 경우 호스트가 연결하는 선택적 artifact 연동이다. Standalone Electron이 없으면 Windows
PowerShell 부트스트랩이 고정된 공식 배포본을 크기·SHA-256 검증 후 설치한다.

## 범위

- 자동검열 입력·검출·박스와 마스크 편집
- 모자이크·색상·형태·그라데이션·포그 효과
- Python ONNX Worker와 CUDA provider
- 검열 모델 다운로드·무결성 검증과 라이선스 경계
- Standalone `outputs/censored/`, Hosted NainTail `outputs/censortail/censored/` 저장과 이미지 내장 metadata
- Hosted runtime 캐시의 CensorTail 요구 ID 목록과 Standalone 포터블 런타임
- CensorTail Electron service, preload와 renderer
- Hosted/Standalone MCP Adapter, 비동기 검출·저장 queue와 artifactRef 계약

세부 기능과 모델 계약은 [`features/AUTO_CENSOR.md`](features/AUTO_CENSOR.md)를 따른다.
MCP 도구와 작업·결과 계약은 [`features/MCP.md`](features/MCP.md)를 따른다.
Hosted·Standalone 의존성 규칙은
[`../ADDON_DEVELOPMENT_CONTRACT.md`](../ADDON_DEVELOPMENT_CONTRACT.md)를 따른다.
출력 위치와 artifact 경계는
[`../ADDON_OUTPUT_CONTRACT.md`](../ADDON_OUTPUT_CONTRACT.md)를 따른다.
