# 기능 세분화

## 1. 기능 경계

MVP는 `Scenario DSL + OpenAPI Spec + .env`를 입력으로 받아 k6 JavaScript 파일을 생성하는 CLI/compiler다.

UI, Supabase 저장소, 브라우저 실행기는 MVP 구현 범위에서 제외한다. 다만 UI 확장을 고려해 내부 모델은 `Scenario`, `ApiRegistry`, `AST`로 분리한다.

## 2. 기능 목록

| ID | 기능 | 우선순위 | MVP 포함 |
| --- | --- | --- | --- |
| F-01 | 프로젝트/CLI 골격 | P0 | O |
| F-02 | 설정 로딩 | P0 | O |
| F-03 | Scenario DSL parser | P0 | O |
| F-04 | OpenAPI parser / API registry | P0 | O |
| F-05 | OpenAPI resolver | P0 | O |
| F-06 | AST builder | P0 | O |
| F-07 | Template compiler | P0 | O |
| F-08 | JSONPath extract | P0 | O |
| F-09 | Condition compiler | P0 | O |
| F-10 | k6 generator | P0 | O |
| F-11 | Fixture 기반 테스트 | P0 | O |
| F-12 | UI adapter 설계 | P1 | 문서만 |
| F-13 | k6 실행 자동화 | P2 | X |
| F-14 | 멀티모듈 OpenAPI 설정 | P1 | 필수 후속 |

## 3. F-01 프로젝트/CLI 골격

### 책임

- TypeScript CLI 프로젝트를 초기화한다.
- `generate` 명령을 제공한다.
- 입력 파일 경로와 출력 파일 경로를 받는다.

### 입력

```text
openapi-k6 generate -s scenario.yaml -o openapi.yaml -w output.js
```

### 출력

- 지정된 경로의 k6 JavaScript 파일
- 실패 시 사람이 읽을 수 있는 에러 메시지

### 완료 기준

- CLI 명령이 존재한다.
- 필수 옵션 누락 시 실패한다.
- 성공 시 output 파일을 생성한다.

## 4. F-02 설정 로딩

### 책임

- `.env`에서 `BASE_URL`을 읽는다.
- `BASE_URL`이 없으면 OpenAPI `servers[0].url`을 fallback으로 사용한다.
- generated k6 script에서는 `__ENV.BASE_URL`을 우선 사용한다.

### 우선순위

1. k6 실행 시 `__ENV.BASE_URL`
2. 컴파일 시 `.env`의 `BASE_URL`
3. OpenAPI `servers[0].url`
4. 없으면 컴파일 에러

### 완료 기준

- `.env`가 없어도 OpenAPI server fallback이 동작한다.
- 둘 다 없으면 명확한 에러가 발생한다.
- `.env` 파일 자체는 커밋하지 않는다.

## 5. F-03 Scenario DSL Parser

### 책임

- YAML/JSON DSL 파일을 읽어 `Scenario` 객체로 변환한다.
- MVP 수준의 구조 검증을 수행한다.

### 입력

```yaml
name: login-and-order
steps:
  - id: login
    api:
      operationId: loginUser
```

### 검증

- `name`은 문자열이어야 한다.
- `steps`는 1개 이상이어야 한다.
- 각 step은 `id`와 `api`를 가져야 한다.
- `api`는 `operationId` 또는 `method + path` 중 하나를 가져야 한다.
- step id는 중복될 수 없다.

### 완료 기준

- YAML과 JSON을 모두 읽을 수 있다.
- 잘못된 DSL은 step 위치가 포함된 에러를 낸다.

## 6. F-04 OpenAPI Parser / API Registry

### 책임

- OpenAPI JSON/YAML 파일을 읽는다.
- OpenAPI 3.x 여부를 확인한다.
- `$ref`를 dereference한다.
- operation을 `ApiRegistry`로 인덱싱한다.

### ApiOperation 필드

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

### Index

- `byOperationId`: `operationId`
- `byMethodPath`: `${METHOD} ${path}`

### 에러

- OpenAPI 2.0은 MVP에서 제외한다.
- 중복 `operationId`는 컴파일 에러로 처리한다.
- 지원하지 않는 HTTP method는 registry에서 제외한다.

### 완료 기준

- OpenAPI 3.0/3.1 fixture가 registry로 변환된다.
- path-level parameters와 operation-level parameters가 병합된다.
- method는 uppercase로 정규화된다.

## 7. F-05 OpenAPI Resolver

### 책임

- DSL step의 `api` 참조를 `ApiOperation`으로 연결한다.
- `operationId`가 있으면 우선 사용한다.
- `operationId`가 없으면 `method + path`를 사용한다.

### 완료 기준

- 존재하지 않는 operation은 step id가 포함된 에러를 낸다.
- `operationId`와 `method + path`가 모두 있으면 `operationId` 기준으로 resolve한다.

## 8. F-06 AST Builder

### 책임

- `Scenario`와 resolved operation을 결합해 code generation용 AST를 만든다.
- OpenAPI path template, request, extract, condition을 한 step 모델로 정리한다.

### ASTStep

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

### 완료 기준

- 모든 step이 실행 순서대로 AST에 포함된다.
- request가 없는 step도 빈 request로 정규화된다.
- OpenAPI path parameter 이름과 DSL `pathParams`를 함께 보존한다.
- OpenAPI path parameter metadata는 `pathParameters`에, DSL 값은 `request.pathParams`에 보존한다.

## 9. F-07 Template Compiler

### 책임

- DSL 값 안의 `{{variableName}}`를 k6 script에서 `context.variableName` 참조로 변환한다.
- JavaScript expression은 지원하지 않는다.

### 지원 범위

- 문자열 전체가 template인 경우
- 문자열 일부에 template이 포함된 경우
- object/array 내부 template 재귀 변환

### 예시

```yaml
Authorization: "Bearer {{token}}"
```

```javascript
`Bearer ${context.token}`
```

### 완료 기준

- 존재하지 않는 변수는 런타임에서 빈 문자열로 대체하지 않는다.
- 생성된 script에서 context 접근이 명확히 보인다.

## 10. F-08 JSONPath Extract

### 책임

- step 응답 JSON에서 값을 추출해 `context`에 저장하는 코드를 생성한다.

### MVP 지원 범위

- `$.token`
- `$.data.id`
- `$.items[0].id`

### 주의

k6 런타임은 Node.js npm 패키지를 그대로 사용할 수 없다. 따라서 MVP에서는 generated script 안에 작은 JSONPath helper를 포함하거나, 지원 범위의 JSONPath를 property access 코드로 컴파일한다.

`jsonpath-plus`는 compiler/test 단계의 검증 보조로는 사용할 수 있지만, generated k6 script가 직접 의존하지 않는 것을 기본 원칙으로 한다.

### 완료 기준

- 지원 범위 밖의 JSONPath는 컴파일 에러를 낸다.
- 추출 대상이 없을 때 context 값은 `undefined`가 된다.

## 11. F-09 Condition Compiler

### 책임

- `status == 200` 형태의 condition을 k6 `check` 코드로 변환한다.

### MVP 지원 범위

```text
status == 200
status != 500
status >= 200
status < 300
```

### 의미

MVP에서 condition은 흐름 분기 조건이 아니라 check/assertion이다. 실패해도 다음 step 실행은 계속된다.

흐름 중단 또는 branch는 후속 기능으로 분리한다.

### 완료 기준

- 지원하지 않는 expression은 컴파일 에러를 낸다.
- generated script에 `check` import와 check block이 포함된다.

## 12. F-10 k6 Generator

### 책임

- AST를 k6 JavaScript 파일로 변환한다.
- method별 `http.get/post/put/patch/del` 호출을 생성한다.
- pathParams, query, headers, body를 k6 호출 형태로 만든다.

### 생성 규칙

- `GET/DELETE`는 body 없이 호출한다.
- k6 API에서 `DELETE`는 `http.del`로 생성한다.
- `POST/PUT/PATCH`는 body를 JSON 문자열로 전달한다.
- `Content-Type: application/json`은 body가 있을 때 기본 추가한다.
- query는 URL query string으로 붙인다.
- path parameter는 OpenAPI `{id}`를 template literal로 치환한다.

### 완료 기준

- 생성된 파일은 k6 문법으로 실행 가능해야 한다.
- 각 step 응답은 `res0`, `res1`처럼 고유 변수에 저장된다.
- extract와 condition이 step 직후에 생성된다.

## 13. F-11 Fixture 기반 테스트

### 책임

- parser, resolver, generator를 fixture로 검증한다.

### Fixture

- OpenAPI 3.0 기본 fixture
- OpenAPI 3.1 기본 fixture
- login/order workflow scenario
- pathParams/query/body/header template scenario
- extract/condition scenario

### 완료 기준

- parser 단위 테스트
- OpenAPI registry 단위 테스트
- AST builder 단위 테스트
- k6 generator snapshot 또는 문자열 검증 테스트

## 14. F-12 UI Adapter 설계

### 책임

- `swagger-flow-tester`의 UI flow model을 Scenario DSL로 변환하는 규칙을 문서화한다.

### 변환 대상

- `modules[].apis[]` -> `ApiRegistry` 또는 UI API library
- `flowSteps[]` -> `Scenario.steps[]`
- `connections[]` -> 실행 순서
- step params/header/body -> DSL `request`
- binding -> DSL template 또는 `extract`

### MVP 상태

문서만 작성하고 구현하지 않는다.

## 15. F-13 k6 실행 자동화

### 책임

- generated script를 `k6 run`으로 실행하는 wrapper를 제공한다.

### MVP 상태

제외한다. 사용자는 생성된 script를 직접 k6로 실행한다.

## 16. F-14 멀티모듈 OpenAPI 설정

### 책임

- 여러 OpenAPI module을 등록하고 선택할 수 있는 설정 모델을 제공한다.
- module별 OpenAPI 문서 경로를 관리한다.
- module 선택 결과를 `ApiRegistry` 생성과 resolver 입력으로 연결한다.

### MVP 상태

MVP 구현 범위에서는 제외하지만, 제품 요구사항으로는 필수 후속 기능이다.

### 설정 방향

후속 단일 모듈 기본값:

```dotenv
BASE_URL=https://api.example.com
OPENAPI_PATH=/v3/api-docs
```

멀티모듈 확장값:

```dotenv
BASE_URL=https://api.example.com
OPENAPI_BOS_PATH=/bos/v3/api-docs
OPENAPI_MALL_PATH=/mall/v3/api-docs
OPENAPI_ADMIN_PATH=/admin/v3/api-docs
```

### CLI 방향

```text
openapi-k6 generate --module bos -s scenario.yaml -w output.js
```

### DSL 확장 방향

```yaml
steps:
  - id: get-order
    api:
      module: bos
      operationId: getOrder
```

### 완료 기준

- module 이름으로 OpenAPI spec을 선택할 수 있다.
- module별 registry가 분리된다.
- module이 생략되면 default module을 사용한다.
- 기존 단일 모듈 scenario는 수정 없이 동작한다.
