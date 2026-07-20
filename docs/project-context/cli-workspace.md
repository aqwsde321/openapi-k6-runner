---
title: CLI와 작업공간
description: 공개 명령, config·module 해석, scaffold 생명주기와 하위 호환성 계약
read_when: CLI 옵션, init/update/sync, 경로 해석, scaffold 또는 config를 변경할 때
---

[← Project Context](../project-context.md)

# CLI와 작업공간

## 공개 흐름과 진입점

`src/cli/index.ts`가 `runCli`를 호출하고, Commander 기반 `createCliProgram`이 공개 명령과 옵션을 고정한다. 명령은 다음 책임으로 나뉜다. 정확한 옵션 계약은 [program source](../../src/cli/program.ts)가 기준이다.

- 작업공간: `init`, `update`, `doctor`, `install-skill`, `ui`
- OpenAPI: `sync`, `catalog`, `module list/add/set-default/remove`
- Scenario: `validate`, `test`, `generate`, `run`

사용자 흐름은 `init → sync → catalog → validate/test → generate/run`이다. `validate`는 API를 호출하지 않고, `test`는 k6 없이 Node.js에서 실제 요청을 보낸다. `generate`는 검증 후 파일을 쓰며, `run`은 검증·생성 후 k6 프로세스까지 실행한다. 이 진입점 뒤의 데이터 처리는 [Scenario 파이프라인](./scenario-pipeline.md)이 담당한다.

## 작업공간 생명주기

기본 작업공간은 `openapi-k6/`다. `init`은 `openapi/`, `scenarios/`, `generated/` 디렉터리와 `config.yaml`, `.env.example`, `.gitignore`, `run.sh`, 기본 `smoke.yaml`, 작업공간 `README.md`, `.openapi-k6.json`을 만든다. 기존 config가 있으면 `init --force`보다 `update`를 안내한다. `--force`는 config와 기본 smoke까지 다시 쓸 수 있으므로 안전한 갱신 명령이 아니다. 근거: [scaffold initializer](../../src/scaffold/load-test.init.ts), [workspace command](../../src/cli/workspace-command.ts).

`update`는 config 위치를 작업공간 기준으로 삼아 `.env.example`, `.gitignore`, `run.sh`, `README.md`, `.openapi-k6.json`만 갱신한다. `config.yaml`, `.env`, scenarios, suites, snapshot/catalog, generated scripts, reports와 logs는 삭제하거나 다시 만들지 않는다. 기본 `openapi-k6/config.yaml`이 없고 `load-tests/config.yaml`만 있으면 legacy 디렉터리 전체를 `openapi-k6/`로 옮긴 뒤 갱신한다. 두 디렉터리가 함께 있으면 자동 이전하지 않는다. 보존 계약은 [CLI regression tests](../../test/cli.test.ts)와 [compatibility smoke](../../scripts/backward-compat-smoke.mjs)가 고정한다.

생성 `.gitignore`는 `.openapi-k6.json`, `scenarios/**`, `suites/**`만 추적 예외로 둔다. `.env`는 init/update가 생성하거나 덮어쓰지 않으며 `run.sh`는 작업공간의 `.env`만 읽는다.

## Config·module·경로 규칙

`config.yaml`의 `modules`는 비어 있지 않아야 한다. module 선택은 명시 `--module`, `defaultModule`, module 하나뿐일 때의 추론 순서다. module에는 `openapi`와 legacy alias `openapiUrl`, `snapshot`, `catalog`, `baseUrl`이 있으며 상대 파일 경로는 config 디렉터리를 기준으로 푼다. 근거: [config loader](../../src/config/load-test.config.ts).

`auth/login` 같은 scenario key는 `<workspace>/scenarios/auth/login.yaml`과 `generated/auth/login.k6.js`로 이어진다. 단, slash가 포함된 실제 상대 경로가 존재하면 공개 `--scenario <path-or-key>` 호환성을 위해 그 경로를 우선한다. suite key도 같은 방식으로 `<workspace>/suites/` 아래에서 해석한다. 이 우선순위와 중첩 output stem을 바꾸지 않는다. 근거: [workspace path helpers](../../src/cli/workspace-paths.ts), [경로 분리 결정 기록](../solutions/design-decisions/scenario-key-path-separation.md).

## 변경 체크리스트

- 기존 명령과 `-s/--scenario`, `-o/--openapi`, `-w/--write`, `--config`, `-m/--module`, `--no-input`, `--force` 의미를 유지한다.
- custom `--dir`/`--config`, 공백 포함 경로, standalone `--openapi`, legacy `load-tests/`를 함께 점검한다.
- scaffold 파일이나 안내 문구를 바꾸면 root README, scaffold template, scaffold version, README assertion을 함께 확인한다.
- `.openapi-k6.json`의 구버전·누락은 `validate/test/generate/run`에서 update notice로 이어져야 한다. 근거: [scaffold status](../../src/cli/scaffold-status.ts).
- 새 실행 기능의 호환성 검증 위치는 [UI·Suite·운영](./ui-suite-operations.md)의 CI 계층을 따른다.

## 검증 방법

```bash
pnpm exec vitest run test/cli.test.ts test/fixture.pipeline.test.ts test/readme.usage.test.ts
pnpm run build
pnpm run test:compat
```

`test:compat`는 빌드된 tarball을 `npm exec --package`로 실행해 새 workspace init과 legacy `load-tests`의 `update → sync → catalog → validate → test → generate → update` 및 보존 동작을 확인한다.

## 미확정 사항

없음.

## 근거

- [CLI program](../../src/cli/program.ts)
- [workspace commands](../../src/cli/workspace-command.ts)
- [workspace path helpers](../../src/cli/workspace-paths.ts)
- [config loader](../../src/config/load-test.config.ts)
- [scaffold initializer](../../src/scaffold/load-test.init.ts)
- [CLI tests](../../test/cli.test.ts)
- [backward compatibility smoke](../../scripts/backward-compat-smoke.mjs)
