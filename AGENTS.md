# AGENTS.md

## Project-Specific Instructions

전역 `AGENTS.md` 지침에 더해, 이 저장소에서는 아래 규칙을 반드시 따른다.

### Backward Compatibility

이 프로젝트는 npm/npx로 배포되는 CLI이므로, 새 개선은 기존 사용자가 최신 버전을 실행해도 기존 흐름이 깨지지 않아야 한다.

- 기존 공개 명령어와 옵션의 의미를 바꾸지 않는다.
  - 예: `init`, `update`, `sync`, `test`, `generate`
  - 예: `-s/--scenario`, `-o/--openapi`, `-w/--write`, `--config`, `-m/--module`, `--no-input`, `--force`
- 기존 `load-tests/config.yaml`, scenario YAML, `.env`, scaffold 구조가 그대로 동작해야 한다.
- 새 기능은 기본적으로 additive하게 추가한다. 기존 명령의 기본 동작을 바꾸려면 명확한 이유와 migration 문서가 필요하다.
- 기존 사용자가 `npx --yes openapi-k6@latest <기존 명령>`을 실행했을 때 에러가 나지 않는지 반드시 확인한다.
- 개선 작업에는 최소한 다음 호환성 검증을 포함한다.
  - 기존 fixture 기반 `init -> sync -> test -> generate` 흐름
  - 기존 CLI 옵션을 쓰는 테스트
  - 기존 scaffold/README 생성 결과가 의도치 않게 바뀌지 않았는지 확인
- 호환성을 깨는 변경이 필요하면 구현 전에 사용자에게 알리고, 대안과 migration 방안을 먼저 제시한다.

<!-- project-context:start -->
## Project Context

This repository has Codex-native project context documentation at `docs/project-context.md`.

Start here:

- [Project context](docs/project-context.md)

Project context includes repository overview, architecture notes, workflows, domain concepts, operations, integrations, testing guidance, and source maps.
For ordinary project questions, read the project context first and follow its links only as relevant. Read the primary page first; do not preload every supporting page. In multi-page context, open only pages whose `read_when` guidance matches the task. When context is missing, stale, ambiguous, or exact implementation verification is required, inspect the relevant source; current source remains authoritative. Follow repository instructions for code discovery. Run `$project-context` to refresh documentation only when the user explicitly requests creation or refresh, or directly invokes the skill without a narrower read-only request; missing or stale context alone does not authorize writes.
<!-- project-context:end -->
