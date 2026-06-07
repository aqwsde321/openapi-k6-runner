# __DIRECTORY__

이 폴더는 백엔드 프로젝트 안에서 OpenAPI snapshot, scenario YAML, scenario 검증, 생성된 k6 스크립트를 관리합니다.

흐름은 단순합니다.

```text
OpenAPI 가져오기 -> scenario 작성 -> validate/test -> run
```

## AI에게 작업 맡기기

AI coding agent에게 아래 프롬프트를 그대로 붙여넣으면 됩니다.

```text
이 백엔드 프로젝트에 openapi-k6 시나리오 테스트와 k6 부하 테스트 준비를 적용해줘.

1. 먼저 이 백엔드 프로젝트의 __DIRECTORY__/README.md 전체를 읽어.
   접힌 "고급 기능"과 "AI 작업 규칙"도 읽고 진행해.
2. 모든 명령은 백엔드 프로젝트 루트에서 실행해.
3. __CONFIG_PATH__에 TODO가 남아 있으면 이 백엔드 프로젝트에 맞게 채워.
4. __SYNC_COMMAND__를 실행해서 OpenAPI snapshot과 catalog를 만들어.
5. __CATALOG_AI_COMMAND__ 명령으로 테스트할 endpoint 후보와 scenario step 초안을 확인해.
   <검색어>는 실제 API 이름, path, tag에 맞게 바꿔. 필요하면 __CATALOG_PATH__도 열어봐.
   출력의 scenario mapping에서 path/query/header/body/extract 후보가 scenario YAML의 어느 위치에 들어가는지 확인해.
   출력의 Suggested scenario step은 초안으로 사용하되, body: {}, <...> placeholder, 필요한 extract 경로는 OpenAPI schema와 실제 응답을 확인해서 채워. <...> placeholder가 남으면 validate가 실패해.
6. 내가 원하는 API 흐름을 확인한 뒤 __DIRECTORY__/scenarios/*.yaml을 작성하거나 수정해.
   처음에는 id, api.operationId, request, extract, condition만 채워.
   operationId가 없거나 애매하면 api.method와 api.path를 사용해.
   같은 값이나 같은 step이 반복될 때만 vars, fixtures, include를 사용해.
   include 파일에는 vars:나 fixtures:를 두지 말고, 변수는 실행하는 scenario 파일에서 관리해.
   여러 서버를 이어야 할 때만 module add와 api.module을 사용해.
7. 비밀 값은 scenario YAML에 직접 쓰지 말고 {{env.NAME}}으로 참조해. 실제 값은 __ENV_PATH__에만 둬.
8. __VALIDATE_NAME_COMMAND__ 형식으로 YAML/OpenAPI 정합성을 먼저 확인해.
9. __TEST_NAME_COMMAND__ 형식으로 실제 API 흐름을 검증해.
10. validate와 test가 통과하기 전에는 k6 스크립트를 생성하거나 실행하지 마.
11. 통과한 scenario만 __RUN_NAME_COMMAND__ --log -- --vus 1 --iterations 1 형식으로 짧게 실행해.
12. 스크립트만 필요하면 __GENERATE_NAME_COMMAND__ 형식으로 k6 스크립트를 생성해.
13. 장시간 부하 테스트는 내가 요청하기 전에는 실행하지 말고, 실행 명령과 예상 확인 포인트를 알려줘.
14. CLI가 Scaffold update available을 표시하면 __UPDATE_COMMAND__를 실행하고 이 README를 다시 읽어.
    이 폴더를 최신화할 때 init --force를 사용하지 마.

__DIRECTORY__/README.md, __RUN_SCRIPT_PATH__, __DIRECTORY__/.env.example, __DIRECTORY__/.gitignore, __DIRECTORY__/.openapi-k6.json은 scaffold 파일이므로 명시 요청이 없으면 수정하지 마.
__SNAPSHOT_PATH__, __CATALOG_PATH__, __DIRECTORY__/generated/*.k6.js도 직접 수정하지 말고 sync/generate로 다시 만들어.
```

## 빠른 시작

모든 명령은 백엔드 프로젝트 루트에서 실행합니다.
CLI가 `Scaffold update available`을 표시하면 아래 흐름을 계속하기 전에 표시된 `update` 명령을 먼저 실행합니다.

```bash
__SYNC_COMMAND__
__CATALOG_SEARCH_COMMAND__
# __SCENARIO_TEMPLATE_PATH__ 작성
__VALIDATE_NAME_COMMAND__
__TEST_NAME_COMMAND__
__RUN_NAME_COMMAND__ --log -- --vus 1 --iterations 1
```

위 명령의 `<검색어>`는 endpoint를 찾을 단어이고, `<name>`은 `__DIRECTORY__/scenarios/<name>.yaml`에서 확장자를 뺀 scenario 이름입니다.

`run`은 k6 설치가 필요합니다. 스크립트만 만들려면 아래 명령을 사용합니다.

```bash
__GENERATE_NAME_COMMAND__
```

시나리오 이름을 매번 입력하기 번거롭거나 목록을 보고 싶으면 로컬 UI를 켭니다.

```bash
__UI_COMMAND__
```

## 1. 설정 확인

`__CONFIG_PATH__`에 TODO가 남아 있으면 실제 API 정보로 채웁니다.

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
- `catalog`: scenario 작성자가 endpoint를 고를 때 참고할 catalog

OpenAPI snapshot과 catalog를 만듭니다.

```bash
__SYNC_COMMAND__
```

생성/갱신: `__SNAPSHOT_PATH__`, `__CATALOG_PATH__`

## 2. Endpoint 고르기

```bash
__CATALOG_SEARCH_COMMAND__
```

`catalog` 출력에서는 주로 `operationId`, `body`, `parameters`를 봅니다.
AI에게 scenario 초안까지 맡길 때는 아래 명령을 사용합니다.
Swagger/OpenAPI 변경을 바로 반영하려면 `__CATALOG_SYNC_AI_COMMAND__`를 사용합니다.
OpenAPI schema/example이 있으면 request body 초안과 response extract 후보도 함께 보여줍니다.

```bash
__CATALOG_AI_COMMAND__
```

아래는 검색어 `login`을 사용한 출력 예시입니다.

```text
Catalog: __CATALOG_PATH__
Query: login
Operations: 1

POST   /auth/login
  operationId: loginUser
  tags: auth
  body: yes (application/json)
```

- `operationId`: scenario의 `api.operationId`에 넣습니다.
- `body: yes`: `request.body` 또는 `request.multipart`가 필요한 API입니다.
- `parameters`: `request.pathParams`, `request.query`, `request.headers` 중 맞는 위치에 넣습니다.

`operationId`가 없거나 애매하면 `api.method`와 `api.path`를 쓸 수 있습니다.
같은 module 안에서 `operationId`가 중복되면 `validate`, `generate`, `test`, `run`이 실패합니다.

## 3. Scenario 작성

`__SCENARIO_PATH__`는 `init`이 만든 기본 예시 scenario입니다.
처음 확인은 이 파일을 수정해도 되고, 실제 업무 흐름은 `__SCENARIO_TEMPLATE_PATH__`처럼 새 파일로 만들어도 됩니다.

최소 필드는 `id`, `api`, `request`, `extract`, `condition`입니다.

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

`{{env.*}}` 값은 `test` 전에 `__ENV_PATH__`에 둡니다.
비밀 값은 scenario YAML에 직접 쓰지 않습니다.
`catalog --ai` 초안의 `<...>` placeholder가 scenario에 남아 있으면 `validate`가 실패합니다.

## 4. 검증과 실행

| 명령 | API 호출 | k6 필요 | 목적 |
| --- | --- | --- | --- |
| `validate` | 없음 | 없음 | YAML과 OpenAPI 정합성 확인 |
| `test` | 있음 | 없음 | 실제 API 흐름을 1회 실행 |
| `generate` | 없음 | 없음 | k6 스크립트 생성 |
| `run` | 있음 | 있음 | validate/generate 후 k6 실행 |

```bash
__VALIDATE_NAME_COMMAND__
__TEST_NAME_COMMAND__
__RUN_NAME_COMMAND__ --log -- --vus 1 --iterations 1
```

`test`가 통과한 scenario만 `run`하거나 `generate`하는 흐름을 권장합니다.
`condition`은 분기 조건이 아니라 검증식입니다. k6 생성 시 `check`로 들어가며 다음 step 실행을 막는 용도로 쓰지 않습니다.

## 필요할 때만

| 필요 | 사용 |
| --- | --- |
| 브라우저에서 scenario 선택/검증 | `__UI_COMMAND__` |
| 반복 값 관리 | scenario `vars:` 또는 `--var-file`, `--var` |
| 공통 step 재사용 | `steps` 안에서 `- include: ./partials/login.yaml` |
| 여러 서버 연결 | `__CLI_COMMAND__ module add auth --base-url <url> --sync` |
| 작업 공간 점검 | `__CLI_COMMAND__ doctor` |
| 기존 scaffold 안전 갱신 | CLI가 `Scaffold update available`을 표시하면 `__UPDATE_COMMAND__` |
| 생성된 k6 직접 실행 | `__RUN_SCRIPT_ARG__ <scenario-name>` |

include와 fixture 경로는 실행하는 scenario 파일 기준 상대 경로이며, scenario 디렉터리 밖으로 나갈 수 없습니다.
여러 OpenAPI module을 한 scenario에서 섞을 때는 step의 `api.module`을 지정합니다.

## 파일 규칙

보통 직접 수정하는 파일은 아래 세 가지입니다.

- `__CONFIG_PATH__`
- `__ENV_PATH__`
- `__DIRECTORY__/scenarios/*.yaml`

아래 파일은 직접 고치지 말고 명령으로 다시 만듭니다.

- `__SNAPSHOT_PATH__`: `sync` 생성물
- `__CATALOG_PATH__`: `sync` 생성물
- `__DIRECTORY__/generated/*.k6.js`: `generate` 생성물

`__ENV_PATH__`는 생성되지 않습니다.
비밀 값이 필요하면 `__DIRECTORY__/.env.example`을 참고해 직접 만들고 commit하지 않습니다.

기본 `__DIRECTORY__/.gitignore`는 `scenarios/**`만 git 추적 대상에 남기고 scaffold/config/생성물은 제외합니다.
전체 작업 공간을 git에 포함하려면 ignore 규칙을 조정합니다.

## 명령 모음

| 상황 | 명령 |
| --- | --- |
| OpenAPI snapshot/catalog 갱신 | `__SYNC_COMMAND__` |
| endpoint 검색 | `__CATALOG_SEARCH_COMMAND__` |
| AI용 scenario 초안 | `__CATALOG_AI_COMMAND__` |
| 최신 sync 후 AI용 scenario 초안 | `__CATALOG_SYNC_AI_COMMAND__` |
| 정적 검증 | `__VALIDATE_NAME_COMMAND__` |
| 실행 검증 | `__TEST_NAME_COMMAND__` |
| k6 스크립트 생성 | `__GENERATE_NAME_COMMAND__` |
| k6 실행 | `__RUN_NAME_COMMAND__ --log -- --vus 1` |
| 로컬 UI | `__UI_COMMAND__` |
| scaffold 갱신 | `__UPDATE_COMMAND__` |

## 고급 기능

<details>
<summary>vars, fixtures, include, module, run.sh, multipart 예시 보기</summary>

### vars, fixtures, include

처음 scenario는 이 섹션을 건너뛰어도 됩니다.
같은 값이나 같은 step이 반복될 때만 사용합니다.

```yaml
# __SCENARIO_TEMPLATE_PATH__
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
      body:
        sku: "{{vars.sku}}"
```

partial 파일은 `steps`만 두면 됩니다.
include 파일에는 `vars:`나 `fixtures:`를 두지 않고, 변수는 실행하는 scenario 파일에서 관리합니다.
`__DIRECTORY__/scenarios/partials/login.yaml.example`과 `__DIRECTORY__/scenarios/fixtures/dev.yaml.example`을 실제 endpoint/데이터에 맞게 수정한 뒤 `.example`을 제거해 사용할 수 있습니다.

값 우선순위는 scenario `fixtures:` < scenario `vars:` < CLI `--var-file` < CLI `--var`입니다.

```bash
__VALIDATE_NAME_COMMAND__ --var-file __DIRECTORY__/scenarios/fixtures/stage.yaml
__TEST_NAME_COMMAND__ --var sku=ABC-001
__RUN_NAME_COMMAND__ --var-file __DIRECTORY__/scenarios/fixtures/stage.yaml -- --vus 1
```

### 여러 OpenAPI module

인증 서버와 업무 서버처럼 OpenAPI 주소가 다르면 module을 추가합니다.

```bash
__CLI_COMMAND__ module add auth --base-url https://auth-api.example.com --sync
__CLI_COMMAND__ module list
```

OpenAPI 문서 주소가 자동 탐색되지 않으면 `--openapi`를 같이 넘깁니다.

```bash
__CLI_COMMAND__ module add auth \
  --base-url https://auth-api.example.com \
  --openapi https://auth-api.example.com/v3/api-docs \
  --sync
```

서버가 여러 개면 scenario step에 사용할 module을 명시합니다.

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
      operationId: createOrder # api.module이 없으면 default module 사용
    request:
      headers:
        Authorization: "Bearer {{token}}"
```

### run.sh와 k6 실행

`__CLI_COMMAND__ run`은 scenario를 정적 검증하고, k6 스크립트를 다시 생성한 뒤 `k6 run`을 실행합니다.
k6 옵션은 `--` 뒤에 붙입니다.

```bash
__RUN_NAME_COMMAND__
__RUN_NAME_COMMAND__ -- --vus 1 --iterations 1
__RUN_NAME_COMMAND__ --log
```

`run.sh`는 자신과 같은 폴더의 `.env`(`__ENV_PATH__`)만 자동으로 로드한 뒤 `generated/<scenario>.k6.js`를 실행합니다.
백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다.
빠른 사용법은 `run.sh --help`로 확인할 수 있습니다.

```bash
__RUN_SCRIPT_ARG__ <scenario-name>
__RUN_SCRIPT_ARG__ <scenario-name> --vus 1 --iterations 1
__RUN_SCRIPT_ARG__ <scenario-name> --log
```

로그 파일: `__DIRECTORY__/logs/<scenario-name>.log`

`run`과 `run.sh`가 제공하는 편의 플래그입니다.

- `--log`: 콘솔 출력과 실패 응답 로그를 `logs/<scenario>.log`에 저장
- `--trace`: 각 scenario step의 시작/종료 로그 출력
- `--report`: k6 Web Dashboard HTML report를 `logs/<scenario>-report.html`에 저장
- `--open-dashboard`: 실행 중인 k6 Web Dashboard를 브라우저로 열기

```bash
__RUN_NAME_COMMAND__ --log --report -- --duration 10s --vus 1
__RUN_NAME_COMMAND__ --trace --log --report -- --duration 10s --vus 1
__RUN_SCRIPT_ARG__ <scenario-name> --report --duration 10s --vus 1
__RUN_SCRIPT_ARG__ <scenario-name> --trace --log --report --duration 10s --vus 1
```

HTML report: `__DIRECTORY__/logs/<scenario-name>-report.html`

API base URL은 `__CLI_COMMAND__ generate` 실행 시점의 `config.yaml` `baseUrl` 값이 생성된 k6 스크립트에 기본값으로 들어갑니다.
`config.yaml`을 수정한 뒤에는 스크립트를 다시 생성해야 반영됩니다.
실행 시점에 `BASE_URL` 환경 변수를 넘기면 스크립트에 들어간 기본값보다 우선합니다.

```bash
BASE_URL=https://api.example.com __RUN_SCRIPT_ARG__ <scenario-name>
```

multi-module scenario는 `BASE_URL_<MODULE>` 환경 변수를 먼저 읽습니다.
예를 들어 `auth`는 `BASE_URL_AUTH`, `bos-api`는 `BASE_URL_BOS_API`를 사용합니다.
없으면 기존 `BASE_URL`과 config 기본값을 순서대로 사용합니다.

### 비밀 값

시나리오에서 `{{env.NAME}}`을 사용한다면 `__DIRECTORY__/.env.example`을 `__ENV_PATH__`로 복사한 뒤 값을 채웁니다.

```bash
__ENV_COPY_COMMAND__
__VALIDATE_NAME_COMMAND__
__TEST_NAME_COMMAND__
__RUN_SCRIPT_ARG__ <scenario-name>
```

`__CLI_COMMAND__ test`, `__CLI_COMMAND__ run`, `run.sh`가 `__ENV_PATH__`를 읽습니다.
백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다.

### multipart 파일 업로드

`body`와 `multipart`는 같은 step에서 함께 쓰지 않습니다.
파일 경로는 `__DIRECTORY__/` 기준입니다. 업로드 fixture는 기본적으로 `__FIXTURES_PATH__` 아래에 둡니다.

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

Spring의 `@PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)` endpoint는 `request.multipart`로 작성합니다.

### 새 scenario 예시

```bash
__VALIDATE_WORKFLOW_COMMAND__
__TEST_WORKFLOW_COMMAND__
__GENERATE_WORKFLOW_COMMAND__
```

생성 파일: `__WORKFLOW_OUTPUT_PATH__`

### update와 제거

`update`는 `config.yaml`, `.env`, `scenarios/`, snapshot/catalog 파일, `generated/`, `logs/`를 보존하고 README, runner, `.env.example`, `.gitignore`, `.openapi-k6.json` 같은 scaffold 파일만 최신화합니다.
오래된 scaffold에서 `validate`, `test`, `generate`, `run`을 실행하면 최신 README/runner를 받을 수 있도록 `Scaffold update available` notice와 `__UPDATE_COMMAND__` 명령이 표시됩니다.
기존 scaffold를 최신화할 때는 `init --force`가 아니라 `update`를 사용합니다.

```bash
__UPDATE_COMMAND__
```

초기 scaffold를 의도적으로 다시 만들 때만 `init --force`를 사용합니다.
이 scaffold를 제거하려면 대상 프로젝트 루트에서 `__DIRECTORY__/` 폴더를 삭제합니다.

```bash
pwd
ls __DIRECTORY_SHELL_ARG__
rm -rf __DIRECTORY_SHELL_ARG__
```

삭제 전에 필요한 scenario, snapshot, catalog가 있는지 확인합니다.

</details>

## AI 작업 규칙

<details>
<summary>AI agent용 체크리스트 보기</summary>

- 사용자에게 보이는 설명은 한국어로 유지합니다.
- 명령은 백엔드 프로젝트 루트에서 실행합니다.
- 일반 작업에서 수정하는 파일은 `__CONFIG_PATH__`, `__ENV_PATH__`, `__DIRECTORY__/scenarios/*.yaml`로 제한합니다.
- CLI가 `Scaffold update available`을 표시하면 `__UPDATE_COMMAND__`를 실행하고 이 README를 다시 읽습니다.
- scaffold 문서나 runner를 바꿔야 하면 openapi-k6-runner의 생성 템플릿을 수정하고 `__UPDATE_COMMAND__`를 의도적으로 실행합니다.
- `__SNAPSHOT_PATH__`, `__CATALOG_PATH__`, `__DIRECTORY__/generated/*.k6.js`는 직접 수정하지 말고 `sync`/`generate`로 다시 만듭니다.
- endpoint와 step 초안은 `__CATALOG_AI_COMMAND__`에서 확인하고, 필요하면 `__CATALOG_PATH__`도 엽니다. `validate`, `test`, `generate`는 catalog가 아니라 OpenAPI snapshot을 읽습니다.
- 처음에는 plain step으로 작성하고, 값이나 step이 반복될 때만 `vars`, `fixtures`, `include`를 사용합니다.
- `operationId`를 우선 사용하고, 없거나 애매하면 `api.method`와 `api.path`를 사용합니다.
- 여러 OpenAPI module을 한 scenario에서 섞을 때만 `api.module`을 사용합니다.
- 응답 값은 `extract`로 저장하고 뒤 step에서 `{{variableName}}`으로 참조합니다.
- 비밀 값은 `{{env.NAME}}`으로 참조하고 실제 값은 `__ENV_PATH__`에만 둡니다.
- `request.body`와 `request.multipart`는 같은 step에서 함께 쓰지 않습니다.
- `condition`은 검증식이지 분기 조건이 아닙니다.
- `validate`와 `test`가 통과하기 전에는 `generate`, `run`, 장시간 k6 실행을 하지 않습니다.

</details>
