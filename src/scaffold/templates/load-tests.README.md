# __DIRECTORY__

이 폴더는 백엔드 프로젝트 안에서 OpenAPI snapshot, scenario YAML, scenario test, 생성된 k6 스크립트를 관리합니다.

핵심 흐름은 OpenAPI catalog에서 API를 고르고, scenario test로 실제 API 흐름을 먼저 검증한 뒤, 통과한 scenario만 k6 부하 테스트로 넘기는 것입니다.

사람이 꼭 이해해야 하는 내용은 이 README 앞부분에 있습니다. 자세한 반복 작업 절차와 AI 작업 규칙은 아래 `AI Work Guide`를 AI에게 읽히면 됩니다.

## 사람이 꼭 알아야 하는 것

- 직접 수정하는 파일은 이 폴더의 `config.yaml`, `.env`, `scenarios/*.yaml`입니다.
- 기본 흐름은 `__CLI_COMMAND__ sync` -> scenario 작성 -> `__CLI_COMMAND__ test` -> `__CLI_COMMAND__ generate` -> `run.sh`입니다.
- `__CLI_COMMAND__ test`가 통과하기 전에는 k6 스크립트를 생성하거나 실행하지 않습니다.
- 일반적인 config/scenario 작업에서는 `README.md`, `run.sh`, `.env.example`, `.gitignore`를 수정하지 않습니다.
- `openapi/*.openapi.json`은 `__CLI_COMMAND__ sync`로 갱신합니다. 직접 고치지 않습니다.
- `generated/*.k6.js`는 `__CLI_COMMAND__ generate`로 다시 만듭니다. 직접 고치지 않습니다.
- 실제 비밀 값은 YAML에 쓰지 말고 이 폴더의 `.env`에만 둡니다. YAML에서는 `{{env.NAME}}`으로 참조합니다.

## 0. openapi-k6 실행 방식

이 README는 `__CLI_COMMAND__ init`으로 생성되었습니다. npm 배포 버전은 설치 없이 `npx`로 실행하는 것을 기본으로 합니다.

```bash
__CLI_COMMAND__ --help
```

아래 예시는 모두 `__CLI_COMMAND__` 기준입니다. 같은 버전을 반복해서 쓰고 싶으면 `npm install -D openapi-k6` 후 `pnpm exec openapi-k6 ...`처럼 프로젝트 devDependency로 고정해도 됩니다.

## 생성된 구조

```text
__DIRECTORY__/
├── README.md
├── config.yaml
├── .env.example
├── .env          # 필요 시 직접 생성, git commit 금지
├── .gitignore
├── run.sh
├── openapi/
│   ├── __MODULE_NAME__.openapi.json
│   └── __MODULE_NAME__.catalog.json
├── scenarios/
│   └── smoke.yaml
├── fixtures/     # 파일 업로드 fixture가 필요할 때 직접 생성
└── generated/
    └── smoke.k6.js
```

## 빠른 시작

처음에는 아래 순서만 따라가면 됩니다.

```bash
# 1. config.yaml의 TODO 값을 먼저 채웁니다.
# 2. OpenAPI snapshot/catalog를 만듭니다.
__SYNC_COMMAND__

# 3. scenario YAML을 수정한 뒤 실제 API 흐름을 검증합니다.
__TEST_SMOKE_COMMAND__

# 4. 검증을 통과한 scenario만 k6로 생성하고 실행합니다.
__GENERATE_SMOKE_COMMAND__
__RUN_SMOKE_LOG_COMMAND__
```

`__CLI_COMMAND__ test`는 보조 확인이 아니라 k6 부하 테스트 전 gate입니다. `run.sh`는 이 gate를 통과한 scenario로 생성한 k6 스크립트를 실행합니다.

## 1. 최소 설정

`config.yaml`의 `TODO` 값을 실제 테스트 대상 값으로 바꿉니다.

```yaml
baseUrl: https://api.example.com
defaultModule: __MODULE_NAME__

modules:
  __MODULE_NAME__:
    openapi: https://api.example.com/v3/api-docs
    snapshot: openapi/__MODULE_NAME__.openapi.json
    catalog: openapi/__MODULE_NAME__.catalog.json
```

- `baseUrl`: 생성된 k6 스크립트가 호출할 API base URL 기본값
- `openapi`: `sync`가 읽을 OpenAPI URL 또는 파일 경로
- `snapshot`: `sync`가 저장하고 `generate`가 읽을 OpenAPI snapshot
- `catalog`: scenario 작성 시 참고할 endpoint 목록

외부 파일이나 URL을 가리키는 `$ref`는 snapshot 내부 참조로 묶어 저장하므로, 이후 `generate`는 원격 원본 없이 snapshot 파일만으로 실행할 수 있습니다.

## 2. OpenAPI -> Scenario Test -> k6 흐름

아래 순서대로 진행합니다. 각 단계의 생성/갱신 파일은 오른쪽에 표시했습니다.

| 순서 | 사용자가 준비하는 것 | 실행 명령 | 생성/갱신되는 것 |
| --- | --- | --- | --- |
| 1 | `config.yaml`의 `baseUrl`, `modules.__MODULE_NAME__.openapi` TODO 채우기 | - | - |
| 2 | - | `__SYNC_COMMAND__` | `__SNAPSHOT_PATH__`, `__CATALOG_PATH__` |
| 3 | `__CATALOG_PATH__`를 보고 scenario 작성/수정 | - | `__SCENARIO_TEMPLATE_PATH__` |
| 4 | `{{env.NAME}}`을 쓰는 경우 `__ENV_PATH__` 작성 | `__TEST_NAME_COMMAND__` | scenario test 결과, step별 API 검증 결과 |
| 5 | scenario test 통과 확인 | `__GENERATE_NAME_COMMAND__` | `__OUTPUT_TEMPLATE_PATH__` |
| 6 | 생성된 k6 스크립트 확인 | `__RUN_SCRIPT_ARG__ <name> --log` | k6 부하 테스트 실행, `__DIRECTORY__/logs/<name>.log` |

아래 예시는 scaffold가 생성한 `smoke` scenario 기준입니다.

### 2-1. OpenAPI snapshot/catalog 생성

```bash
__SYNC_COMMAND__
```

생성/갱신: `__SNAPSHOT_PATH__`, `__CATALOG_PATH__`

### 2-2. Scenario YAML 작성

`__CATALOG_PATH__`에서 테스트할 endpoint의 `operationId`, `method`, `path`, `parameters`, `hasRequestBody`, `requestBodyContentTypes`를 확인합니다.

기본 smoke 테스트는 `__SCENARIO_PATH__`를 수정합니다. 새 테스트는 `__SCENARIO_TEMPLATE_PATH__` 파일을 만듭니다.

생성/수정: scenario YAML

### 2-3. Scenario 검증

`__CLI_COMMAND__ test`는 k6 파일을 만들지 않고 scenario YAML을 Node.js에서 1회 직접 실행합니다.
부하를 걸기 전에 API 흐름 자체가 맞는지 확인하는 gate입니다.
step 실행 중 URL, Running 상태, status, condition, extract 결과를 바로 확인한 뒤 통과한 scenario만 k6 스크립트로 생성합니다.

```bash
__TEST_SMOKE_COMMAND__
```

`-s`는 `--scenario`의 줄임말입니다. `smoke`처럼 이름만 쓰면 `__DIRECTORY__/scenarios/smoke.yaml`을 찾습니다.

이 명령은 다음을 확인합니다.

- OpenAPI snapshot 기준으로 scenario의 API를 찾을 수 있는지
- `pathParams`, `query`, `headers`, `body`, `multipart`가 실제 요청으로 구성되는지
- `{{env.NAME}}`, `{{token}}` 같은 template 값이 해석되는지
- `condition`이 통과하는지
- `extract`가 응답 JSON에서 값을 읽을 수 있는지

실행 전에 필요합니다.

- `__CLI_COMMAND__ sync`가 먼저 실행되어 snapshot이 있어야 합니다.
- 대상 백엔드 서버가 떠 있어야 합니다.
- 비밀 값이 필요하면 `__ENV_PATH__`를 만들어야 합니다.
- multipart 파일 업로드는 `__FIXTURES_PATH__` 아래 파일이 실제로 있어야 합니다.

예상 출력:

```text
     scenario: smoke
     base url: http://localhost:8080
        steps: 1

     [1/1] health
       request: GET /health
           url: http://localhost:8080/health
         state: → running
        status: ✓ 200 OK  12ms
        result: ✓ PASS
        checks: ✓ status == 200

      summary: ✓ PASS
        steps: 1/1 passed
     duration: 12ms
```

실패하면 마지막 `summary`가 `✗ FAIL`이 되고, 실패한 step 아래에 status, error, response body 일부를 바로 보여줍니다. 비밀 값은 출력에서 마스킹됩니다.
`condition`이 없는 step도 HTTP 4xx/5xx 응답은 실패로 처리합니다. 오류 응답을 기대하는 scenario는 `condition: status == 404`처럼 기대 status를 명시합니다.
터미널에서 직접 실행하면 API 응답을 기다리는 동안 `state` 줄에 경과 시간이 갱신됩니다. CI나 파일 로그에서는 한 줄 로그만 남깁니다.
색상은 터미널에서만 켜지며 `--no-color` 옵션이나 `NO_COLOR=1` 환경변수로 끌 수 있습니다.

`__ENV_PATH__`가 있으면 `{{env.NAME}}` template 값과 `BASE_URL`을 읽습니다. 현재 shell 환경변수가 같은 이름으로 있으면 shell 값이 우선합니다.

### 2-4. k6 스크립트 생성

```bash
__GENERATE_SMOKE_COMMAND__
```

생성/갱신: `__OUTPUT_PATH__`

### 2-5. k6 실행

```bash
__RUN_SMOKE_COMMAND__
```

`run.sh`는 자신과 같은 폴더의 `.env`(`__ENV_PATH__`)만 자동으로 로드한 뒤 `generated/<scenario>.k6.js`를 실행합니다.
백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다.
빠른 사용법은 `run.sh --help`로 확인할 수 있습니다.

k6 옵션을 넘길 때는 scenario 이름 뒤에 붙입니다.

```bash
__RUN_SMOKE_ITERATIONS_COMMAND__
```

콘솔 출력과 실패 응답 로그를 파일로 남기려면 `--log`를 붙입니다.

```bash
__RUN_SMOKE_LOG_COMMAND__
```

로그 파일: `__LOG_PATH__`

`run.sh`가 제공하는 편의 플래그입니다.

- `--log`: 콘솔 출력과 실패 응답 로그를 `logs/<scenario>.log`에 저장
- `--trace`: 각 scenario step의 시작/종료 로그 출력
- `--report`: k6 Web Dashboard HTML report를 `logs/<scenario>-report.html`에 저장
- `--open-dashboard`: 실행 중인 k6 Web Dashboard를 브라우저로 열기

k6 기본 Web Dashboard는 테스트가 끝나면 같이 종료됩니다. 짧은 smoke 테스트는 HTML report로 남기는 방식을 권장합니다.

```bash
__RUN_SMOKE_REPORT_COMMAND__
```

HTML report: `__REPORT_PATH__`

각 scenario step의 시작/종료 로그까지 남기려면 `--trace`와 `--log`를 함께 사용합니다.

```bash
__RUN_SMOKE_TRACE_REPORT_COMMAND__
```

API base URL은 `__CLI_COMMAND__ generate` 실행 시점의 `config.yaml` `baseUrl` 값이 생성된 k6 스크립트에 기본값으로 들어갑니다.
`config.yaml`을 수정한 뒤에는 스크립트를 다시 생성해야 반영됩니다.
실행 시점에 `BASE_URL` 환경 변수를 넘기면 스크립트에 들어간 기본값보다 우선합니다.

```bash
__BASE_URL_RUN_COMMAND__
```

## 3. 비밀 값 사용

시나리오에서 `{{env.NAME}}`을 사용한다면 `__DIRECTORY__/.env.example`을 `__ENV_PATH__`로 복사한 뒤 비밀 값을 채웁니다.

```bash
__ENV_COPY_COMMAND__
__TEST_SMOKE_COMMAND__
__RUN_SMOKE_COMMAND__
```

`__CLI_COMMAND__ test`와 `run.sh`가 `__ENV_PATH__`를 읽습니다. 이 파일은 `run.sh`와 같은 폴더에 있어야 합니다.
백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다. 루트 `.env` 값을 쓰려면 필요한 키만 이 파일로 복사하거나, 실행 전에 shell에서 직접 export합니다.
`__DIRECTORY__/.gitignore`가 `.env`를 무시하므로 실제 값은 commit하지 않습니다.

## Scenario 작성법

Scenario YAML은 `__DIRECTORY__/scenarios/*.yaml`에 작성합니다.
먼저 `__CATALOG_PATH__`에서 테스트할 endpoint의 `operationId`, `method`, `path`, `parameters`, `hasRequestBody`, `requestBodyContentTypes`를 확인합니다.

자주 쓰는 request 필드입니다.

- `headers`: 인증 토큰 등 HTTP header
- `query`: query string
- `pathParams`: `/orders/{orderId}` 같은 path template 값
- `body`: JSON request body
- `multipart`: multipart/form-data 파일 업로드

JSON body 예시:

```yaml
name: login-flow

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
```

파일 업로드 예시:

```yaml
name: upload-product-image

steps:
  - id: upload-image
    api:
      operationId: uploadProductImage
    request:
      pathParams:
        productId: "product-001"
      multipart:
        fields:
          title: Main image
        files:
          image:
            path: fixtures/product.png
            filename: product.png
            contentType: image/png
    condition: status == 200
```

파일 경로는 `__DIRECTORY__/` 기준입니다. 업로드 fixture는 기본적으로 `__FIXTURES_PATH__` 아래에 둡니다.
Spring의 `@PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)` endpoint는 `request.multipart`로 작성합니다.
fixture 파일은 반복 테스트에 안전하고 유용할 때만 commit합니다.

새 시나리오 검증:

```bash
__TEST_WORKFLOW_COMMAND__
```

새 시나리오 k6 스크립트 생성:

```bash
__GENERATE_WORKFLOW_COMMAND__
```

생성 파일: `__WORKFLOW_OUTPUT_PATH__`

## 4. 자주 하는 수정

- endpoint 변경: `scenarios/smoke.yaml`의 `api.path`
- header/body/query/multipart 추가: `scenarios/*.yaml`의 `request`
- 대상 API 변경: `config.yaml`의 `baseUrl`, `modules.<name>.openapi` 수정 후 `__CLI_COMMAND__ sync`와 `__CLI_COMMAND__ generate` 재실행
- module 추가: `config.yaml`의 `modules` 항목 추가 후 `__CLI_COMMAND__ sync --module <name>`

## 5. 제거 방법

`init --force`는 scaffold 관리 파일만 다시 씁니다. `.env`, `openapi/`, `generated/`, `logs/`, 추가 scenario 파일은 지우지 않습니다.

이 scaffold를 제거하려면 대상 프로젝트 루트에서 `__DIRECTORY__/` 폴더를 삭제합니다.

삭제 전에 현재 위치와 삭제 대상을 확인합니다.

```bash
pwd
ls __DIRECTORY_SHELL_ARG__
rm -rf __DIRECTORY_SHELL_ARG__
```

주의: 이 명령은 `__DIRECTORY__/config.yaml`, `__DIRECTORY__/.env.example`, `__DIRECTORY__/.gitignore`, `__DIRECTORY__/run.sh`, `__DIRECTORY__/scenarios/`, `__DIRECTORY__/openapi/`, `__DIRECTORY__/generated/`를 모두 삭제합니다.
필요한 scenario, snapshot, catalog가 있으면 먼저 백업합니다.

## AI Work Guide

<details>
<summary>AI 작업 규칙 보기</summary>

This section is for AI agents. Human users only need the Korean sections above unless they want implementation details.

### Workflow

1. Read this README before editing files.
2. Check whether `TODO` values remain in `config.yaml`.
3. If `TODO` values exist, fill `baseUrl` and `modules.<name>.openapi` with project-specific values.
4. Run `__CLI_COMMAND__ sync` to create the OpenAPI snapshot and endpoint catalog.
5. Read `openapi/*.catalog.json` and inspect `operationId`, `method`, `path`, `parameters`, `hasRequestBody`, and `requestBodyContentTypes` for target endpoints.
6. Update or create `scenarios/*.yaml`.
7. For scenarios that need secrets, copy `__DIRECTORY__/.env.example` to `__ENV_PATH__` and fill local values.
8. Run `__CLI_COMMAND__ test` to validate the scenario API flow before generating k6.
9. Do not generate or run k6 until `__CLI_COMMAND__ test` passes.
10. Run `__CLI_COMMAND__ generate` to regenerate the k6 script.
11. Run the generated script with `__RUN_SCRIPT_ARG__ <scenario>` or the directory-specific run command shown above.

### Rules

- Keep human-facing documentation in Korean.
- Keep AI-only instructions in English.
- Do not edit scaffold-managed files during ordinary backend test work: `README.md`, `run.sh`, `.env.example`, `.gitignore`.
- If scaffold docs or helper scripts must change, update the generator template in openapi-k6-runner and rerun `__CLI_COMMAND__ init --force` intentionally.
- Do not edit `generated/*.k6.js` directly. Edit scenario YAML and regenerate.
- Do not edit `openapi/*.openapi.json` directly. Refresh snapshots with `sync`.
- `catalog.json` is for humans and AI agents. The generator reads the snapshot OpenAPI file, not the catalog.
- For authenticated APIs, define header templates under `scenarios/*.yaml` `request.headers`.
- Do not write secrets such as passwords directly in YAML. Use `{{env.NAME}}`.
- Store real secret values in `__ENV_PATH__` and do not commit it. Keep placeholders only in `__DIRECTORY__/.env.example`.
- Do not use `request.body` and `request.multipart` in the same step.
- `condition` compiles to a k6 `check`; it is not a branch. Later steps still run even if a check fails.
- `pathParams` values are encoded as URL path segments.
- Resolve config-relative paths from the directory containing `config.yaml`.
- Multipart file paths are relative to `__DIRECTORY__/`. Put local upload fixtures under `__FIXTURES_PATH__` by default.
- Commit fixture files only when they are safe and useful for repeatable tests; otherwise keep project-local files out of git according to the backend project policy.
- Spring endpoints such as `@PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)` should be modeled with `request.multipart`.
- k6 multipart references: https://grafana.com/docs/k6/latest/examples/data-uploads/, https://grafana.com/docs/k6/latest/javascript-api/k6-http/file/, https://grafana.com/docs/k6/latest/javascript-api/init-context/open/.

### Scenario DSL Reference

Endpoint selection:

1. Prefer `api.operationId` when the catalog has a stable operationId.
2. Use `api.method` and `api.path` when operationId is missing or unclear.
3. Add `request.pathParams` for OpenAPI path templates such as `/orders/{orderId}`.
4. Use `extract` to save response values into shared context.
5. Reference extracted values with `{{variableName}}` in later steps.

Supported request fields:

- `headers`: HTTP headers
- `query`: query string
- `pathParams`: values for OpenAPI path template placeholders
- `body`: JSON request body
- `multipart`: multipart/form-data request body for file uploads

Supported templates:

- `{{variableName}}`: value extracted into context by a previous step
- `{{env.NAME}}`: runtime environment variable exported before k6 execution

Supported conditions:

- `status == 200`
- `status != 500`
- `status >= 200`
- `status < 300`

OperationId-based example:

```yaml
name: login-flow

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

  - id: get-me
    api:
      operationId: getMe
    request:
      headers:
        Authorization: "Bearer {{token}}"
    condition: status < 300
```

Method-and-path example:

```yaml
name: order-read

steps:
  - id: get-order
    api:
      method: GET
      path: /orders/{orderId}
    request:
      pathParams:
        orderId: "123"
      query:
        includeItems: true
    condition: status == 200
```

Multipart upload example:

```yaml
name: upload-product-image

steps:
  - id: upload-image
    api:
      operationId: uploadProductImage
    request:
      pathParams:
        productId: "product-001"
      multipart:
        fields:
          title: Main image
        files:
          image:
            path: fixtures/product.png
            filename: product.png
            contentType: image/png
    condition: status == 200
```

### Files to inspect

- `__CONFIG_PATH__`: base URL, OpenAPI URL, snapshot/catalog paths
- `__DIRECTORY__/.env.example`: example file for `__ENV_PATH__` secret values
- `__RUN_SCRIPT_PATH__`: k6 runner that auto-loads `__ENV_PATH__` values
- `__CATALOG_PATH__`: endpoint catalog
- `__SCENARIO_PATH__`: scenario DSL
- `__OUTPUT_PATH__`: generated k6 script

### Prompt Examples

Basic smoke test:

```text
Read __DIRECTORY__/README.md first and follow it.
Fill TODO values in __CONFIG_PATH__ for this project.
Run the OpenAPI snapshot command from this README to create the catalog.
Read __DIRECTORY__/openapi/*.catalog.json and choose one unauthenticated GET endpoint.
Update __SCENARIO_PATH__ for that endpoint.
Run the scenario validation command from this README before generating k6.
Do not generate or run k6 until the scenario validation passes.
Run the k6 script generation command from this README.
Do not edit __DIRECTORY__/README.md, __RUN_SCRIPT_PATH__, __DIRECTORY__/.env.example, or __DIRECTORY__/.gitignore unless explicitly asked to change scaffold files.
Do not edit __DIRECTORY__/generated/*.k6.js or __DIRECTORY__/openapi/*.openapi.json directly.
Keep human-facing documentation in Korean. Keep AI instruction sections in English.
```

New scenario:

```text
Read __DIRECTORY__/README.md and __DIRECTORY__/openapi/*.catalog.json.
Choose one read endpoint that can be called without login.
Create __DIRECTORY__/scenarios/basic-read.yaml.
Validate the scenario using the command documented in this README.
Do not generate or run k6 until the scenario validation passes.
Then generate the k6 script using the new scenario generation command in this README.
Do not edit __DIRECTORY__/README.md, __RUN_SCRIPT_PATH__, __DIRECTORY__/.env.example, or __DIRECTORY__/.gitignore unless explicitly asked to change scaffold files.
Do not edit __DIRECTORY__/generated/*.k6.js directly.
Keep human-facing documentation in Korean. Keep AI instruction sections in English.
```

Authenticated flow:

```text
Read __DIRECTORY__/README.md and __DIRECTORY__/openapi/*.catalog.json.
Find the login API and a user-profile/read API.
Create a login-flow scenario.
Extract token from the login response.
Use Bearer {{token}} in the Authorization header of the next step.
Use {{env.NAME}} for secrets and keep real values in __ENV_PATH__ only.
Validate the scenario using the command documented in this README.
Do not generate or run k6 until the scenario validation passes.
Then generate the k6 script using the new scenario generation command in this README.
Do not edit __DIRECTORY__/README.md, __RUN_SCRIPT_PATH__, __DIRECTORY__/.env.example, or __DIRECTORY__/.gitignore unless explicitly asked to change scaffold files.
Keep human-facing documentation in Korean. Keep AI instruction sections in English.
```

</details>
