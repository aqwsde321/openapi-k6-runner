# 참조 프로젝트 분석

## 1. 목적

다음 두 프로젝트에서 재사용할 개념을 분리한다.

- `/Users/slogup/project/test/openapi-projector`
- `/Users/slogup/project/slogup-study/swagger-flow-tester`

MVP 구현에서는 코드를 그대로 복사하지 않는다. 필요한 책임과 데이터 모델만 TypeScript 구조로 재구성한다.

## 2. 참조 프로젝트 역할 구분

| 프로젝트 | 주 역할 | 우리 프로젝트에서의 활용 |
| --- | --- | --- |
| openapi-projector | OpenAPI catalog/backend 처리 | OpenAPI parser, operation registry, fixture |
| swagger-flow-tester | UI flow builder/runtime UX | 향후 UI adapter, flow model, auth/env UX |

## 3. openapi-projector 분석

### 참고할 기능

#### OpenAPI 3.0/3.1 검사

- 파일: `/Users/slogup/project/test/openapi-projector/src/openapi/load-spec.mjs`
- 참고 포인트:
  - OpenAPI 3.0/3.1만 허용
  - Swagger 2.0은 명확한 에러 처리

#### endpoint catalog 생성

- 파일: `/Users/slogup/project/test/openapi-projector/src/core/openapi-utils.mjs`
- 참고 포인트:
  - path를 정렬해서 순회
  - HTTP method 순서 고정
  - operationId, method, path, tags, summary 추출

#### `$ref`와 parameter 처리

- 파일: `/Users/slogup/project/test/openapi-projector/src/core/openapi-utils.mjs`
- 참고 포인트:
  - local `$ref` 조회
  - path-level parameters와 operation-level parameters 병합
  - requestBody/response resolve

#### response/request schema helper

- 파일: `/Users/slogup/project/test/openapi-projector/src/core/openapi-utils.mjs`
- 참고 포인트:
  - primary response 선택
  - requestBody schema 추출
  - response schema 추출

#### fixture

- 경로:
  - `/Users/slogup/project/test/openapi-projector/test/fixtures/oas30.json`
  - `/Users/slogup/project/test/openapi-projector/test/fixtures/oas31.json`
- 활용:
  - 우리 프로젝트 테스트 fixture의 출발점으로 참고

### 그대로 가져오지 않을 것

- `.mjs` 기반 구조
- JSON 중심 parser
- TypeScript schema generator
- 프로젝트 설정 파일 구조

### 우리 프로젝트로 재구성할 형태

```text
src/openapi/openapi.parser.ts
src/openapi/openapi.resolver.ts
src/core/types.ts
```

`openapi-projector`의 catalog 개념은 두 갈래로 재구성한다.

- compiler 내부에서는 `ApiRegistry`로 축소한다.
- 대상 프로젝트 운영에서는 `load-tests/openapi/catalog.json`으로 다시 노출해 scenario 작성자가 endpoint를 고를 수 있게 한다.

## 4. swagger-flow-tester 분석

### 참고할 기능

#### OpenAPI UI 정규화

- 파일: `/Users/slogup/project/slogup-study/swagger-flow-tester/src/openapi.js`
- 참고 포인트:
  - operation을 UI에서 쓰기 좋은 API item으로 변환
  - params 생성
  - enum/type 추출
  - requestExample/responseExample 생성
  - response schema flatten

#### Swagger/OpenAPI URL 탐색

- 파일: `/Users/slogup/project/slogup-study/swagger-flow-tester/src/store.js`
- 참고 포인트:
  - `/v3/api-docs`
  - `/api-docs-json`
  - `/v2/api-docs`
  - `/api-docs`
  - `/swagger.json`

이 기능은 CLI MVP에는 넣지 않는다. MVP 이후 필수 멀티모듈 OpenAPI 설정과 UI module 등록 기능을 만들 때 참고한다.

#### 인증 스킴 감지

- 파일: `/Users/slogup/project/slogup-study/swagger-flow-tester/src/store.js`
- 참고 포인트:
  - bearer
  - basic
  - apiKey header
  - oauth2
  - openIdConnect

MVP DSL에는 자동 인증 스킴 적용을 넣지 않는다. 향후 UI에서 header template 자동 제안에 사용한다.

#### Flow builder model

- 파일:
  - `/Users/slogup/project/slogup-study/swagger-flow-tester/src/components/FlowBuilder.jsx`
  - `/Users/slogup/project/slogup-study/swagger-flow-tester/src/store.js`
- 참고 포인트:
  - `flowSteps`
  - `connections`
  - `header-config` step
  - drag/drop canvas position
  - side panel request 편집
  - response binding

MVP compiler에는 canvas 좌표, UI 상태, preset 상태를 넣지 않는다.

#### 실행 순서 계산

- 파일: `/Users/slogup/project/slogup-study/swagger-flow-tester/src/flowUtils.js`
- 참고 포인트:
  - connections 기반 실행 순서 계산
  - isolated node 정렬

MVP DSL은 `steps[]` 순서를 그대로 실행 순서로 사용한다. UI adapter 구현 시 이 로직을 참고한다.

#### Runtime request 실행

- 파일: `/Users/slogup/project/slogup-study/swagger-flow-tester/src/components/RunPage.jsx`
- 참고 포인트:
  - path parameter 치환
  - query 생성
  - body 생성
  - header 병합
  - 이전 응답 binding resolve
  - curl 생성

우리 프로젝트에서는 이 runtime 로직을 k6 JavaScript code generation으로 바꿔야 한다.

#### 환경변수 모델

- 파일:
  - `/Users/slogup/project/slogup-study/swagger-flow-tester/src/envUtils.js`
  - `/Users/slogup/project/slogup-study/swagger-flow-tester/src/components/EnvPage.jsx`
- 참고 포인트:
  - `{{API_HOST}}` 변수 치환
  - UI 환경 관리

MVP CLI에서는 실행한 현재 디렉터리의 `.env BASE_URL`만 읽고 OpenAPI 입력은 `--openapi`로 명시한다. 실제 시나리오 자산은 테스트 대상 백엔드 프로젝트에 두며, generator 저장소의 `.env`는 개발/검증용이다. 후속 멀티모듈 확장에서는 단일 모듈 기본 경로 `OPENAPI_PATH`와 module별 `OPENAPI_<MODULE>_PATH` 규칙을 사용한다.

### 그대로 가져오지 않을 것

- React component 구조
- Zustand store 전체
- Supabase persistence
- 브라우저 fetch runtime
- Vite proxy
- canvas 좌표/drag state
- UI용 import/export JSON 포맷

### 향후 UI adapter에서 재사용할 개념

```text
Flow UI Model
   ↓
Execution Order
   ↓
Scenario DSL
   ↓
Compiler
   ↓
k6 Script
```

## 5. 기능별 참조 매트릭스

| 우리 기능 | openapi-projector | swagger-flow-tester | 결정 |
| --- | --- | --- | --- |
| OpenAPI version check | 강함 | 보통 | projector 기준 |
| YAML/JSON parse | 약함 | 약함 | 새로 구현 |
| `$ref` dereference | 보통 | 보통 | swagger-parser 사용 |
| Operation registry | 강함 | 보통 | projector 기준 |
| Params metadata | 보통 | 강함 | UI 확장 시 tester 참고 |
| Example 생성 | 약함 | 강함 | MVP 후순위 |
| Response fields flatten | 약함 | 강함 | UI adapter에서 사용 |
| Auth scheme detection | 없음 | 강함 | MVP 제외, UI 후순위 |
| Flow model | 없음 | 강함 | UI 후순위 |
| Runtime execution | 없음 | 브라우저 fetch | k6 generator로 재해석 |
| Persistence | 없음 | Supabase/localStorage | MVP 제외 |

## 6. 우리 프로젝트에 반영할 결정

### D-01 OpenAPI parser

`@apidevtools/swagger-parser`로 parse/dereference를 처리한다.

이유:

- JSON/YAML 입력을 모두 다룰 수 있다.
- 외부 ref 대응 여지가 있다.
- 직접 `$ref` resolver를 유지하는 비용을 줄인다.

### D-02 API Registry

`openapi-projector`의 endpoint catalog 개념을 compiler 내부에서는 `ApiRegistry`로 축소한다.

Registry는 code generation에 필요한 최소 필드만 가진다.

대상 프로젝트 운영용 `catalog.json`은 `ApiRegistry`와 별개로 사람이 읽기 쉬운 endpoint 목록이다. 이 catalog는 method/path, operationId, tags, summary, parameters, requestBody 여부를 포함한다.

### D-03 UI metadata

`swagger-flow-tester`의 `params`, `requestExample`, `responseExample`, `response` flatten 정보는 MVP compiler 필수 필드가 아니다.

단, 후속 UI adapter를 위해 `ApiOperation`에 metadata 확장 여지를 남긴다.

### D-04 Flow model

MVP에서는 DSL `steps[]` 순서가 실행 순서다.

UI가 붙으면 `connections[]`를 먼저 선형 실행 순서로 변환한 뒤 Scenario DSL로 export한다.

### D-05 Template 문법

MVP DSL은 `{{token}}` context template만 사용한다.

`swagger-flow-tester`의 `{step1.token}` 문법은 UI adapter에서 `extract + {{token}}` 형태로 변환한다.

## 7. 후속 멀티모듈 OpenAPI 방향

멀티모듈 OpenAPI는 MVP 이후 필수 확장이다. `swagger-flow-tester`의 `modules` 개념은 그대로 가져오지 않고, compiler에서 사용할 수 있는 module registry 설정으로 정규화한다.

```text
module-config
  defaultModule: optional
  modules:
    bos:
      baseUrl: BASE_URL 또는 BASE_URL_BOS
      openapiPath: OPENAPI_BOS_PATH
    mall:
      baseUrl: BASE_URL 또는 BASE_URL_MALL
      openapiPath: OPENAPI_MALL_PATH
```

확장 규칙:

- MVP의 단일 OpenAPI registry를 `default` module registry로 간주한다.
- `--module` 옵션은 사용할 OpenAPI registry를 선택한다.
- Scenario DSL v2에서 `api.module`을 허용하면 step별 module 참조가 가능하다.
- module이 생략되면 default module을 사용해 기존 DSL과 호환한다.
- Swagger/OpenAPI URL 자동 탐색은 module 등록 시점에만 사용한다.

## 8. 후속 UI 통합 방향

UI를 붙일 때는 `swagger-flow-tester`를 그대로 합치기보다 다음 계층을 추가한다.

```text
ui-flow.adapter.ts
  input: modules, flowSteps, connections
  output: Scenario DSL
```

변환 규칙:

- API node는 Scenario step이 된다.
- connection은 실행 순서를 결정한다.
- header-config node는 이후 step의 request.headers에 병합된다.
- binding은 이전 step의 extract와 이후 step의 template으로 변환한다.
- canvas 좌표와 UI 상태는 Scenario DSL에 포함하지 않는다.

## 9. 리스크

| 리스크 | 설명 | 대응 |
| --- | --- | --- |
| UI 모델 과결합 | React/Zustand 상태를 compiler에 섞을 가능성 | UI adapter를 별도 계층으로 유지 |
| module registry 혼합 | 서로 다른 module의 operationId가 섞일 가능성 | module별 registry를 분리하고 `--module` 또는 `api.module`로 선택 |
| k6 런타임 제약 | npm JSONPath 라이브러리를 k6에서 바로 사용하기 어려움 | generated helper 또는 제한된 JSONPath compile |
| condition 의미 혼동 | check인지 branch인지 불명확 | MVP에서는 check로 고정 |
| OpenAPI validation 범위 확대 | request schema validation까지 커질 수 있음 | MVP에서는 endpoint resolve까지만 |
