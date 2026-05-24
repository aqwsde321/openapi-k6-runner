# __DIRECTORY__

이 폴더는 백엔드 프로젝트 안에서 OpenAPI snapshot, scenario YAML, scenario validate/test, 생성된 k6 스크립트를 관리합니다.

핵심 흐름은 OpenAPI catalog에서 API를 고르고, `validate`로 YAML/OpenAPI 정합성을 먼저 확인한 뒤, scenario test를 통과한 scenario만 k6 부하 테스트로 넘기는 것입니다.

사람은 빠른 시작을 먼저 보면 됩니다. AI coding agent는 아래 프롬프트와 접힌 상세 지침까지 읽고 작업합니다.

## AI에게 작업 맡기기

AI coding agent에게 아래 프롬프트를 그대로 붙여넣으면 됩니다.

```text
이 백엔드 프로젝트에 openapi-k6 시나리오 테스트와 k6 부하 테스트 준비를 적용해줘.

1. 먼저 __DIRECTORY__/README.md를 읽어.
2. 아래 명령은 백엔드 프로젝트 루트에서 실행해.
3. __CONFIG_PATH__에 TODO가 남아 있으면 이 백엔드 프로젝트에 맞게 채워.
4. __SYNC_COMMAND__를 실행해서 OpenAPI snapshot과 catalog를 만들어.
5. __CATALOG_QUERY_COMMAND__ 명령으로 테스트할 endpoint 후보를 확인해. 필요하면 __CATALOG_PATH__도 열어봐.
6. 내가 원하는 API 흐름을 확인한 뒤 __DIRECTORY__/scenarios/*.yaml을 작성하거나 수정해.
7. __VALIDATE_NAME_COMMAND__ 형식으로 YAML/OpenAPI 정합성을 먼저 확인해.
8. __TEST_NAME_COMMAND__ 형식으로 실제 API 흐름을 검증해.
9. scenario test가 통과하기 전에는 k6 script를 생성하거나 실행하지 마.
10. 통과한 scenario만 __RUN_NAME_COMMAND__ --log 형식으로 짧게 실행해.
11. 스크립트만 필요하면 __GENERATE_NAME_COMMAND__ 형식으로 k6 script를 생성해.
12. 장시간 부하 테스트는 내가 요청하기 전에는 실행하지 말고, 실행 명령과 예상 확인 포인트를 알려줘.

__DIRECTORY__/README.md, __RUN_SCRIPT_PATH__, __DIRECTORY__/.env.example, __DIRECTORY__/.gitignore, __DIRECTORY__/.openapi-k6.json은 scaffold 파일이므로 명시 요청이 없으면 수정하지 마.
__SNAPSHOT_PATH__과 __DIRECTORY__/generated/*.k6.js도 직접 수정하지 말고 sync/generate로 다시 만들어.
비밀 값은 scenario YAML에 직접 쓰지 말고 {{env.NAME}}으로 참조해. 실제 값은 __ENV_PATH__에만 둬.
```

사람은 아래 빠른 시작만 따라가면 됩니다. 세부 규칙과 예시는 접힌 상세 섹션에 있습니다.

## 사람이 직접 실행할 때

아래는 사람이 직접 명령을 실행할 때 보는 요약입니다. AI에게 맡기는 경우에는 위 프롬프트를 사용하세요.

### 꼭 알아야 하는 것

- 명령은 백엔드 프로젝트 루트에서 실행합니다.
- 직접 수정하는 파일은 `config.yaml`, `.env`, `scenarios/*.yaml`입니다.
- 기본 `.gitignore`는 `scenarios/**`만 git 추적 대상에 남기고 scaffold/config/생성물은 제외합니다.
- 생성물은 직접 고치지 않습니다. OpenAPI snapshot은 `sync`, `generated/*.k6.js`는 `generate`로 다시 만듭니다.
- `__CLI_COMMAND__ validate`로 YAML/OpenAPI 정합성을 확인하고, `__CLI_COMMAND__ test`가 통과한 scenario만 `run`하거나 `generate`/`run.sh`로 실행합니다.
- 비밀 값은 YAML에 쓰지 말고 `.env`에 둔 뒤 `{{env.NAME}}`으로 참조합니다.

### 빠른 시작

처음에는 아래 순서만 따라가면 됩니다. 모든 명령은 백엔드 프로젝트 루트에서 실행합니다.

1. `__CONFIG_PATH__`에 TODO가 남아 있으면 먼저 채웁니다.

2. OpenAPI snapshot/catalog를 만듭니다.

   ```bash
   __SYNC_COMMAND__
   ```

3. scenario에 쓸 endpoint 후보를 검색합니다.

   ```bash
   __CATALOG_QUERY_COMMAND__
   ```

   `login`은 원하는 검색어로 바꿔 실행합니다.

4. `__SCENARIO_PATH__`를 수정한 뒤 YAML/OpenAPI 정합성을 확인합니다.

   ```bash
   __VALIDATE_SMOKE_COMMAND__
   ```

5. 실제 API 흐름을 검증합니다.

   ```bash
   __TEST_SMOKE_COMMAND__
   ```

6. 검증을 통과한 scenario만 k6로 생성하고 실행합니다.

   ```bash
   __RUN_SMOKE_CLI_LOG_COMMAND__
   ```

다음 단계로 넘어가는 기준은 간단합니다. `__CLI_COMMAND__ validate`와 `__CLI_COMMAND__ test`가 통과한 scenario만 generate/run 합니다.

<details>
<summary>상세 사용 가이드 보기</summary>

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
├── .openapi-k6.json
├── .gitignore
├── run.sh
├── __SNAPSHOT_CONFIG_VALUE__
├── __CATALOG_CONFIG_VALUE__
├── scenarios/
│   ├── smoke.yaml
│   ├── partials/login.yaml.example
│   └── fixtures/dev.yaml.example
├── fixtures/     # 파일 업로드 fixture가 필요할 때 직접 생성
└── generated/
    └── smoke.k6.js
```

## 1. 최소 설정

대화형 `init`은 `baseUrl`만 입력받고 `<baseUrl>/v3/api-docs`를 먼저 확인합니다.
실패하면 `/api-docs`, `/openapi.json`, `/swagger.json`, `/swagger/v1/swagger.json` 같은 흔한 OpenAPI 경로를 자동으로 시도합니다.
그래도 찾지 못할 때만 OpenAPI spec URL 또는 파일 경로를 따로 묻습니다.

OpenAPI URL을 찾았으면 `config.yaml`의 `baseUrl`과 `openapi`가 이미 채워져 있습니다.
자동 탐색이 실패하면 CLI 안내에 따라 직접 URL/파일 경로를 입력하거나 `skip`으로 넘어간 뒤 config를 나중에 수정할 수 있습니다.

```yaml
baseUrl: https://api.example.com
defaultModule: __MODULE_NAME__

modules:
  __MODULE_NAME__:
    openapi: https://api.example.com/v3/api-docs
    snapshot: __SNAPSHOT_CONFIG_VALUE__
    catalog: __CATALOG_CONFIG_VALUE__
```

- `baseUrl`: 생성된 k6 스크립트가 호출할 API base URL 기본값
- `openapi`: `sync`가 읽을 OpenAPI URL 또는 파일 경로. 상대 경로는 `config.yaml` 위치 기준입니다.
- `snapshot`: `sync`가 저장하고 `generate`가 읽을 OpenAPI snapshot
- `catalog`: scenario 작성 시 참고할 endpoint 목록

여러 module을 하나의 scenario에서 섞어야 하면 step마다 `api.module`을 지정합니다.

인증 서버와 업무 서버처럼 Swagger/OpenAPI 주소가 서로 다른 백엔드를 하나의 scenario에서 이어야 할 때도 같은 방식입니다. 새 module은 `config.yaml`을 직접 편집하지 않고 CLI로 추가할 수 있습니다.

```bash
__CLI_COMMAND__ module add auth --base-url https://auth-api.example.com --sync
__CLI_COMMAND__ module add bos --base-url https://bos-api.example.com --sync
__CLI_COMMAND__ module list
__CLI_COMMAND__ module set-default auth
__CLI_COMMAND__ module remove auth
```

`--openapi`를 생략하면 `--base-url` 기준으로 `/v3/api-docs`, `/api-docs`, `/openapi.json` 같은 흔한 경로를 자동 탐색합니다. 사내 Swagger 경로가 다르면 `--openapi <url-or-path>`를 명시하면 됩니다.

`module remove`는 config 항목만 제거하고 snapshot/catalog 파일은 삭제하지 않습니다. 현재 `defaultModule`이거나 scenario에서 참조 중인 module은 기본적으로 삭제를 막고, 의도한 경우에만 `--force`로 제거합니다.

자동화나 UI adapter가 현재 module 구성을 읽어야 하면 `--json`을 사용합니다.

```bash
__CLI_COMMAND__ module list --json
```

출력에는 `configPath`, `defaultModule`, `modules[]`가 포함되고, 각 module은 `name`, `isDefault`, `baseUrl`, `openapi`, `snapshot`, `catalog` 필드를 가집니다.

```yaml
steps:
  - id: login
    api:
      module: auth
      operationId: loginUser
    extract:
      token:
        from: $.token

  - id: create-order
    api:
      module: bos
      operationId: createOrder
    request:
      headers:
        Authorization: "Bearer {{token}}"
```

`api.module`이 없는 step은 기존처럼 `--module`, `defaultModule`, 단일 module 추론 순서로 module을 선택합니다.
같은 `operationId`가 여러 module에 있어도 step의 `api.module` 안에서만 찾습니다.

외부 파일이나 URL을 가리키는 `$ref`는 snapshot 내부 참조로 묶어 저장하므로, 이후 `generate`는 원격 원본 없이 snapshot 파일만으로 실행할 수 있습니다.

## 2. OpenAPI -> Scenario Validate -> Scenario Test -> k6 흐름

빠른 시작의 같은 흐름을 파일 기준으로 풀어쓴 표입니다. 각 단계의 생성/갱신 파일은 오른쪽에 표시했습니다.

| 순서 | 사용자가 준비하는 것 | 실행 명령 | 생성/갱신되는 것 |
| --- | --- | --- | --- |
| 1 | `config.yaml`의 `baseUrl`, `modules.__MODULE_NAME__.openapi` 확인 또는 TODO 채우기 | - | - |
| 2 | - | `__SYNC_COMMAND__` | `__SNAPSHOT_PATH__`, `__CATALOG_PATH__` |
| 3 | catalog에서 endpoint 후보 검색 후 scenario 작성/수정 | `__CATALOG_QUERY_COMMAND__` | `__SCENARIO_TEMPLATE_PATH__` |
| 4 | `{{env.NAME}}`을 쓰는 경우 `__ENV_PATH__` 작성 | `__VALIDATE_NAME_COMMAND__` | scenario YAML/OpenAPI 정합성 검증 결과 |
| 5 | scenario validate 통과 확인 | `__TEST_NAME_COMMAND__` | scenario test 결과, step별 API 검증 결과 |
| 6 | scenario test 통과 확인 | `__RUN_NAME_COMMAND__ --log` | validate/generate/k6 실행, `__OUTPUT_TEMPLATE_PATH__`, `__DIRECTORY__/logs/<name>.log` |
| 7 | 스크립트만 따로 생성하거나 runner로 실행 | `__GENERATE_NAME_COMMAND__`, `__RUN_SCRIPT_ARG__ <name> --log` | `__OUTPUT_TEMPLATE_PATH__`, k6 부하 테스트 실행 |

아래 예시는 scaffold가 생성한 `smoke` scenario 기준입니다.

### 2-1. OpenAPI snapshot/catalog 생성

```bash
__SYNC_COMMAND__
```

생성/갱신: `__SNAPSHOT_PATH__`, `__CATALOG_PATH__`

### 2-2. Scenario YAML 작성

`catalog` 명령으로 테스트할 endpoint의 `operationId`, `method`, `path`, `parameters`, `hasRequestBody`, `requestBodyContentTypes`를 확인합니다.

```bash
__CATALOG_QUERY_COMMAND__
```

`login`은 원하는 검색어로 바꿔 실행합니다.
전체 catalog 파일은 `__CATALOG_PATH__`에 있습니다.

기본 smoke 테스트는 `__SCENARIO_PATH__`를 수정합니다. 새 테스트는 `__SCENARIO_TEMPLATE_PATH__` 파일을 만듭니다.

SKU, tenant, page size 같은 테스트 데이터는 entry scenario의 `vars:`에 두고 `{{vars.NAME}}`으로 참조합니다. 환경별 데이터가 많으면 entry scenario의 `fixtures:`에 YAML fixture를 추가합니다. fixture 경로는 entry scenario 파일 기준 상대 경로이며, fixture 값은 먼저 로드되고 scenario의 `vars:`가 같은 이름을 덮어씁니다. 반복되는 로그인, seed, cleanup 흐름은 별도 YAML로 분리한 뒤 scenario의 원하는 위치에서 include할 수 있습니다. include 경로도 entry scenario 파일 기준 상대 경로이며, entry scenario 디렉터리 안에 있어야 합니다.

```yaml
name: order-flow

fixtures:
  - ./fixtures/dev.yaml

vars:
  sku: ABC-001

steps:
  - include: ./partials/login.yaml
  - id: create-order
    api:
      operationId: createOrder
    request:
      headers:
        Authorization: "Bearer {{token}}"
      body:
        sku: "{{vars.sku}}"
```

`partials/login.yaml`은 `name` 없이 `steps`만 둘 수 있고, 포함된 step의 `extract` 값은 뒤 step에서 그대로 참조할 수 있습니다. `fixtures/dev.yaml`은 `loginId: tester@example.com`처럼 변수 이름을 key로 두는 YAML object입니다.
`init`은 `__DIRECTORY__/scenarios/partials/login.yaml.example`과 `__DIRECTORY__/scenarios/fixtures/dev.yaml.example`도 함께 생성합니다. 실제 endpoint/데이터에 맞게 수정한 뒤 `.example`을 제거해 사용하세요.

생성/수정: scenario YAML

### 2-3. Scenario 정적 검증

`__CLI_COMMAND__ validate`는 백엔드에 요청하지 않고 scenario YAML을 OpenAPI snapshot과 대조합니다.
AI가 작성한 YAML은 먼저 이 명령으로 `operationId`, `method/path`, 필수 path/query/header/body 누락, `{{token}}` 같은 context template 참조, `condition`, `extract.from` 문법을 확인합니다.

```bash
__VALIDATE_SMOKE_COMMAND__
```

`-s`는 `--scenario`의 줄임말입니다. `smoke`처럼 이름만 쓰면 `__DIRECTORY__/scenarios/smoke.yaml`을 찾습니다.

이 명령은 다음을 확인합니다.

- OpenAPI snapshot 기준으로 scenario의 API를 찾을 수 있는지
- `/orders/{orderId}` 같은 path template에 필요한 `request.pathParams`가 있는지
- OpenAPI에서 required로 표시한 query/header parameter가 있는지
- required request body가 있는 endpoint에 `request.body` 또는 `request.multipart`가 있는지
- `{{token}}` 같은 context template 값이 이전 step의 `extract`에서 나온 값인지
- `condition` 표현식과 `extract.from` JSONPath가 지원 범위 안에 있는지

### 2-4. Scenario 실행 검증

`__CLI_COMMAND__ test`는 scenario YAML을 Node.js에서 1회 실행해 URL, status, condition, extract를 확인합니다.
k6 스크립트 생성 전 gate입니다.

```bash
__TEST_SMOKE_COMMAND__
```

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
`condition`은 분기 조건이 아니라 검증식입니다. k6 생성 시 `check`로 들어가며 다음 step 실행을 막는 용도로 쓰지 않습니다.
터미널에서 직접 실행하면 API 응답을 기다리는 동안 `state` 줄에 경과 시간이 갱신됩니다. CI나 파일 로그에서는 한 줄 로그만 남깁니다.
색상은 터미널에서만 켜지며 `--no-color` 옵션이나 `NO_COLOR=1` 환경변수로 끌 수 있습니다.

`__ENV_PATH__`가 있으면 `{{env.NAME}}` template 값과 `BASE_URL`을 읽습니다. 현재 shell 환경변수가 같은 이름으로 있으면 shell 값이 우선합니다.
`{{env.NAME}}`으로 참조한 값은 scenario test 출력과 생성된 k6 실패 로그에서 masking됩니다.

### 2-5. CLI에서 k6 실행

`__CLI_COMMAND__ run`은 scenario를 정적 검증하고, k6 스크립트를 다시 생성한 뒤 `k6 run`을 실행합니다.
k6 옵션은 `--` 뒤에 붙입니다.

```bash
__RUN_SMOKE_CLI_COMMAND__
__RUN_SMOKE_CLI_ITERATIONS_COMMAND__
```

콘솔 출력과 실패 응답 로그를 파일로 남기려면 `--log`를 붙입니다.

```bash
__RUN_SMOKE_CLI_LOG_COMMAND__
```

`run`이 제공하는 편의 플래그입니다.

- `--log`: 콘솔 출력과 실패 응답 로그를 `logs/<scenario>.log`에 저장
- `--trace`: 각 scenario step의 시작/종료 로그 출력
- `--report`: k6 Web Dashboard HTML report를 `logs/<scenario>-report.html`에 저장
- `--open-dashboard`: 실행 중인 k6 Web Dashboard를 브라우저로 열기

```bash
__RUN_SMOKE_CLI_REPORT_COMMAND__
__RUN_SMOKE_CLI_TRACE_REPORT_COMMAND__
```

### 2-6. k6 스크립트만 생성

```bash
__GENERATE_SMOKE_COMMAND__
```

생성/갱신: `__OUTPUT_PATH__`

### 2-7. run.sh로 생성된 k6 실행

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
multi-module scenario는 `BASE_URL_<MODULE>` 환경 변수를 먼저 읽습니다. 예를 들어 `auth`는 `BASE_URL_AUTH`, `bos-api`는 `BASE_URL_BOS_API`를 사용하고, 없으면 기존 `BASE_URL`과 config 기본값을 순서대로 사용합니다.
서로 다른 서버를 대상으로 실행할 때는 module별 값을 따로 넘기면 됩니다.

```bash
__BASE_URL_RUN_COMMAND__
BASE_URL_AUTH=https://auth-api.example.com BASE_URL_BOS=https://bos-api.example.com __RUN_SMOKE_COMMAND__
```

## 3. 비밀 값 사용

시나리오에서 `{{env.NAME}}`을 사용한다면 `__DIRECTORY__/.env.example`을 `__ENV_PATH__`로 복사한 뒤 비밀 값을 채웁니다.

```bash
__ENV_COPY_COMMAND__
__VALIDATE_SMOKE_COMMAND__
__TEST_SMOKE_COMMAND__
__RUN_SMOKE_COMMAND__
```

`__CLI_COMMAND__ test`, `__CLI_COMMAND__ run`, `run.sh`가 `__ENV_PATH__`를 읽습니다. 이 파일은 `run.sh`와 같은 폴더에 있어야 합니다.
백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다. 루트 `.env` 값을 쓰려면 필요한 키만 이 파일로 복사하거나, 실행 전에 shell에서 직접 export합니다.
`__DIRECTORY__/.gitignore`는 기본적으로 `scenarios/**`만 git 추적 대상에 남기고 scaffold/config/생성물은 제외합니다. 실제 비밀 값은 commit하지 않습니다.
이미 git에 올라간 `__DIRECTORY__/` 파일은 ignore 규칙만으로 빠지지 않으므로 필요하면 `git rm -r --cached __DIRECTORY__`로 추적에서만 제거합니다.

## Scenario 작성법

Scenario YAML은 `__DIRECTORY__/scenarios/*.yaml`에 작성합니다.
먼저 `__CATALOG_QUERY_COMMAND__`로 테스트할 endpoint 후보를 찾습니다. 전체 catalog 파일은 `__CATALOG_PATH__`입니다.

자주 쓰는 request 필드입니다.

- `headers`: 인증 토큰 등 HTTP header
- `query`: query string
- `pathParams`: `/orders/{orderId}` 같은 path template 값
- `body`: JSON request body
- `multipart`: multipart/form-data 파일 업로드

`body`와 `multipart`는 같은 step에서 함께 쓰지 않습니다.

여러 API를 이어야 할 때는 이전 step의 `extract`로 응답 값을 저장하고, 다음 step의 `request.headers`, `request.query`, `request.pathParams`, `request.body`에서 `{{token}}`처럼 참조합니다.

응답 값을 다음 API에 연결하는 예시:

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
fixture 파일은 반복 테스트에 안전하고 유용할 때만 백엔드 git 정책에 맞게 ignore 예외를 풀어 commit합니다.

새 시나리오 정적 검증:

```bash
__VALIDATE_WORKFLOW_COMMAND__
```

새 시나리오 실행 검증:

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
- 반복 테스트 데이터 추가: entry scenario 상단 `vars:` 또는 `fixtures:` YAML 파일과 request의 `{{vars.NAME}}`
- 공통 로그인/seed 재사용: `scenarios/partials/*.yaml`을 만들고 scenario `steps`에서 `- include: ./partials/login.yaml`
- 대상 API 변경: `config.yaml`의 `baseUrl`, `modules.<name>.openapi` 수정 후 `__CLI_COMMAND__ sync`와 `__CLI_COMMAND__ generate` 재실행
- module 추가: `__CLI_COMMAND__ module add <name> --base-url <url> --sync`
- module JSON 출력: `__CLI_COMMAND__ module list --json`
- 기본 module 변경: `__CLI_COMMAND__ module set-default <name>`
- module 제거: `__CLI_COMMAND__ module remove <name>`
- 작업 공간 점검: `__CLI_COMMAND__ doctor`

## 5. 제거 방법

`update`는 `config.yaml`, `.env`, `scenarios/`, snapshot/catalog 파일, `generated/`, `logs/`를 보존하고 README, runner, `.env.example`, `.gitignore`, `.openapi-k6.json` 같은 scaffold 파일만 최신화합니다.
오래된 scaffold에서 `validate`, `test`, `generate`, `run`을 실행하면 최신 README/runner를 받을 수 있도록 `Scaffold update available` notice와 `__UPDATE_COMMAND__` 명령이 표시됩니다.

```bash
__UPDATE_COMMAND__
```

초기 scaffold를 의도적으로 다시 만들 때만 `init --force`를 사용합니다.

이 scaffold를 제거하려면 대상 프로젝트 루트에서 `__DIRECTORY__/` 폴더를 삭제합니다.

삭제 전에 현재 위치와 삭제 대상을 확인합니다.

```bash
pwd
ls __DIRECTORY_SHELL_ARG__
rm -rf __DIRECTORY_SHELL_ARG__
```

주의: 이 명령은 `__DIRECTORY__/config.yaml`, `__DIRECTORY__/.env.example`, `__DIRECTORY__/.gitignore`, `__DIRECTORY__/run.sh`, `__DIRECTORY__/scenarios/`, `__DIRECTORY__/openapi/`, `__DIRECTORY__/generated/`를 모두 삭제합니다.
필요한 scenario, snapshot, catalog가 있으면 먼저 백업합니다.

</details>

## AI Work Guide

<details>
<summary>AI 작업 규칙 보기</summary>

This section is for AI agents. Use it as a compact checklist after reading the Korean quick start.

### Guardrails

- Keep human-facing documentation in Korean.
- Run commands from the backend project root and follow the quick start order above.
- Do not skip validation gates: only generate/run scenarios after `__CLI_COMMAND__ validate` and `__CLI_COMMAND__ test` pass.
- During ordinary backend test work, edit only `config.yaml`, `.env`, and `scenarios/*.yaml`.
- If scaffold docs or helper scripts must change, update the generator template in openapi-k6-runner and rerun `__UPDATE_COMMAND__` intentionally.
- Regenerate `__SNAPSHOT_PATH__` and `generated/*.k6.js` with `sync`/`generate`; do not edit them directly.
- Do not write secrets in YAML. Use `{{env.NAME}}` and store real values only in `__ENV_PATH__`.

### Scenario Notes

- Use `__CATALOG_QUERY_COMMAND__` or read `__CATALOG_PATH__` to pick endpoints; `validate`, `test`, and `generate` read the OpenAPI snapshot, not the catalog.
- Prefer `api.operationId`; use `api.method` and `api.path` when operationId is missing or unclear.
- Put repeated literal test data in entry scenario `vars:` or scenario fixture YAML files and reference it as `{{vars.NAME}}`.
- Reuse common login/seed flows with `- include: ./partials/login.yaml`; include files stay under the entry scenario directory.
- Use `api.module` only when a scenario crosses multiple configured OpenAPI modules; it requires `config.yaml` module snapshots.
- Use `extract` for response values and reference them later as `{{variableName}}`; use `{{env.NAME}}` for runtime secrets.
- `validate` rejects context templates that are not produced by an earlier step `extract`.
- Put auth tokens under `request.headers`.
- Do not use `request.body` and `request.multipart` in the same step.
- `condition` compiles to a k6 `check`; it is not a branch. Later steps still run even if a check fails.
- `extract` also compiles to a k6 `check` so missing extracted values are visible in k6 output.
- `pathParams` values are encoded as URL path segments.
- Config-relative paths resolve from the directory containing `config.yaml`.
- Multipart file paths are relative to `__DIRECTORY__/`. Put local upload fixtures under `__FIXTURES_PATH__` by default and unignore/commit them only when repeatable tests need them.
- Spring endpoints such as `@PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)` should be modeled with `request.multipart`.
- k6 multipart references: https://grafana.com/docs/k6/latest/examples/data-uploads/, https://grafana.com/docs/k6/latest/javascript-api/k6-http/file/, https://grafana.com/docs/k6/latest/javascript-api/init-context/open/.

### Files to inspect

- `__CONFIG_PATH__`: base URL, OpenAPI URL, snapshot/catalog paths
- `__DIRECTORY__/.env.example`: example file for `__ENV_PATH__` secret values
- `__RUN_SCRIPT_PATH__`: k6 runner that auto-loads `__ENV_PATH__` values
- `__CATALOG_PATH__`: endpoint catalog
- `__SCENARIO_PATH__`: scenario DSL
- `__OUTPUT_PATH__`: generated k6 script

</details>
