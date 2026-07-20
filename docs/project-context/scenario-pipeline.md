---
title: Scenario 파이프라인
description: Scenario DSL의 확장·검증, OpenAPI 해석, AST, Node 실행과 k6 생성의 의미 계약
read_when: Scenario 문법, template, OpenAPI 검증, executor 또는 generator를 변경할 때
---

[← Project Context](../project-context.md)

# Scenario 파이프라인

## 데이터 흐름

공개 Scenario 명령은 같은 준비 흐름을 공유한다.

`scenario path 해석 → YAML parse·include/use 확장 → vars override → OpenAPI registry 구성 → 정적 검증 → AST build → Node 실행 또는 k6 생성`

`validate`는 정적 검증까지만 수행한다. `test`는 AST를 Node.js executor로 실행하고, `generate`는 검증된 AST를 k6 JavaScript로 쓴다. `run`은 generate 뒤 k6 프로세스를 실행한다. 명령별 파일·config 해석은 [CLI와 작업공간](./cli-workspace.md), 실행 결과의 UI 소비 방식은 [UI·Suite·운영](./ui-suite-operations.md)을 따른다. 근거: [scenario commands](../../src/cli/scenario-command.ts), [shared script preparation](../../src/cli/scenario-script.ts).

## Parse와 재사용 경계

entry Scenario는 `name`, 비어 있지 않은 `steps`, 선택 `description`·`vars`·`fixtures`를 가진다. API step은 `id`와 `api.operationId` 또는 `api.method + api.path`를 요구한다. input step은 API request/extract/condition과 함께 쓸 수 없다. 펼친 전체 step에서 `id`는 중복될 수 없고, `request.body`와 `request.multipart`도 동시에 쓸 수 없다. 근거: [Scenario types](../../src/core/types.ts), [Scenario parser](../../src/parser/scenario.parser.ts).

- `include`는 현재 파일 기준 상대 경로를 사용하되 entry scenario의 include 경계 밖으로 나갈 수 없다.
- `use`는 scenario root 기준의 확장자 없는 key다. `auth/login`은 `scenarios/auth/login.yaml`을 뜻하며 절대경로, template, `.`·`..` segment를 거부한다.
- include/use로 읽는 파일은 steps만 제공한다. `vars`와 `fixtures`는 entry Scenario에서만 정의한다. 순환 참조를 거부한다.
- fixture 값 위에 entry `vars`, 반복된 `--var-file` 순서, 마지막으로 `--var` 값이 덮어쓴다. 이름은 template에서 안전하게 참조할 수 있는 식별자여야 한다. 근거: [var overrides](../../src/cli/scenario-var-overrides.ts), [var name rules](../../src/core/scenario-vars.ts).

이 경계는 파일 탈출 방지와 기존 DSL 호환성 모두를 위한 것이다. `include`를 scenario 전역 재사용으로 넓히거나 `use`를 임의 path로 바꾸지 않는다.

## Template·OpenAPI 정적 검증

template namespace는 이전 step의 extract/input context인 `{{name}}`, runtime secret·접속값인 `{{env.NAME}}`, 공개 데이터인 `{{vars.NAME}}`, 실행별 값인 `{{k6.*}}`로 나뉜다. 값 전체가 template 하나면 원래 타입을 유지하고, 문자열 안의 template은 문자열로 보간한다. 정적 검증은 context가 사용 전에 만들어졌는지, vars가 존재하는지, template 문법과 `<placeholder>` 잔존 여부를 확인한다. 근거: [template compiler](../../src/core/template.ts), [Scenario validator](../../src/validator/scenario.validator.ts).

각 API step은 선택된 module registry에서 operationId 또는 method/path로 실제 operation을 찾는다. validator는 path/query/header 필수 parameter, body·multipart 지원과 content type, 필수 body field, extract JSONPath, 지원 condition을 확인한다. multi-module Scenario는 step `api.module`과 fallback module을 같은 규칙으로 validator와 AST builder에 적용한다. 근거: [API registry selection](../../src/core/api-registry.ts), [OpenAPI resolver](../../src/openapi/openapi.resolver.ts), [AST builder](../../src/compiler/ast.builder.ts).

AST는 operation을 method/path와 module name으로 해소한 실행 계약이다. parser나 validator가 허용한 문법이 AST로 표현되지 않으면 executor와 generator에 전달되지 않는다.

## Node 실행과 k6 생성

`test`는 작업공간 `.env` 위에 process environment를 병합하고 process 값에 우선권을 준다. AST step을 순서대로 요청하고 response extract를 context에 넣는다. condition이 없으면 HTTP status `< 400`이 기본 성공 조건이다. condition 또는 extract가 실패하면 해당 Scenario의 뒤 step을 실행하지 않는다. input은 먼저 vars에서 찾고, 없으면 TTY/UI provider에 요청하며 sensitive 값은 출력 masking 대상에 넣는다. 근거: [Scenario executor](../../src/executor/scenario.executor.ts), [environment loader](../../src/cli/load-test-env.ts).

k6 generator는 외부 runtime dependency 없는 JavaScript와 필요한 helper를 만든다. 같은 AST의 request, module base URL, template, extract와 condition을 옮기며, `{{env.*}}`는 `__ENV`, `{{k6.*}}`는 `k6/execution` 값으로 이어진다. input은 대화형 provider 없이 `VARS.<name>`만 읽고 필수 값이 없으면 실패한다. 생성 script의 masking은 env template 값만 추적하므로 Node executor의 sensitive input masking과 같지 않다. 근거: [k6 generator](../../src/compiler/k6.generator.ts).

## 변경 체크리스트

- 새 DSL 의미를 추가하면 types, parser, validator, AST, Node executor, k6 generator와 각 테스트를 함께 확인한다.
- Node test와 generated k6의 default status, template, extract, 실패 중단 의미를 비교하고, input provider와 sensitive input masking의 현재 runtime 차이를 의도치 않게 넓히지 않는다.
- operation/module 해석 변경은 단일 module, explicit `api.module`, CLI `--module`, multi-module E2E를 모두 확인한다.
- path·multipart 파일 경계를 넓히지 않고, env/sensitive 값이 URL·error·response 출력에서 masking되는지 확인한다.
- generate는 정적 검증이 끝난 뒤 파일을 써야 하므로 실패 시 기존 생성물을 보존한다.

## 검증 방법

```bash
pnpm exec vitest run test/scenario.parser.test.ts test/scenario.validator.test.ts test/ast.builder.test.ts test/scenario.executor.test.ts test/k6.generator.test.ts test/openapi.registry.test.ts
pnpm exec vitest run test/fixture.pipeline.test.ts test/cli.test.ts
pnpm run smoke:e2e
```

## 미확정 사항

없음.

## 근거

- [Scenario types](../../src/core/types.ts)
- [Scenario parser](../../src/parser/scenario.parser.ts)
- [Scenario validator](../../src/validator/scenario.validator.ts)
- [AST builder](../../src/compiler/ast.builder.ts)
- [Scenario executor](../../src/executor/scenario.executor.ts)
- [k6 generator](../../src/compiler/k6.generator.ts)
- [Scenario command orchestration](../../src/cli/scenario-command.ts)
- [Scenario tests](../../test/scenario.parser.test.ts)
- [executor tests](../../test/scenario.executor.test.ts)
- [generator tests](../../test/k6.generator.test.ts)
