# openapi-k6-runner

OpenAPI 스펙과 Scenario DSL을 기반으로 k6 실행 스크립트를 생성하는 CLI 도구입니다.

## 설치

개발 중에는 이 저장소에서 의존성을 설치하고 빌드한 뒤 CLI를 실행합니다.

```bash
pnpm install
pnpm run build
node dist/cli/index.js --help
```

패키지로 설치하거나 링크한 뒤에는 `openapi-k6` 명령을 사용합니다.

```bash
openapi-k6 --help
```

생성된 스크립트를 실행하려면 별도로 k6가 설치되어 있어야 합니다.

## 사용 위치

실제 시나리오, OpenAPI snapshot, `.env`는 테스트 대상 백엔드 프로젝트에 두는 것을 기본으로 합니다.

```text
backend-project/
├── .env
└── load-tests/
    ├── openapi/
    │   ├── dev.openapi.json
    │   └── catalog.json
    ├── scenarios/
    │   └── order-flow.yaml
    └── generated/
        └── order-flow.k6.js
```

이 저장소의 `.env`는 generator 개발/검증용 로컬 설정입니다. 배포된 CLI는 실행한 현재 디렉터리의 `.env`를 읽습니다.

## .env

`backend-project/.env`:

```dotenv
BASE_URL=https://dev-api.example.com
```

- `generate` 실행 시 `.env`의 `BASE_URL`을 읽어 generated k6 script의 fallback URL로 넣습니다.
- k6 실행 시에는 `__ENV.BASE_URL`이 우선입니다.
- k6는 `.env`를 자동으로 읽지 않으므로 실행 시 URL을 바꾸려면 `BASE_URL=... k6 run ...`처럼 넘깁니다.
- `.env`가 없으면 OpenAPI `servers[0].url`을 fallback으로 사용합니다.

## OpenAPI Snapshot

원격 OpenAPI URL을 매번 직접 `generate`에 넘기지 않고, 대상 프로젝트의 snapshot 파일로 고정해 사용합니다.

```bash
openapi-k6 sync \
  --openapi https://dev-api.example.com/v3/api-docs \
  --write load-tests/openapi/dev.openapi.json \
  --catalog load-tests/openapi/catalog.json
```

`sync`는 원격 OpenAPI URL 또는 로컬 OpenAPI 파일을 읽어 다음 파일을 생성합니다.

- `load-tests/openapi/dev.openapi.json`: `generate` 입력으로 사용할 OpenAPI snapshot
- `load-tests/openapi/catalog.json`: scenario 작성 참고용 endpoint 목록

`catalog.json`은 사람이 `operationId`, `method`, `path`, `tags`, `parameters`, `hasRequestBody`를 확인하기 위한 보조 파일입니다. `generate`는 `catalog.json`이 아니라 snapshot OpenAPI 파일을 다시 파싱합니다.

## OpenAPI 예시

```yaml
openapi: 3.0.3
info:
  title: Store API
  version: 1.0.0
servers:
  - url: https://dev-api.example.com
paths:
  /auth/login:
    post:
      operationId: loginUser
      responses:
        "200":
          description: OK
  /orders:
    post:
      operationId: createOrder
      responses:
        "201":
          description: Created
  /orders/{orderId}:
    get:
      operationId: getOrder
      parameters:
        - name: orderId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: OK
```

## Scenario 예시

`load-tests/scenarios/order-flow.yaml`:

```yaml
name: order-flow

steps:
  - id: login
    api:
      operationId: loginUser
    request:
      body:
        username: tester
        password: secret
    extract:
      token:
        from: $.token
    condition: status == 200

  - id: create-order
    api:
      operationId: createOrder
    request:
      headers:
        Authorization: "Bearer {{token}}"
      body:
        sku: SKU-001
        quantity: 1
    extract:
      orderId:
        from: $.data.id
    condition: status == 201

  - id: get-order
    api:
      method: GET
      path: /orders/{orderId}
    request:
      headers:
        Authorization: "Bearer {{token}}"
      pathParams:
        orderId: "{{orderId}}"
      query:
        includeItems: true
    condition: status < 300
```

지원 범위:

- API 참조: `operationId` 또는 `method + path`
- template: `{{variableName}}`
- extract JSONPath: `$.token`, `$.data.id`, `$.items[0].id`
- condition: `status == 200`, `status != 500`, `status >= 200`, `status < 300`

`condition`은 흐름 분기가 아니라 k6 `check`로 생성됩니다. 실패해도 다음 step 실행은 계속됩니다.

## k6 Script 생성

대상 프로젝트 루트에서 실행합니다.

```bash
openapi-k6 generate \
  --scenario load-tests/scenarios/order-flow.yaml \
  --openapi load-tests/openapi/dev.openapi.json \
  --write load-tests/generated/order-flow.k6.js
```

생성 결과는 `load-tests/generated/order-flow.k6.js`에 저장됩니다.

## k6 실행

생성된 스크립트는 직접 k6로 실행합니다.

```bash
k6 run load-tests/generated/order-flow.k6.js
```

실행 시 URL을 바꾸려면 `BASE_URL` 환경 변수를 넘깁니다.

```bash
BASE_URL=https://dev-api.example.com k6 run load-tests/generated/order-flow.k6.js
```

## 개발 검증

이 저장소에서 전체 검증을 실행합니다.

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm run build
```

## 문서

- [문서 색인](docs/README.md)
- [MVP 설계](docs/mvp-design.md)
- [기능 세분화](docs/feature-breakdown.md)
- [참조 프로젝트 분석](docs/reference-projects.md)
- [문서 기반 작업 계획](docs/work-plan.md)
