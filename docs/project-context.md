---
generated_by: project-context
source_commit: fd9079f
updated_at: 2026-07-20T14:35:41Z
mode: multi-page
---

# Project Context

## 목적

`openapi-k6`를 변경하기 전에 읽을 얇은 안내 문서다. 필요한 영역만 아래 index에서 골라 읽고, 실제 동작은 링크된 현재 source와 test를 기준으로 판단한다.

## 프로젝트 요약

이 저장소는 OpenAPI와 Scenario YAML을 입력받아 정적 검증, Node.js 기반 API 흐름 테스트, k6 JavaScript 생성·실행을 제공하는 TypeScript ESM CLI다. npm package와 bin 이름은 모두 `openapi-k6`이고 Node.js 20 이상을 요구한다. 사용자 기본 흐름은 `init → sync → catalog → scenario 작성 → validate → test → generate/run`이다. 대상 프로젝트의 산출물은 기본적으로 `openapi-k6/` 작업공간에 둔다. 근거: [README](../README.md), [package manifest](../package.json), [CLI 명령 정의](../src/cli/program.ts).

## 작업 전 확인 지점

- 공개 명령·옵션, config, Scenario YAML, scaffold는 npm 최신 버전을 실행하는 기존 사용자와 호환되어야 한다. 기본 동작 변경보다 additive 확장을 우선하고, legacy `load-tests/` 이전 경로도 보존한다. 세부 계약: [CLI와 작업공간](./project-context/cli-workspace.md), [저장소 지침](../AGENTS.md).
- DSL 기능은 parser만의 기능이 아니다. OpenAPI 정적 검증, AST, Node executor, k6 generator가 같은 의미를 유지해야 한다. 세부 흐름: [Scenario 파이프라인](./project-context/scenario-pipeline.md).
- UI와 suite는 별도 실행 엔진이 아니라 기존 CLI/Scenario 실행 결과를 조합하는 계층이다. report 형식이나 UI route를 바꿀 때 CLI 실패 규칙과 테스트까지 함께 확인한다. 세부 흐름: [UI·Suite·운영](./project-context/ui-suite-operations.md).
- 사용자 사용법은 root [README](../README.md), 생성 작업공간 계약은 [scaffold README template](../src/scaffold/templates/openapi-k6.README.md), 유지보수·배포 절차는 [maintainer notes](./03-maintainer-notes.md)가 canonical이다. 같은 내용을 한 문서에서 독립적으로 재정의하지 않는다.

<!-- project-context:index:start -->
## Context Index

먼저 이 문서를 읽고, 작업과 `읽을 때`가 맞는 하위 문서만 연다.

- [CLI와 작업공간](project-context/cli-workspace.md) — 공개 명령, config·module 해석, scaffold 생명주기와 하위 호환성 계약; 읽을 때: CLI 옵션, init/update/sync, 경로 해석, scaffold 또는 config를 변경할 때
- [Scenario 파이프라인](project-context/scenario-pipeline.md) — Scenario DSL의 확장·검증, OpenAPI 해석, AST, Node 실행과 k6 생성의 의미 계약; 읽을 때: Scenario 문법, template, OpenAPI 검증, executor 또는 generator를 변경할 때
- [UI·Suite·운영](project-context/ui-suite-operations.md) — 로컬 UI 실행 모델, suite·report 계약, 테스트 계층과 npm 배포 절차; 읽을 때: UI route·상태, suite 실행, report 형식, CI·smoke·release를 변경할 때
<!-- project-context:index:end -->

## 근거

- [README](../README.md)
- [package.json](../package.json)
- [AGENTS.md](../AGENTS.md)
- [CLI program](../src/cli/program.ts)
- [maintainer notes](./03-maintainer-notes.md)
