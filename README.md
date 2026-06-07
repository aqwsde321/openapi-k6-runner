# openapi-k6

[![npm version](https://img.shields.io/npm/v/openapi-k6?label=npm)](https://www.npmjs.com/package/openapi-k6)
[![Publish](https://github.com/aqwsde321/openapi-k6-runner/actions/workflows/publish.yml/badge.svg)](https://github.com/aqwsde321/openapi-k6-runner/actions/workflows/publish.yml)

OpenAPI에서 API 흐름을 **Scenario YAML**로 만들고, k6 실행 전에 검증한 뒤, 통과한 시나리오만 부하 테스트로 넘기는 CLI입니다.

`openapi-k6`의 중심은 k6 파일 생성보다 scenario 작성과 검증입니다.
로그인 -> 토큰 추출 -> 인증 API 호출 같은 흐름을 YAML로 연결하고, OpenAPI snapshot과 실제 백엔드 요청으로 먼저 확인합니다.

## 한눈에 보기

```text
init -> sync -> catalog 검색 -> scenario YAML 작성 -> validate -> test -> run
```

| 단계 | 명령 | 하는 일 |
| --- | --- | --- |
| 1 | `npx --yes openapi-k6 init` | 백엔드 프로젝트에 `load-tests/` 생성 |
| 2 | `npx --yes openapi-k6 sync` | OpenAPI snapshot과 endpoint catalog 생성 |
| 3 | `npx --yes openapi-k6 catalog --query <검색어>` | scenario에 쓸 endpoint 후보 검색 |
| 4 | `load-tests/scenarios/*.yaml` 작성 | catalog 기준으로 API 흐름 작성 |
| 5 | `npx --yes openapi-k6 validate -s <scenario-name>` | OpenAPI snapshot 기준 정적 검증 |
| 6 | `npx --yes openapi-k6 test -s <scenario-name>` | Node.js에서 scenario 1회 실행 검증 |
| 7 | `npx --yes openapi-k6 run -s <scenario-name> --log -- --vus 1` | 정적 검증, k6 스크립트 생성, k6 실행 |
| 8 | `npx --yes openapi-k6 generate -s <scenario-name>`, `./load-tests/run.sh <scenario-name> --log` | 스크립트만 생성하거나 runner로 실행 |

`<검색어>`는 catalog 검색어이고, `<scenario-name>`은 `load-tests/scenarios/<scenario-name>.yaml`의 이름입니다.
예시 값은 `login`, `smoke`입니다.

k6 실행 전에는 `validate`와 `test`를 먼저 통과시키는 흐름을 권장합니다.

- `validate`: API 호출 없이 OpenAPI snapshot 기준으로 operation, path/query/header/body, context template, condition/extract 문법을 확인합니다.
- `test`: 실제 API에 1회 요청해 URL, header, query, path, body, 환경변수, condition, extract 동작을 확인합니다.

## 핵심 기능

| 기능 | 역할 |
| --- | --- |
| Scenario YAML | 로그인, 추출, 인증 요청 같은 API 흐름을 YAML로 표현합니다. |
| Scenario vars/fixtures | `vars:`와 fixture 파일로 SKU, tenant, 테스트 데이터 같은 반복 값을 관리하고 `{{vars.sku}}`로 참조합니다. |
| 재사용 step include | 로그인/seed 같은 공통 step YAML을 여러 scenario에서 include해 반복을 줄입니다. |
| 검증 관문 | k6 실행 전에 OpenAPI 정합성, 요청 구성, 추출, 설정 오류를 잡습니다. |
| 로컬 UI | 작성한 scenario 목록을 보고 서버 상태 확인, validate/test 실행, CLI 로그 확인을 브라우저에서 합니다. |
| OpenAPI catalog | `catalog` 명령으로 scenario에 쓸 `operationId`, `method`, `path`를 찾습니다. |
| 멀티모듈/멀티서버 | `module add`와 `api.module`로 서로 다른 OpenAPI/Swagger 서버를 하나의 scenario에서 연결합니다. |
| Doctor 점검 | `doctor`로 config, snapshot, catalog, scaffold metadata, module env 충돌, k6 설치 여부를 확인합니다. |
| `load-tests/` 작업 공간 | config, scenario, snapshot, 생성된 k6 스크립트, runner를 백엔드 프로젝트 안에서 관리합니다. |
| AI 작업 프롬프트 | 루트 README에서 시작하고 생성 README로 이어지는 작업 지침을 제공합니다. |

## 지원 범위

- Node.js 20 이상
- OpenAPI 3.x 문서
- 검증과 실행 시 접근 가능한 백엔드 서버
- k6 스크립트 실행용 k6 별도 설치
- Swagger/OpenAPI 2.0 문서는 지원하지 않습니다.
- 목표는 범용 API 테스트 플랫폼이 아니라 OpenAPI 기반 scenario 검증과 k6 스크립트 생성입니다.

## 진행 방식 선택

먼저 진행 방식을 고릅니다.

| 방식 | 시작 방법 |
| --- | --- |
| AI에게 맡기기 | 아래 [AI에게 맡기기](#ai에게-맡기기) 프롬프트를 복사해서 agent에 전달합니다. |
| 직접 실행하기 | [직접 실행 단계](#직접-실행-단계)의 1번부터 순서대로 실행합니다. |

## 직접 실행 단계

### 1. 작업 공간 생성

백엔드 프로젝트 루트에서 실행합니다.

```bash
npx --yes openapi-k6 init
```

대화형 프롬프트가 나오면 API 기본 주소를 입력합니다.

```text
API base URL [http://localhost:8080]: https://api.example.com
```

`API base URL`에는 Swagger UI 주소가 아니라 실제 API 요청의 기본 주소를 입력합니다.
예를 들어 API가 `https://api.example.com/orders`라면 `https://api.example.com`을 입력합니다.

OpenAPI 문서를 자동으로 찾지 못하면 CLI가 한 번 더 묻습니다.

```text
OpenAPI spec URL/file path or "skip" [https://api.example.com/v3/api-docs]:
```

이때는 OpenAPI JSON/YAML URL이나 파일 경로를 입력합니다. 지금 모르면 `skip`으로 넘어간 뒤 다음 단계에서 config를 직접 채웁니다.

### 2. 설정 확인

`load-tests/config.yaml`에 TODO가 남아 있으면 실제 API 정보로 채웁니다.

```yaml
baseUrl: https://api.example.com
defaultModule: default
modules:
  default:
    openapi: https://api.example.com/v3/api-docs
```

`baseUrl`은 실제 API 요청의 기본 주소이고, `openapi`는 `sync`가 읽을 OpenAPI 문서 URL 또는 파일 경로입니다.

### 3. OpenAPI snapshot/catalog 생성

```bash
npx --yes openapi-k6 sync
```

### 4. Scenario 작성

이 단계의 목표는 catalog에서 API를 고르고, 그 값을 scenario YAML에 옮기는 것입니다.
step 하나가 API 요청 하나입니다.

#### 4-1. Endpoint 찾기

```bash
npx --yes openapi-k6 catalog --query <검색어>
npx --yes openapi-k6 catalog --tag <tag>
```

예: 로그인 API는 `--query login`, auth tag는 `--tag auth`로 찾습니다.
처음에는 `--query`로 찾고, 결과가 많으면 `--tag`나 `--method POST`로 좁히면 됩니다.
출력에서 우선 볼 값은 `operationId`, `body`, `parameters`입니다.

- `operationId`: scenario의 `api.operationId`에 넣습니다.
- `body: yes`: `request.body` 또는 `request.multipart`가 필요한 API입니다.
- `parameters`: 나오면 `request.pathParams`, `request.query`, `request.headers` 중 맞는 위치에 값을 넣습니다.

<details>
<summary>catalog 검색과 출력 읽는 법</summary>

`--query`는 검색어로 찾기, `--tag`는 OpenAPI tag로 좁히기입니다.

- `--query <검색어>`: catalog 전체에서 검색어가 들어간 API를 찾습니다.
- `--tag <tag>`: OpenAPI에서 해당 tag로 묶인 API만 봅니다.

전체 catalog 파일은 `load-tests/openapi/*.catalog.json`에 있습니다.

출력 예시:

```text
Catalog: load-tests/openapi/default.catalog.json
Query: login
Operations: 1

POST   /auth/login
  operationId: loginUser
  tags: auth
  body: yes (application/json)
```

- `method`와 `path`: `operationId`가 없거나 애매할 때 `api.method`, `api.path`로 쓸 수 있습니다.

`operationId`는 openapi-k6가 새로 만드는 이름이 아닙니다.
백엔드 OpenAPI 문서에 있는 `operationId`를 `sync`가 `load-tests/openapi/*.catalog.json`에 복사합니다.
OpenAPI에 `operationId`가 없으면 catalog에도 안 나오므로 `api.method`와 `api.path`를 씁니다.

같은 module 안에서 `operationId`가 중복되면 `validate`, `generate`, `test`, `run`이 실패합니다.
서로 다른 module의 같은 `operationId`는 `api.module`로 구분해서 사용할 수 있습니다.

</details>

#### 4-2. Scenario 파일 선택

`load-tests/scenarios/smoke.yaml`은 `init`이 만든 기본 예시 scenario입니다.
명령의 `-s <scenario-name>`은 scenario 파일 이름에서 확장자를 뺀 값입니다.
처음 동작 확인은 `smoke.yaml`을 수정해도 되고, 실제 업무 흐름은 `load-tests/scenarios/order-flow.yaml`처럼 새 파일로 만들어도 됩니다.

#### 4-3. 최소 YAML 작성

처음에는 아래 필드만 채우면 됩니다.

- `id`: 사람이 읽을 step 이름
- `api.operationId`: catalog에서 고른 `operationId`
- `request`: headers, query, pathParams, body 같은 요청 값
- `extract`: 다음 step에서 쓸 응답 값
- `condition`: 기대하는 응답 조건

```yaml
name: smoke

steps:
  - id: login
    api:
      operationId: loginUser # catalog에서 고른 operationId
    request:
      body:
        username: "{{env.LOGIN_ID}}"
        password: "{{env.LOGIN_PASSWORD}}"
    extract:
      token:
        from: $.token # 응답 JSON에서 token을 저장
    condition: status == 200

  - id: get-me
    api:
      operationId: getMe
    request:
      headers:
        Authorization: "Bearer {{token}}" # 앞 step에서 추출한 token 사용
    condition: status == 200
```

예시처럼 `{{env.*}}`를 쓰면 `test` 전에 `load-tests/.env`에 실제 값을 둡니다.

#### 4-4. 선택: 데이터와 공통 step

처음 scenario는 이 섹션을 건너뛰어도 됩니다.
같은 값이나 같은 step이 반복될 때만 사용합니다.

| 필요할 때 | 사용 | 예 |
| --- | --- | --- |
| 같은 값을 여러 step에서 재사용 | `vars:` | `{{vars.sku}}` |
| stage/prod 값을 분리 | `fixtures:` 또는 `--var-file` | `fixtures/stage.yaml` |
| 로그인/seed step 재사용 | `include` | `- include: ./partials/login.yaml` |

fixture와 include 경로는 실행하는 scenario 파일 기준 상대 경로이며, 그 scenario 디렉터리 밖으로 나갈 수 없습니다.

<details>
<summary>예시와 우선순위</summary>

```yaml
# load-tests/scenarios/order-flow.yaml
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

partial 파일은 `steps`만 두면 됩니다. 포함된 step의 `extract` 값은 뒤 step에서 그대로 참조할 수 있습니다.
include 파일에는 `vars:`나 `fixtures:`를 두지 않고, 변수는 실행하는 scenario 파일에서 관리합니다.
`fixtures/dev.yaml`은 `loginId: tester@example.com`처럼 변수 이름을 key로 두는 YAML object입니다.

값 우선순위는 scenario `fixtures:` < scenario `vars:` < CLI `--var-file` < CLI `--var`입니다.

```bash
npx --yes openapi-k6 validate -s smoke --var-file load-tests/scenarios/fixtures/stage.yaml
npx --yes openapi-k6 test -s smoke --var sku=ABC-001
npx --yes openapi-k6 run -s smoke --var-file load-tests/scenarios/fixtures/stage.yaml -- --vus 1
```

</details>

### 5. Scenario 정적 검증

```bash
npx --yes openapi-k6 validate -s <scenario-name>
```

`validate`는 백엔드에 요청하지 않고 scenario YAML을 OpenAPI snapshot과 대조합니다.
`operationId`, `method/path`, 필수 request 값, context template, `condition`, `extract.from` 문법을 확인합니다.

### 6. Scenario 실행 검증

```bash
npx --yes openapi-k6 test -s <scenario-name>
```

`test`는 실제 백엔드에 1회 요청해 URL, status, `condition`, `extract`를 확인합니다.
이 단계가 통과해야 k6 스크립트를 생성하거나 실행합니다.

출력 예시:

```text
scenario: smoke
base url: https://api.example.com
steps: 2

[1/2] login
  request: POST /auth/login
      url: https://api.example.com/auth/login
   status: ✓ 200 OK  41ms
   checks: ✓ status == 200
  extract: ✓ token

[2/2] get-me
  request: GET /me
      url: https://api.example.com/me
   status: ✓ 200 OK  18ms
   checks: ✓ status == 200

summary: ✓ PASS
```

여기서 `url`, `status`, `checks`, `extract`, 마지막 `summary`를 확인합니다.
실패하면 해당 step 아래에 error와 response body 일부가 표시되고, 비밀 값은 마스킹됩니다.

시나리오 이름을 매번 입력하기 번거로우면 로컬 UI를 켭니다.

```bash
npx --yes openapi-k6 ui
```

UI에서는 scenario 목록을 클릭해 step/module/env 참조를 보고, 서버와 snapshot 상태를 확인한 뒤 `Validate` 또는 `Test` 버튼으로 같은 CLI 검증을 실행할 수 있습니다.
오른쪽 출력 영역에는 터미널에서 보던 CLI 로그가 그대로 표시됩니다.

### 7. k6 실행

```bash
npx --yes openapi-k6 run -s <scenario-name> --log -- --vus 1 --iterations 1
```

`run`은 scenario를 정적 검증하고, k6 스크립트를 다시 생성한 뒤 `k6 run`을 실행합니다. k6 옵션은 `--` 뒤에 붙입니다.

스크립트만 생성하거나 scaffold runner를 직접 쓰려면 기존 흐름도 그대로 사용할 수 있습니다.

```bash
npx --yes openapi-k6 generate -s <scenario-name>
./load-tests/run.sh <scenario-name> --log
```

k6 스크립트 실행에는 k6 설치가 필요합니다.

## 여러 백엔드 서버 연결

`init` 직후 config는 단일 서버용 `default` module만 들어 있습니다.
그 서버가 업무 서버라면 그대로 두고, 추가로 필요한 서버만 module로 등록합니다.

```bash
npx --yes openapi-k6 module add auth --base-url https://auth-api.example.com --sync
npx --yes openapi-k6 module list
```

`--sync`를 붙이면 module 설정 저장과 동시에 해당 서버의 snapshot/catalog를 만듭니다.
OpenAPI 문서 주소가 자동 탐색되지 않으면 `--openapi`를 같이 넘깁니다.

```bash
npx --yes openapi-k6 module add auth \
  --base-url https://auth-api.example.com \
  --openapi https://auth-api.example.com/v3/api-docs \
  --sync
```

추가 후 config는 이런 모양이 됩니다.

```yaml
baseUrl: https://bos-api.example.com
defaultModule: default

modules:
  default:
    openapi: https://bos-api.example.com/v3/api-docs
    snapshot: openapi/default.openapi.json
    catalog: openapi/default.catalog.json

  auth:
    baseUrl: https://auth-api.example.com
    openapi: https://auth-api.example.com/v3/api-docs
    snapshot: openapi/auth.openapi.json
    catalog: openapi/auth.catalog.json
```

root `baseUrl`과 `defaultModule`은 `api.module`이 없는 step의 fallback으로 두면 됩니다.
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

생성된 k6 스크립트는 `BASE_URL_AUTH`, `BASE_URL_DEFAULT` 같은 module별 환경변수를 먼저 읽습니다.
없으면 기존 `BASE_URL`과 config 기본값을 순서대로 사용합니다.
같은 `operationId`가 여러 module에 있어도 step의 `api.module` 안에서만 찾습니다.

## 상세 참고

<details>
<summary>작동 예시와 test 출력</summary>

`login` 응답에서 `token`을 추출해 다음 API의 `Authorization` header에 넣는 흐름입니다.

```yaml
name: login-and-read-profile

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

여러 OpenAPI module을 하나의 흐름에서 섞어야 하면 위의 “여러 백엔드 서버를 연결할 때”처럼 step의 `api.module`을 지정합니다. 지정하지 않은 step은 기존처럼 `--module`, `defaultModule`, 단일 module 추론 순서로 module을 선택합니다.

`openapi-k6 test`는 이 YAML을 먼저 실행하고, 실패한 step과 검증식을 출력합니다.

```text
$ npx --yes openapi-k6 test -s login-and-read-profile

     scenario: login-and-read-profile
     base url: https://api.example.com
        steps: 2

     [1/2] login
      request: POST /auth/login
          url: https://api.example.com/auth/login
        state: → running
       status: ✓ 200 OK  41ms
       result: ✓ PASS
       checks: ✓ status == 200
      extract: ✓ token

     [2/2] get-me
      request: GET /me
          url: https://api.example.com/me
        state: → running
       status: ✓ 200 OK  18ms
       result: ✓ PASS
       checks: ✓ status == 200

      summary: ✓ PASS
        steps: 2/2 passed
     duration: 59ms
```

`test`가 통과한 scenario만 `openapi-k6 run`으로 k6까지 실행하거나 `openapi-k6 generate`로 스크립트를 생성합니다.

</details>

<details>
<summary>수정할 파일과 생성물</summary>

보통 직접 수정하는 파일은 `load-tests/config.yaml`, `load-tests/.env`, `load-tests/scenarios/*.yaml`입니다. OpenAPI snapshot과 생성된 k6 스크립트는 명령으로 다시 만듭니다.

| 파일 | 역할 |
| --- | --- |
| `load-tests/README.md` | 대상 프로젝트 작업 가이드 |
| `load-tests/config.yaml` | API base URL, OpenAPI URL, snapshot/catalog 경로 |
| `load-tests/.env.example` | 비밀값용 `.env` 예시 |
| `load-tests/.openapi-k6.json` | scaffold 문서/runner 버전 확인용 metadata |
| `load-tests/run.sh` | k6 실행 스크립트 |
| `load-tests/scenarios/smoke.yaml` | 기본 예시 scenario YAML |
| `load-tests/scenarios/partials/login.yaml.example` | include용 로그인 partial 예시 |
| `load-tests/scenarios/fixtures/dev.yaml.example` | `vars` fixture 예시 |
| `load-tests/openapi/*.openapi.json` | `sync`가 만든 OpenAPI snapshot |
| `load-tests/openapi/*.catalog.json` | scenario 작성용 endpoint catalog |
| `load-tests/generated/*.k6.js` | `generate`가 만든 k6 스크립트 |

`load-tests/.env`는 생성되지 않습니다. 비밀값이 필요하면 `.env.example`을 복사해서 직접 만들고 commit하지 않습니다.

기본 `load-tests/.gitignore`는 `scenarios/**`만 git 추적 대상에 남기고 scaffold/config/생성물은 제외합니다. 전체 작업 공간을 git에 포함하려면 해당 ignore 규칙을 조정하세요.

기존 `load-tests/config.yaml`과 scenario를 보존한 채 README, runner, `.env.example`, `.gitignore`, `.openapi-k6.json` 같은 scaffold 파일만 최신화하려면 `update`를 사용합니다.

```bash
npx --yes openapi-k6 update
```

`update`는 `load-tests/config.yaml`, `.env`, `scenarios/`, `openapi/`, `generated/`, `logs/`를 보존합니다.
오래된 scaffold에서 `validate`, `test`, `generate`, `run`을 실행하면 최신 README/runner를 받을 수 있도록 `Scaffold update available` notice와 `npx --yes openapi-k6 update` 명령이 표시됩니다.
초기 scaffold를 의도적으로 다시 만들 때만 `init --force`를 사용합니다.

</details>

<details>
<summary>검증 규칙과 제약</summary>

- OpenAPI 3.x 문서를 대상으로 합니다. Swagger/OpenAPI 2.0 문서는 지원하지 않습니다.
- `condition`은 분기가 아니라 검증식입니다. k6에서는 `check`로 생성되며 다음 step 실행을 막지 않습니다.
- `extract`는 응답 JSON에서 값을 읽어 다음 step의 `{{token}}` 같은 template 값으로 연결하며, 생성된 k6에서는 추출 실패를 `check` 실패로 표시합니다.
- `vars:`는 entry scenario에 정의하는 literal 테스트 데이터입니다.
- `fixtures:`는 entry scenario 디렉터리 안의 YAML object를 읽어 `vars`로 병합합니다.
- CLI `--var-file`과 `--var`는 `validate`, `generate`, `test`, `run` 실행 시점에 같은 `vars`를 덮어씁니다.
- include partial은 entry scenario의 `vars`를 사용할 수 있지만 자체 `vars`/`fixtures`는 정의하지 않습니다.
- `steps` 안에서 `- include: ./partials/login.yaml`로 공통 step 파일을 펼칠 수 있습니다. include는 local file만 지원하고 entry scenario 디렉터리 밖으로 나갈 수 없습니다.
- `api.module`은 여러 OpenAPI module을 하나의 scenario에서 섞어 쓸 때 사용합니다. `--openapi` 단독 실행에서는 지원하지 않고 config의 `modules.<name>.snapshot`이 필요합니다.
- `validate`는 지원하지 않는 `condition` 표현식, `extract.from` JSONPath, 아직 이전 step에서 추출되지 않은 `{{token}}` 같은 context template 참조를 API 호출 전에 실패로 처리합니다.
- 비밀값은 scenario YAML에 직접 쓰지 않고 `{{env.NAME}}`으로 참조합니다.
- `{{env.NAME}}`으로 참조한 값은 scenario test 출력과 생성된 k6 실패 로그에서 masking됩니다.
- `body`와 `multipart`는 같은 step에서 함께 쓰지 않습니다.

</details>

<details>
<summary>버전 고정</summary>

프로젝트에 버전을 고정하려면 devDependency로 설치합니다.

```bash
pnpm add -D openapi-k6
pnpm exec openapi-k6 --help
```

새 배포본을 명시하려면 `npx --yes openapi-k6@latest <command>`를 사용할 수 있습니다. 팀/CI에서는 `openapi-k6@<version>`처럼 버전을 고정하는 편이 재현성에 유리합니다.

현재 저장소 코드를 직접 실행하려면 [도구 개발/유지보수](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/03-maintainer-notes.md)를 참고하세요.

</details>

## 명령 모음

| 상황 | 명령 |
| --- | --- |
| 작업 공간 생성 | `npx --yes openapi-k6 init` |
| OpenAPI snapshot/catalog 갱신 | `npx --yes openapi-k6 sync` |
| OpenAPI module 추가 | `npx --yes openapi-k6 module add auth --base-url <url> --sync` |
| OpenAPI module 목록 확인 | `npx --yes openapi-k6 module list` |
| OpenAPI module JSON 출력 | `npx --yes openapi-k6 module list --json` |
| 기본 OpenAPI module 변경 | `npx --yes openapi-k6 module set-default auth` |
| OpenAPI module 제거 | `npx --yes openapi-k6 module remove auth` |
| scenario용 endpoint 검색 | `npx --yes openapi-k6 catalog --query <검색어>` |
| 로컬 UI로 scenario 선택/검증 | `npx --yes openapi-k6 ui` |
| scenario 정적 검증 | `npx --yes openapi-k6 validate -s <name>` |
| scenario 실행 검증 | `npx --yes openapi-k6 test -s <name>` |
| 환경별 vars override | `npx --yes openapi-k6 test -s <name> --var-file <fixture.yaml> --var sku=ABC-001` |
| 정적 검증, 생성, k6 실행 | `npx --yes openapi-k6 run -s <name> --log -- --vus 1` |
| k6 스크립트 생성 | `npx --yes openapi-k6 generate -s <name>` |
| k6 설치 후 실행 | `./load-tests/run.sh <name> --log` |
| 작업 공간 점검 | `npx --yes openapi-k6 doctor` |
| 기존 scaffold 안전 갱신 | `npx --yes openapi-k6 update` |
| scaffold 파일 재생성 | `npx --yes openapi-k6 init --force` |

## AI에게 맡기기

AI coding agent에게 처음 작업을 맡길 때 아래 프롬프트를 붙여넣으세요.

```text
이 백엔드 프로젝트에 openapi-k6 Scenario YAML 검증과 k6 부하 테스트 준비를 적용해줘.

1. 먼저 이 README의 빠른 시작과 지원 범위를 읽어.
2. 모든 명령은 백엔드 프로젝트 루트에서 실행해.
3. 아직 load-tests/README.md가 없으면 npx --yes openapi-k6 init을 실행해.
   baseUrl 또는 OpenAPI spec URL을 확실히 모르면 나에게 물어봐.
4. init 후 생성된 load-tests/README.md를 읽고, 그 문서의 작업 순서와 규칙을 기준으로 진행해.
5. load-tests/config.yaml에 TODO가 남아 있으면 이 백엔드 프로젝트에 맞게 채워.
6. npx --yes openapi-k6 sync를 실행해서 OpenAPI snapshot과 catalog를 생성해.
7. npx --yes openapi-k6 catalog --query <검색어>로 테스트할 endpoint 후보를 확인해. 필요하면 load-tests/openapi/*.catalog.json도 열어봐.
8. 내가 원하는 API 흐름을 확인한 뒤 load-tests/scenarios/*.yaml을 작성하거나 수정해.
   처음에는 id, api.operationId, request, extract, condition만 채워.
   같은 값이나 같은 step이 반복될 때만 vars, fixtures, include를 사용해.
   include 파일에는 vars:나 fixtures:를 두지 말고, 변수는 실행하는 scenario 파일에서 관리해.
9. npx --yes openapi-k6 validate -s <name>으로 YAML/OpenAPI 정합성을 먼저 확인해.
10. npx --yes openapi-k6 test -s <name>으로 실제 API 흐름을 검증해.
11. scenario test가 통과하기 전에는 k6 스크립트를 생성하거나 실행하지 마.
12. 통과한 scenario만 npx --yes openapi-k6 run -s <name> --log -- --vus 1 --iterations 1로 짧게 실행해.
13. 스크립트만 필요하면 npx --yes openapi-k6 generate -s <name>으로 생성해.
14. 장시간 부하 테스트는 내가 요청하기 전에는 실행하지 말고, 실행 명령과 예상 확인 포인트를 알려줘.

load-tests/README.md, load-tests/run.sh, load-tests/.env.example, load-tests/.gitignore, load-tests/.openapi-k6.json은 scaffold 파일이므로 명시 요청 없이는 수정하지 마.
load-tests/openapi/*.openapi.json과 load-tests/generated/*.k6.js도 직접 수정하지 말고 sync/generate로 다시 만들어.
비밀값은 scenario YAML에 직접 쓰지 말고 {{env.NAME}}으로 참조해. 실제 값은 load-tests/.env에만 둬.
```

`init` 후 생성되는 `load-tests/README.md`에는 선택한 디렉터리, module 이름, config 경로가 반영된 AI 작업 프롬프트가 들어 있습니다.
작업 중간부터는 생성 README를 기준으로 따르세요.

## 참고문서

- [변경 이력](https://github.com/aqwsde321/openapi-k6-runner/blob/main/CHANGELOG.md)
- [문서 색인](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/README.md)
- [도구 개발/유지보수](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/03-maintainer-notes.md)
