# 기능 범위

## 구현된 기능

| 기능 | 상태 |
| --- | --- |
| TypeScript CLI | 구현 |
| `init` scaffold | 구현 |
| `sync` OpenAPI snapshot/catalog | 구현 |
| `generate` k6 script 생성 | 구현 |
| `load-tests/config.yaml` | 구현 |
| 멀티모듈 config 선택 | 구현 |
| Scenario YAML/JSON parser | 구현 |
| OpenAPI 3.x parser / dereference | 구현 |
| operationId resolver | 구현 |
| method/path resolver | 구현 |
| AST builder | 구현 |
| template compiler | 구현 |
| JSONPath extract | 구현 |
| status condition check | 구현 |
| fixture 기반 테스트 | 구현 |

## CLI

```bash
openapi-k6 init
openapi-k6 sync
openapi-k6 generate -s smoke
```

호환 옵션:

- `generate --openapi <path>`
- `generate --write <path>`
- `generate --config <path>`
- `generate --module <name>`
- `sync --openapi <url-or-path>`
- `sync --write <path>`
- `sync --catalog <path>`
- `sync --config <path>`
- `sync --module <name>`

## Scenario DSL 지원 범위

```yaml
name: scenario-name

steps:
  - id: step-id
    api:
      operationId: getUser
      # or
      method: GET
      path: /users/{userId}
    request:
      headers: {}
      query: {}
      pathParams: {}
      body: {}
    extract:
      userId:
        from: $.data.id
    condition: status == 200
```

지원:

- API 참조: `operationId`, `method + path`
- request: `headers`, `query`, `pathParams`, `body`
- template: `{{variableName}}`
- extract: `$.token`, `$.data.id`, `$.items[0].id`
- condition: `status == 200`, `status != 500`, `status >= 200`, `status < 300`

제약:

- condition은 branch가 아니라 k6 `check`다.
- step 실행 순서는 `steps[]` 배열 순서다.
- VU 간 state 공유는 없다.
- Scenario DSL 내부 `api.module`은 아직 없다.

## OpenAPI 지원 범위

- OpenAPI 3.0 / 3.1
- JSON / YAML 입력
- `$ref` dereference
- path-level + operation-level parameter 병합
- `operationId` index
- `METHOD path` index
- endpoint catalog 생성

지원 method:

- `GET`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`

제외:

- OpenAPI 2.0
- schema 기반 request 자동 생성
- request/response validation
- auth scheme 자동 적용

## k6 generator 규칙

- `GET`, `DELETE`는 body 없이 생성한다.
- `DELETE`는 k6 API에 맞춰 `http.del`을 사용한다.
- `POST`, `PUT`, `PATCH`는 body를 JSON 문자열로 전달한다.
- body가 있으면 `Content-Type: application/json`을 기본 추가한다.
- query는 URL query string으로 붙인다.
- path parameter는 OpenAPI `{id}`를 template literal로 치환한다.
- extract와 condition은 해당 step 직후에 생성한다.

## 후속 후보

- UI flow adapter
- Swagger/OpenAPI URL 자동 탐색
- auth header 제안
- loop / retry / timeout
- k6 실행 wrapper
- validation
