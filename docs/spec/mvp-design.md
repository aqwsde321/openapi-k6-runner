# MVP 설계

OpenAPI 스펙과 Scenario DSL을 입력으로 받아 k6 JavaScript 스크립트를 생성하는 CLI/compiler다.

## 아키텍처

```text
load-tests/config.yaml
OpenAPI snapshot
Scenario DSL
   ↓
Parser / OpenAPI Registry
   ↓
Resolver
   ↓
AST
   ↓
k6 Generator
   ↓
load-tests/generated/*.k6.js
```

운영 기준:

- 테스트 자산은 대상 백엔드 프로젝트의 `load-tests/` 아래에 둔다.
- 원격 OpenAPI URL은 `sync`로 snapshot 파일에 고정한다.
- `generate`는 원격 URL이 아니라 snapshot OpenAPI와 Scenario DSL을 사용한다.
- config 안의 상대 경로는 `config.yaml` 위치 기준으로 해석한다.

권장 구조:

```text
backend-project/
└── load-tests/
    ├── config.yaml
    ├── .env.example
    ├── .gitignore
    ├── run.sh
    ├── openapi/
    │   ├── pharma.openapi.json
    │   └── pharma.catalog.json
    ├── scenarios/
    │   └── smoke.yaml
    └── generated/
        └── smoke.k6.js
```

## 실행 흐름

```bash
openapi-k6 init
openapi-k6 sync
openapi-k6 generate -s smoke
./load-tests/run.sh smoke
```

`init`은 `TODO` placeholder를 생성한다. `sync`와 `generate`는 필요한 config 값이 `TODO`로 남아 있으면 실패한다.

## Config

```yaml
baseUrl: https://api.example.com
defaultModule: pharma

modules:
  pharma:
    openapi: https://api.example.com/v3/api-docs
    snapshot: openapi/pharma.openapi.json
    catalog: openapi/pharma.catalog.json
```

- `baseUrl`: generated k6 script의 fallback API base URL
- `defaultModule`: `--module` 생략 시 사용할 module
- `modules.<name>.openapi`: `sync`가 읽을 원격 URL 또는 파일
- `modules.<name>.snapshot`: `sync`가 저장하고 `generate`가 읽을 OpenAPI snapshot
- `modules.<name>.catalog`: scenario 작성 참고용 endpoint catalog

멀티모듈은 `modules`에 항목을 추가하고 `--module`로 선택한다. Scenario DSL 내부 `api.module`은 아직 지원하지 않는다.

## Scenario DSL

```yaml
name: order-flow

steps:
  - id: login
    api:
      operationId: loginUser
    request:
      body:
        username: "{{env.LOGIN_ID}}"
        password: "{{env.LOGIN_PASSWORD}}"
    extract:
      token:
        from: $.token
    condition: status == 200

  - id: get-order
    api:
      method: GET
      path: /orders/{orderId}
    request:
      headers:
        Authorization: "Bearer {{token}}"
      pathParams:
        orderId: "{{orderId}}"
    condition: status < 300
```

DSL 원칙:

- step은 배열 순서대로 실행한다.
- 모든 step은 같은 `context`를 공유한다.
- `{{token}}`은 `context.token` 참조로 컴파일한다.
- `{{env.LOGIN_PASSWORD}}`는 k6 런타임 환경변수 `__ENV.LOGIN_PASSWORD` 참조로 컴파일한다.
- `condition`은 k6 `check`이며 흐름 분기가 아니다.
- condition 실패와 관계없이 다음 step은 실행된다.

## OpenAPI Registry

OpenAPI는 시나리오를 생성하지 않고 endpoint 참조를 해석하는 registry 역할만 한다.

```ts
interface ApiOperation {
  operationId?: string;
  method: string;
  path: string;
  serverUrl?: string;
  parameters: unknown[];
  requestBody?: unknown;
  responses?: unknown;
}
```

Resolver 규칙:

- `operationId`가 있으면 우선 사용한다.
- 없으면 `method + path`로 찾는다.
- 지원 method는 `GET`, `POST`, `PUT`, `PATCH`, `DELETE`다.
- OpenAPI schema 기반 request 자동 생성과 validation은 MVP 범위가 아니다.

## AST

```ts
interface ASTStep {
  id: string;
  method: string;
  path: string;
  pathParameters: unknown[];
  request: {
    headers?: Record<string, unknown>;
    query?: Record<string, unknown>;
    pathParams?: Record<string, unknown>;
    body?: unknown;
  };
  extract?: Record<string, { from: string }>;
  condition?: string;
}
```

DSL에서 `request`를 생략해도 AST에서는 빈 객체로 정규화한다.

## k6 출력

```javascript
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://api.example.com';

export default function () {
  const context = {};
  const res0 = http.get(`${BASE_URL}/health`);

  check(res0, {
    'health status is 200': (res) => res.status === 200,
  });
}
```

## 제외 기능

- UI
- loop / retry / timeout
- request/response validation
- JavaScript expression
- schema 기반 request 자동 생성
- k6 실행 wrapper
