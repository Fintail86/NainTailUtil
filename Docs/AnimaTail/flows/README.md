# 개발 flow 기록

독립적으로 검토·구현·검증할 기능은 `NNN-short-name/` 폴더를 만들고 `PLAN.md`와
`RESULT.md`를 함께 둔다.

- `PLAN.md`: 목표, 범위, 비범위, 변경 대상, 검증 계획
- `RESULT.md`: 실제 변경, 검증 결과, 남은 위험과 후속 작업

작업 전에는 `_templates/`를 복사하고, 완료 뒤 문서 링크와 현재 기능 문서를 함께
갱신한다. 단순 문구 수정이나 한 파일짜리 명백한 버그까지 억지로 flow로 만들 필요는
없다.

## 진행 중인 flow

| Flow | 상태 | 범위 |
|---|---|---|
| [`001-generation-cli`](001-generation-cli/PLAN.md) | 1차 구현 완료 | 싱글·멀티 생성과 프롬프트 프리셋의 AI 친화적 CLI |
| [`002-generation-mcp`](002-generation-mcp/PLAN.md) | 1차 구현 완료 | 비동기 싱글·멀티 생성 및 작업 상태 조회 MCP |
