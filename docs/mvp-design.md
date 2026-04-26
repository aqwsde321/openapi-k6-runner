# OpenAPI 기반 k6 Scenario Generator MVP 설계

## 1. 목적

OpenAPI 스펙을 기반으로 API workflow 시나리오를 정의하고, 이를 k6에서 실행 가능한 JavaScript 스크립트로 변환하는 시스템을 만든다.

## 2. 문제 정의

기존 도구의 한계는 다음과 같다.

- OpenAPI 기반 도구는 단일 API 테스트 중심이다.
- 상태를 공유하는 workflow 시나리오 지원이 부족하다.
- k6는 실행력이 좋지만 시나리오 스크립트를 직접 작성해야 한다.

## 3. 목표

- OpenAPI 기반 API 참조
- 상태 기반 workflow DSL 정의
- k6 실행 스크립트 자동 생성
- 향후 n8n 스타일 UI로 확장 가능한 구조

## 4. 전체 아키텍처

```text
OpenAPI Spec
   ↓
OpenAPI Parser
   ↓
API Registry
   ↓
Scenario DSL (YAML/JSON)
   ↓
Parser
   ↓
OpenAPI Resolver
   ↓
AST (internal model)
   ↓
Code Generator
   ↓
k6 JS Script
   ↓
k6 runtime
```

운영 환경에서는 원격 OpenAPI URL을 매번 직접 사용하는 대신, 테스트 대상 프로젝트 안에 OpenAPI snapshot과 endpoint catalog를 먼저 만든 뒤 compiler 입력으로 사용한다.

```text
Remote OpenAPI URL
   ↓
OpenAPI Sync / Inspect
   ↓
load-tests/openapi/dev.openapi.json
   ↓
load-tests/openapi/catalog.json
   ↓
Scenario 작성 참고
   ↓
generate
```

## 5. 핵심 설계 원칙

1. workflow는 단일 실행 흐름이다.
2. k6 `default function` 안에서 workflow를 실행한다.
3. VU 간 상태 공유는 하지 않는다.
4. DSL을 내부 AST로 변환한 뒤 JavaScript로 컴파일한다.
5. OpenAPI는 API registry 역할이며 시나리오를 주도하지 않는다.

## 6. DSL 스펙 v1

### 기본 구조

```yaml
name: scenario-name

steps:
  - id: step-name

    api:
      operationId: optional
      method: optional
      path: optional

    request:
      headers: {}
      query: {}
      pathParams: {}
      body: {}

    extract:
      varName:
        from: $.json.path

    condition: status == 200
```

### API 참조 방식

`operationId` 기반 참조:

```yaml
api:
  operationId: loginUser
```

`method + path` 기반 참조:

```yaml
api:
  method: POST
  path: /login
```

### Request 구조

```yaml
request:
  headers:
    Authorization: "Bearer {{token}}"

  pathParams:
    orderId: "{{orderId}}"

  body:
    name: "test"
```

### Template 규칙

```yaml
"{{variableName}}"
```

- `context` 값으로 치환한다.
- JavaScript expression은 지원하지 않는다.

### Extract

```yaml
extract:
  token:
    from: $.token
```

- JSONPath를 사용한다.
- 추출한 값은 `context`에 저장한다.

### Condition

```yaml
condition: status == 200
```

- MVP에서는 `status` 기반 조건만 지원한다.
- 조건은 해당 step 실행 후 k6 `check`로 검증한다.
- MVP에서 condition은 흐름 분기나 후속 step 실행 제어에 사용하지 않는다.
- condition 실패 여부와 관계없이 다음 step 실행은 계속된다.

## 7. 실행 모델

### k6 출력 구조

```javascript
import http from 'k6/http';

export default function () {
  const context = {};

  // workflow steps
}
```

### 제약

- 1 VU는 1 workflow를 실행한다.
- scenario 간 데이터 공유는 하지 않는다.
- 모든 step은 동일한 `context`를 공유한다.

## 8. 내부 데이터 모델

### Scenario

```ts
export interface Scenario {
  name: string;
  steps: Step[];
}
```

### Step

```ts
export interface Step {
  id: string;

  api: {
    operationId?: string;
    method?: string;
    path?: string;
  };

  request?: {
    headers?: Record<string, unknown>;
    query?: Record<string, unknown>;
    pathParams?: Record<string, unknown>;
    body?: unknown;
  };

  extract?: Record<string, ExtractRule>;
  condition?: string;
}
```

### ExtractRule

```ts
export interface ExtractRule {
  from: string;
}
```

### ASTStep

```ts
export interface ASTStep {
  id: string;
  method: string;
  path: string;
  pathParameters: unknown[];
  request: NonNullable<Step['request']>;
  extract?: Step['extract'];
  condition?: string;
}
```

`Step.request`는 DSL에서 생략할 수 있지만, AST 생성 시 빈 request 객체로 정규화한다. 따라서 code generator는 항상 `ASTStep.request`가 존재한다고 가정한다.
`ASTStep.pathParameters`에는 OpenAPI `parameters` 중 `in: path`인 metadata만 보존하고, DSL에서 지정한 실제 값은 `request.pathParams`에 유지한다.

## 9. OpenAPI 활용 범위

| 기능 | MVP 적용 |
| --- | --- |
| endpoint 참조 | O |
| request metadata 참조 | O |
| OpenAPI schema 기반 request 자동 생성 | X |
| validation | X |
| 시나리오 자동 생성 | X |

`request metadata 참조`는 OpenAPI의 `parameters`와 `requestBody`를 `ApiRegistry`에 보존한다는 의미다. MVP generator는 request 값을 자동 생성하지 않고 DSL의 `request`를 우선 사용한다.

## 10. OpenAPI 파싱 구조

OpenAPI 스펙은 시나리오 실행 흐름을 만들지는 않지만, 각 step이 참조하는 API endpoint를 안정적으로 해석하기 위한 registry로 변환한다.

### 입력 형식

- JSON
- YAML
- OpenAPI 3.x

### 처리 단계

1. Load: OpenAPI 파일을 읽는다.
2. Parse: JSON/YAML을 JavaScript object로 변환한다.
3. Dereference: `$ref`를 해석한다.
4. Normalize: method는 uppercase, path는 OpenAPI path template 형태로 유지한다.
5. Index: `operationId`와 `method + path` 기준으로 API operation registry를 만든다.

### API Registry

```ts
export interface ApiOperation {
  operationId?: string;
  method: string;
  path: string;
  serverUrl?: string;
  parameters: unknown[];
  requestBody?: unknown;
  responses?: unknown;
}

export interface ApiRegistry {
  byOperationId: Map<string, ApiOperation>;
  byMethodPath: Map<string, ApiOperation>;
  defaultServerUrl?: string;
}
```

### Resolver 책임

- `operationId`로 operation을 찾는다.
- `method + path`로 operation을 찾는다.
- DSL에 `operationId`와 `method + path`가 모두 있으면 `operationId`를 우선한다.
- 참조된 operation이 없으면 컴파일 에러를 발생시킨다.
- OpenAPI path template과 DSL `pathParams`를 연결할 수 있도록 path 정보를 AST에 전달한다.

## 11. Compiler 구조

### 입력

- Scenario DSL
- OpenAPI Spec
- `load-tests/config.yaml` 설정

실제 사용 시 이 입력 파일들은 generator 저장소가 아니라 테스트 대상 백엔드 프로젝트에 두는 것을 기본으로 한다. CLI는 `--config load-tests/config.yaml`을 읽고, config 안의 상대 경로는 config 파일 위치 기준으로 해석한다. 기존 `--openapi` 단일 파일 방식과 루트 `.env BASE_URL` fallback은 호환 목적으로 유지한다.

권장 대상 프로젝트 구조:

```text
backend-project/
└── load-tests/
    ├── config.yaml
    ├── openapi/
    │   ├── bos.openapi.json
    │   └── bos.catalog.json
    ├── scenarios/
    │   └── order-flow.yaml
    └── generated/
        └── order-flow.k6.js
```

`bos.openapi.json`은 원격 OpenAPI URL에서 받은 snapshot이다. `bos.catalog.json`은 사람이 scenario YAML을 작성할 때 참고하는 endpoint 목록이며, compiler의 필수 입력은 아니다.

### 처리 단계

1. Parse: YAML 또는 JSON을 JavaScript object로 변환한다.
2. OpenAPI Parse: OpenAPI 파일을 API registry로 변환한다.
3. Resolve: DSL의 API 참조를 registry의 operation으로 해석한다.
4. AST 생성: 시나리오 step을 실행 가능한 내부 모델로 변환한다.
5. Code Generation: AST를 k6 JavaScript 코드로 변환한다.

## 12. 설정

### `load-tests/config.yaml`

```yaml
baseUrl: https://api.example.com
defaultModule: bos

modules:
  bos:
    openapi: https://api.example.com/v3/api-docs
    snapshot: openapi/bos.openapi.json
    catalog: openapi/bos.catalog.json
```

- k6 스크립트 생성 시 API 호출 URL의 기준 주소로 사용한다.
- config 파일은 `load-tests/config.yaml`에 둔다.
- module별 `openapi`, `snapshot`, `catalog` 경로를 관리한다.
- config 안의 상대 경로는 config 파일 위치 기준으로 해석한다.
- CLI 옵션으로 base URL을 직접 넘기는 방식은 MVP에서 제외한다.
- OpenAPI 입력은 config module의 `snapshot`을 기본으로 한다.
- OpenAPI `servers[0].url`은 config와 `.env`의 base URL이 없을 때만 fallback으로 사용한다.

## 13. OpenAPI Snapshot / Catalog

원격 OpenAPI URL은 generate 실행 때마다 직접 파싱하지 않고, 대상 프로젝트의 snapshot 파일로 고정해 사용하는 것을 권장한다.

snapshot/catalog 생성:

```bash
openapi-k6 sync \
  --config load-tests/config.yaml \
  --module bos
```

`catalog.json` 최소 구조:

```json
{
  "generatedAt": "2026-04-26T00:00:00.000Z",
  "source": "https://dev-api.example.com/v3/api-docs",
  "operations": [
    {
      "method": "GET",
      "path": "/orders/{orderId}",
      "operationId": "getOrder",
      "tags": ["orders"],
      "summary": "Get order",
      "parameters": [],
      "hasRequestBody": false
    }
  ]
}
```

catalog는 사람이 endpoint를 고르고 Scenario DSL을 작성하기 위한 보조 산출물이다. 실제 generate는 snapshot OpenAPI 파일과 scenario YAML을 기준으로 다시 registry를 만든다.

## 14. k6 출력 예시

```javascript
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://api.example.com';

export default function () {
  const context = {};

  const res0 = http.post(`${BASE_URL}/login`);
  context.token = res0.json().token;

  const res1 = http.post(`${BASE_URL}/orders`, null, {
    headers: {
      Authorization: `Bearer ${context.token}`,
    },
  });

  context.orderId = res1.json().id;

  check(res1, {
    'create order status is 200': (res) => res.status === 200,
  });

  const res2 = http.get(`${BASE_URL}/orders/${context.orderId}`);
}
```

## 15. 프로젝트 구조

```text
src/
├── cli/
│   └── index.ts
│
├── config/
│   └── load-test.config.ts
│
├── parser/
│   └── scenario.parser.ts
│
├── openapi/
│   ├── openapi.catalog.ts
│   ├── openapi.parser.ts
│   └── openapi.resolver.ts
│
├── core/
│   ├── types.ts
│   └── template.ts
│
├── compiler/
│   ├── ast.builder.ts
│   └── k6.generator.ts
│
└── utils/
    └── jsonpath.ts
```

## 16. MVP 범위

### 포함

- step 순차 실행
- context 관리
- template 치환
- JSONPath extract
- `status` 기반 condition
- OpenAPI parse/dereference
- OpenAPI operation resolve
- OpenAPI snapshot/catalog 생성
- module별 OpenAPI snapshot 선택

### 제외

- UI
- loop
- retry
- validation
- JavaScript expression

## 17. 확장 계획

### transform

```yaml
transform:
  - toString
  - uppercase
```

### loop

```yaml
foreach: $.items[*]
```

### retry / timeout

추후 step 단위 실행 옵션으로 추가한다.

### UI

AST와 DSL을 기준으로 n8n 스타일 workflow editor를 확장한다.

### multi-module OpenAPI

멀티모듈 OpenAPI 지원은 P-09에서 구현한다. `generate` 1회 실행은 1개 module registry를 사용하고, `--module`로 사용할 module을 선택한다.

단일 모듈 기본 설정 예시:

```yaml
baseUrl: https://api.example.com
defaultModule: bos

modules:
  bos:
    openapi: https://api.example.com/v3/api-docs
    snapshot: openapi/bos.openapi.json
    catalog: openapi/bos.catalog.json
```

멀티모듈 확장 설정 예시:

```yaml
baseUrl: https://api.example.com
defaultModule: bos

modules:
  bos:
    openapi: https://api.example.com/bos/v3/api-docs
    snapshot: openapi/bos.openapi.json
    catalog: openapi/bos.catalog.json

  mall:
    openapi: https://api.example.com/mall/v3/api-docs
    snapshot: openapi/mall.openapi.json
    catalog: openapi/mall.catalog.json
```

확장 규칙:

- `generate` 1회 실행은 기본적으로 1개 module registry를 사용한다.
- CLI는 `--module bos`처럼 module 선택 옵션을 제공한다.
- Scenario DSL v2에서는 step별 module 지정이 필요할 수 있다.
- module이 생략되면 default module을 사용해 기존 단일 모듈 DSL과 호환한다.
- OpenAPI 문서 경로 자동 탐색은 module 등록 기능과 함께 구현한다.

## 18. 미결정 사항

MVP 구현 전에 다음 항목만 결정하면 바로 스캐폴딩할 수 있다.

| 항목 | 권장안 | 이유 |
| --- | --- | --- |
| 패키지 매니저 | pnpm | TypeScript CLI 프로젝트에 적합하고 락파일이 명확하다. |
| CLI 런타임 | Node.js + TypeScript | OpenAPI, YAML, code generation 생태계가 안정적이다. |
| YAML parser | yaml | YAML parse/stringify 기능이 단순하고 충분하다. |
| OpenAPI parser | @apidevtools/swagger-parser | OpenAPI dereference/parse 지원이 널리 쓰인다. |
| JSONPath 라이브러리 | jsonpath-plus | k6 코드 생성 시에도 동일한 경로 규칙을 모델링하기 쉽다. |
| 테스트 프레임워크 | vitest | TypeScript 단위 테스트 구성이 가볍다. |
| CLI 명령 형태 | `openapi-k6 generate --config load-tests/config.yaml --module bos -s scenario.yaml -w output.js` | 입력/출력 책임이 명확하다. base URL과 OpenAPI snapshot은 config에서 읽는다. |

## 19. 다음 구현 순서

1. TypeScript CLI 프로젝트 초기화
2. DSL 타입과 parser 구현
3. OpenAPI parser와 API registry 구현
4. OpenAPI resolver 구현
5. AST builder 구현
6. k6 generator 구현
7. fixture 기반 단위 테스트 추가
8. README에 최소 사용법 추가
