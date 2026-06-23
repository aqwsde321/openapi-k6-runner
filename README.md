# openapi-k6

[![npm version](https://img.shields.io/npm/v/openapi-k6?label=npm)](https://www.npmjs.com/package/openapi-k6)
[![Publish](https://github.com/aqwsde321/openapi-k6-runner/actions/workflows/publish.yml/badge.svg)](https://github.com/aqwsde321/openapi-k6-runner/actions/workflows/publish.yml)

openapi-k6는 OpenAPI 기반 API 흐름을 k6 테스트로 바꾸는 CLI입니다.
Postman처럼 endpoint 하나를 따로 호출하는 대신, 로그인 응답의 `token`을 다음 요청의 `Authorization`에 넣고 생성 API의 `id`를 조회 API에 넘기는 식의 연결된 흐름을 **Scenario YAML**로 작성합니다.
작성한 scenario는 먼저 `validate`로 YAML/OpenAPI 정합성을 확인하고, `test`로 실제 API 흐름을 1회 호출해 값 연결과 조건을 검증한 뒤, k6가 실행할 JS 파일로 생성합니다.

기본 흐름은 아래 순서입니다.

```text
init/sync -> catalog로 endpoint 확인 -> scenario 작성 -> validate -> test -> generate -> k6 run
```

AI coding agent에게 맡기려면 [AI agent로 시작하기](#ai-agent로-시작하기)를 먼저 보고, 직접 실행하려면 [빠른 시작](#빠른-시작)을 봅니다.

## AI agent로 시작하기

Codex를 사용한다면 `openapi-k6-scenario` 스킬을 설치한 뒤 시나리오를 요청하는 흐름을 권장합니다. 스킬은 Scenario YAML을 바로 쓰지 않고, 먼저 업무 프로세스와 호출할 API 순서를 정리한 뒤 사용자 확인을 받고 진행합니다.

```bash
npx --yes openapi-k6 install-skill --yes
```

설치 후에는 아래처럼 요청합니다.

```text
$openapi-k6-scenario 회원 로그인 시나리오
```

Codex에 스킬이 아직 설치되어 있지 않거나 새 프로젝트에서 처음 시작한다면 아래 프롬프트를 붙여넣습니다.

```text
이 백엔드 프로젝트에 openapi-k6 Codex 스킬을 사용해 Scenario YAML 검증과 k6 부하 테스트 준비를 적용해줘.

1. `$openapi-k6-scenario` 스킬을 사용할 수 있는지 확인해.
   사용할 수 없다면 나에게 설치할지 먼저 물어보고, 내가 동의하면 백엔드 프로젝트 루트에서 `npx --yes openapi-k6@latest install-skill --yes`를 실행해.
   이 명령은 Codex 스킬만 설치하고, 프로젝트의 openapi-k6 작업공간은 만들지 않아.
2. 모든 명령은 적용할 백엔드 프로젝트 루트에서 실행해.
3. 기본 작업공간은 `openapi-k6/`야. 팀이나 프로젝트 규칙상 다른 이름이 필요하면 `init --dir <path>`를 사용해.
4. 작업공간 README.md가 있으면 먼저 읽고 그 지침을 따라.
   처음에는 `AI 작업 계약`, `프로젝트 값`, `명령` 섹션만 확인해.
   같은 대화에서 최신 init, update, README 변경 이후 이미 읽었다면 전체를 다시 읽지 말고 필요한 섹션만 확인해.
   없으면 npx --yes openapi-k6@latest init을 실행해.
   baseUrl 또는 OpenAPI spec URL을 확실히 모르면 나에게 물어봐.
5. 기존 `load-tests/config.yaml`이 있고 `openapi-k6/config.yaml`이 없으면 npx --yes openapi-k6@latest update로 `openapi-k6/`로 이전해.
6. init 또는 update 후 생성된 작업공간 README.md의 `AI 작업 계약`, `프로젝트 값`, `명령` 섹션을 다시 읽어.
   이 README는 AI 작업 지침이므로, 이후 작업은 그 문서를 기준으로 진행해.
7. 시나리오 파일을 작성하거나 수정하기 전에는 먼저 업무 프로세스와 호출할 API 순서를 요약해서 내 확인을 받아.
   요약에는 scenario key와 파일 경로, API 호출 순서, method/path 또는 operationId, 필요한 request 값, env/vars로 받을 값, response에서 extract할 값, 기존 scenario 재사용 여부를 포함해.
8. 내가 `ㅇ`, `ok`, `ㄱ`처럼 긍정하면 그때 Scenario YAML을 작성하거나 수정해.
9. generate는 파일 쓰기 전에 정적 검증을 수행합니다. run의 k6 check 실패는 명령 실패로 처리됩니다. validate와 test가 통과하기 전에는 run이나 장시간 k6 실행을 하지 마.
10. 장시간 부하 테스트는 내가 요청하기 전에는 실행하지 말고, 실행 명령과 확인 포인트만 알려줘.
```

## 빠른 시작

백엔드 프로젝트 루트에서 실행합니다.
처음 적용하는 프로젝트는 `init`부터 실행합니다.
기본 작업공간은 `openapi-k6/`이고, 팀이나 프로젝트 이름에 맞추려면 처음 만들 때 `npx --yes openapi-k6 init --dir <path>`를 사용합니다.
기존 기본 작업공간인 `load-tests/`가 있는 프로젝트는 `npx --yes openapi-k6 update`로 `openapi-k6/`로 이전하고 scaffold 안내를 갱신합니다.

```bash
npx --yes openapi-k6 init
npx --yes openapi-k6 sync
npx --yes openapi-k6 catalog --query <검색어>
# openapi-k6/scenarios/<scenario-key>.yaml 작성
npx --yes openapi-k6 validate -s <scenario-key>
npx --yes openapi-k6 test -s <scenario-key>
npx --yes openapi-k6 test -s <scenario-key> --iterations 3
npx --yes openapi-k6 generate -s <scenario-key>
k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 1 --iterations 1
```

`<검색어>`는 endpoint를 찾을 단어이고, `<scenario-key>`는 `openapi-k6/scenarios/<scenario-key>.yaml`에서 확장자를 뺀 경로입니다.
시나리오가 많아지면 `openapi-k6/scenarios/auth/login.yaml`처럼 폴더로 묶고, CLI에서는 `-s auth/login`으로 실행합니다.
아래 예시는 이해를 돕기 위한 값입니다. 실제 명령에는 위 placeholder를 프로젝트에 맞게 바꿔 넣습니다.

`run`은 k6 설치가 필요합니다. 스크립트만 만들려면 아래 명령을 씁니다.

```bash
npx --yes openapi-k6 generate -s <scenario-key>
```

기존 프로젝트에서 CLI가 `Scaffold update available`을 표시하면 안내된 `update` 명령을 실행하면 됩니다.

```bash
npx --yes openapi-k6 update
```

API base URL과 OpenAPI 경로가 확실하면 `init --sync`로 작업 공간 생성 직후 snapshot/catalog까지 만들 수 있습니다.

```bash
npx --yes openapi-k6 init --base-url <url> --openapi <path-or-url> --sync
```

## 1. 작업 공간 만들기

```bash
npx --yes openapi-k6 init
```

`init`은 백엔드 프로젝트 안에 `openapi-k6/`를 만들고 API 기본 주소를 묻습니다.
작업공간 이름을 바꾸려면 처음 만들 때 `npx --yes openapi-k6 init --dir <path>`를 사용합니다.
이미 `load-tests/`가 있으면 `init --force`로 새로 만들지 말고 먼저 `npx --yes openapi-k6 update`를 사용해 `openapi-k6/`로 이전합니다.

```text
API base URL [http://localhost:8080]: https://api.example.com
```

Swagger UI 주소가 아니라 실제 API 요청의 기본 주소를 입력합니다.
OpenAPI 문서를 자동으로 찾지 못하면 OpenAPI JSON/YAML URL이나 파일 경로를 입력합니다.
지금 모르면 `skip`으로 넘어간 뒤 `openapi-k6/config.yaml`을 직접 채웁니다.

```yaml
baseUrl: https://api.example.com
defaultModule: default
modules:
  default:
    openapi: https://api.example.com/v3/api-docs
```

## 2. Endpoint 고르기

```bash
npx --yes openapi-k6 sync
npx --yes openapi-k6 catalog --query <검색어>
```

`sync`는 OpenAPI snapshot과 endpoint catalog를 만듭니다.
`catalog` 출력에서는 주로 `operationId`, `body`, `parameters`를 봅니다.
AI에게 scenario 초안까지 맡길 때는 `npx --yes openapi-k6 catalog --query <검색어> --ai`를 사용합니다.
Swagger/OpenAPI 변경을 바로 반영하려면 `npx --yes openapi-k6 catalog --sync --query <검색어> --ai`를 사용합니다.
OpenAPI schema/example이 있으면 request body 초안과 response extract 후보도 함께 보여줍니다.

아래는 검색어 `login`을 사용한 출력 예시입니다.

```text
Catalog: openapi-k6/openapi/default.catalog.json
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

## 3. Scenario 작성

`init`은 기본 예시인 `openapi-k6/scenarios/smoke.yaml`을 만듭니다.
처음 확인은 이 파일을 수정해도 되고, 실제 흐름은 새 YAML 파일로 만들어도 됩니다.
폴더는 UI의 카테고리로 쓰입니다. 예를 들어 `openapi-k6/scenarios/auth/login.yaml`은 UI에서 `auth` 그룹에 표시되고, CLI에서는 `-s auth/login`으로 실행합니다.

각 step에는 `id`와 `api`가 필요합니다.
`request`, `extract`, `condition`은 필요한 경우만 둡니다.
`condition`을 생략하면 `test`와 `run`은 HTTP status `< 400`을 성공으로 봅니다.

```yaml
name: smoke

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

`{{env.*}}` 값은 `test` 전에 `openapi-k6/.env`에 둡니다.
`.env`에는 토큰, 비밀번호, 서버 주소처럼 환경별 비밀/접속 값만 둡니다.
SKU, tenant, 검색어 같은 공개 테스트 데이터는 scenario `vars:` 또는 `--var-file`, `--var`로 관리합니다.
비밀값은 scenario YAML에 직접 쓰지 않습니다.
`catalog --ai` 초안의 `<...>` placeholder가 scenario에 남아 있으면 `validate`가 실패합니다.

## 4. 검증과 실행

| 명령 | API 호출 | k6 필요 | 목적 |
| --- | --- | --- | --- |
| `validate` | 없음 | 없음 | YAML과 OpenAPI 정합성 확인 |
| `test` | 있음 | 없음 | 실제 API 흐름을 1회 실행 |
| `generate` | 없음 | 없음 | YAML과 OpenAPI 정합성 확인 후 k6 스크립트 생성 |
| `run` | 있음 | 있음 | 검증/생성 후 k6 실행 편의 명령 |

```bash
npx --yes openapi-k6 validate -s <scenario-key>
npx --yes openapi-k6 test -s <scenario-key>
npx --yes openapi-k6 generate -s <scenario-key>
k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 1 --iterations 1
```

검증/생성/실행을 한 번에 처리하려면 `openapi-k6 run`도 사용할 수 있습니다.

```bash
npx --yes openapi-k6 run -s <scenario-key>
```

기본 생성 경로는 `openapi-k6/generated/<scenario-key>.k6.js`입니다.
예를 들어 `-s auth/login`은 `openapi-k6/generated/auth/login.k6.js`로 생성됩니다.
`--write`나 다른 작업공간 경로를 쓰면 직접 실행할 k6 파일 경로도 그 값에 맞춰 달라집니다.

`validate`가 통과한 scenario만 `generate`하고, `test`가 통과한 scenario만 `run`하는 흐름을 권장합니다.
`run`으로 실행하는 k6 스크립트는 각 step의 `condition`을 k6 check로 검증하고, check 실패가 있으면 명령도 실패합니다.

## 필요할 때만

| 필요 | 사용 |
| --- | --- |
| 브라우저에서 scenario 선택/검증 | `npx --yes openapi-k6 ui` |
| 반복 값 관리 | scenario `vars:`, `--var-file`, `--var`, `{{k6.*}}` |
| 다른 scenario 재사용 | `steps` 안에서 `- use: auth/login` |
| 여러 서버 연결 | `npx --yes openapi-k6 module add auth --base-url <url> --sync` |
| 작업 공간 점검 | `npx --yes openapi-k6 doctor` |
| 기존 scaffold 안전 갱신 | CLI가 `Scaffold update available`을 표시하면 `npx --yes openapi-k6 update` |

use 경로는 `openapi-k6/scenarios` 기준 scenario key이며, 다른 폴더의 steps를 같은 실행 context에 펼칩니다.
`use`에는 확장자를 쓰지 않습니다. 점이 들어간 파일명은 scenario key가 아니므로 재사용 대상은 `auth/login.yaml`처럼 key-safe한 이름으로 둡니다.
여러 OpenAPI module을 한 scenario에서 섞을 때는 step의 `api.module`을 지정합니다.

<details>
<summary>재사용과 고급 설정 보기</summary>

빠른 시작이 통과한 뒤, 반복을 줄이거나 여러 서버를 연결해야 할 때만 사용합니다.

### 다른 scenario use

다른 폴더의 scenario steps를 재사용할 때는 scenario root 기준 key를 씁니다.
`use`로 펼친 step의 `extract` 값은 뒤 step에서 그대로 참조할 수 있습니다.
`use` 값은 `auth/login`처럼 확장자 없는 scenario key여야 합니다.

```yaml
# openapi-k6/scenarios/order/get-me.yaml
name: get-me

steps:
  - use: auth/login
  - id: get-me
    api:
      operationId: getMe
    request:
      headers:
        Authorization: "Bearer {{token}}"
```

```yaml
# openapi-k6/scenarios/auth/login.yaml
name: login

steps:
  - id: login
    api:
      operationId: loginUser
    extract:
      token:
        from: $.token
```

`use` 대상 파일에는 반복 값을 두지 않고 entry scenario의 `vars:` 또는 CLI `--var-file`, `--var`에서 관리합니다.

### 테스트 데이터 재사용

같은 값을 여러 step에서 쓰면 scenario 상단에 `vars:`를 둡니다.

```yaml
name: order-flow

vars:
  sku: ABC-001

steps:
  - id: create-order
    api:
      operationId: createOrder
    request:
      body:
        sku: "{{vars.sku}}"
```

실행 시점 override도 가능합니다.

```bash
npx --yes openapi-k6 test -s <scenario-key> --var-file openapi-k6/vars/stage.yaml
npx --yes openapi-k6 test -s <scenario-key> --var sku=ABC-002
```

우선순위는 `vars:` < CLI `--var-file` < CLI `--var`입니다.

### 반복마다 달라지는 k6 값

k6 실행에서 요청 값이 모두 같으면 k6 실행 context를 참조합니다.

```yaml
name: create-users

vars:
  emailDomain: example.test

steps:
  - id: create-user
    api:
      operationId: createUser
    request:
      body:
        email: "load-{{k6.run.id}}-{{k6.scenario.iterationInTest}}@{{vars.emailDomain}}"
        externalId: "{{k6.run.id}}-vu{{k6.vu.idInTest}}-iter{{k6.vu.iterationInScenario}}"
```

지원 값:

- `{{k6.run.id}}`: k6 scenario 시작 timestamp 기반 run id. `OPENAPI_K6_RUN_ID` 환경변수로 고정할 수도 있습니다.
- `{{k6.scenario.iterationInTest}}`: scenario 전체에서 0부터 증가하는 iteration 번호
- `{{k6.scenario.iterationInInstance}}`: 현재 k6 instance 안에서 0부터 증가하는 iteration 번호
- `{{k6.vu.idInTest}}`: 테스트 전체에서 유일한 VU id
- `{{k6.vu.idInInstance}}`: 현재 k6 instance 안의 VU id
- `{{k6.vu.iterationInScenario}}`: 현재 VU가 이 scenario에서 실행한 iteration 번호
- `{{k6.vu.iterationInInstance}}`: 현재 VU가 현재 instance에서 실행한 iteration 번호

`test` 명령은 k6가 아니라 1회 API 흐름 검증이므로 `1 VU`, 첫 iteration 기준으로 해석합니다.
`test --iterations 3`처럼 실행하면 k6 없이도 `{{k6.scenario.iterationInTest}}`와 VU iteration 값이 `0`, `1`, `2`로 증가하는지 확인할 수 있습니다.
실제 `k6 run`에서는 generated script가 `k6/execution` 값을 사용해 반복마다 달라집니다.

### 기존 호환 기능

기존 프로젝트의 `fixtures:`와 `include:`는 계속 동작합니다. 새 scenario는 `vars:`/`--var-file`과 `use`를 우선 사용합니다.
`fixtures`와 `include` 경로는 entry scenario 디렉터리 밖으로 나갈 수 없습니다.

### 여러 서버 연결

API 서버가 여러 개면 module을 추가합니다.

```bash
npx --yes openapi-k6 module add auth --base-url https://auth-api.example.com --sync
npx --yes openapi-k6 module list
```

설정은 module 이름별 API 서버와 OpenAPI snapshot/catalog를 분리해서 저장합니다.

```yaml
baseUrl: https://api.example.com
defaultModule: app
modules:
  app:
    baseUrl: https://api.example.com
    snapshot: openapi/app.openapi.json
    catalog: openapi/app.catalog.json
  auth:
    baseUrl: https://auth-api.example.com
    snapshot: openapi/auth.openapi.json
    catalog: openapi/auth.catalog.json
```

OpenAPI 주소를 자동으로 찾지 못하면 직접 넘깁니다.

```bash
npx --yes openapi-k6 module add auth \
  --base-url https://auth-api.example.com \
  --openapi https://auth-api.example.com/v3/api-docs \
  --sync
```

scenario step에서 해당 module을 지정합니다.

```yaml
steps:
  - id: login
    api:
      module: auth
      operationId: loginUser

  - id: create-order
    api:
      operationId: createOrder
```

`api.module`이 없는 step은 `--module`, `defaultModule`, 단일 module 추론 순서로 module을 선택합니다.
baseUrl은 `BASE_URL_AUTH` 같은 module별 환경변수, `BASE_URL`, `modules.auth.baseUrl`, root `baseUrl`, OpenAPI snapshot의 `servers[0].url` 순서로 해석됩니다.
`doctor`는 각 module의 baseUrl이 어느 출처에서 해석되는지와 snapshot/catalog 파일 존재 여부를 같이 보여줍니다.
생성된 k6 스크립트도 같은 우선순위로 module별 환경변수를 먼저 읽고, 없으면 공통 `BASE_URL`과 config 값을 사용합니다.

### UI, doctor, update

```bash
npx --yes openapi-k6 ui
npx --yes openapi-k6 doctor
npx --yes openapi-k6 update
```

- `ui`: 브라우저에서 scenario를 고르고 `validate`/`test`를 실행합니다.
  폴더별 scenario는 접어서 볼 수 있고, 요청 단계는 각 step이 `직접 정의`, `시나리오 사용: auth/login`처럼 어디서 온 것인지 표시합니다.
  `test` 실행 결과는 최근 실행 결과에서 단계별 성공/실패, HTTP status, 소요시간, 출처를 함께 보여줍니다.
- `doctor`: config, module별 baseUrl 출처, snapshot/catalog, scaffold metadata, module env 충돌, k6 설치 여부를 점검합니다.
- `update`: 기존 `config.yaml`, `.env`, `scenarios/`, snapshot/catalog, `generated/`, `logs/`를 보존하고 scaffold 파일만 갱신합니다.

CLI가 `Scaffold update available`을 표시하면 안내된 `update` 명령을 실행합니다.
초기 scaffold를 의도적으로 다시 만들 때만 `init --force`를 사용합니다.

### generate와 runner

스크립트만 만들 때는 `generate`를 씁니다. `generate`는 파일 쓰기 전에 OpenAPI 정합성을 검증합니다.

```bash
npx --yes openapi-k6 generate -s <scenario-key>
```

생성된 runner를 직접 쓰는 기존 흐름도 유지됩니다.

```bash
./openapi-k6/run.sh <scenario-key> --log
```

k6 옵션은 scenario key 뒤에 붙입니다.

```bash
./openapi-k6/run.sh <scenario-key> --log --vus 1 --iterations 1
```

k6를 직접 실행할 때는 생성된 JS 파일을 지정합니다. 이 방식은 YAML/OpenAPI를 다시 검증하거나 최신 스크립트를 다시 만들지 않습니다.

```bash
k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 1 --iterations 1
```

자주 쓰는 k6 옵션 예시입니다.

```bash
k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 10 --duration 30s
k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --stage 30s:10 --stage 1m:50 --stage 30s:0
k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 10 --duration 30s --summary-export openapi-k6/logs/<scenario-key>-summary.json
```

### 제약

- OpenAPI 3.x만 지원합니다.
- `condition`은 분기가 아니라 검증식입니다.
- `body`와 `multipart`는 같은 step에서 함께 쓰지 않습니다.
- use 경로는 `openapi-k6/scenarios` 기준 확장자 없는 scenario key이며 scenario root 밖으로 나갈 수 없습니다.
- 비밀값은 scenario YAML에 직접 쓰지 않고 `{{env.NAME}}`으로 참조합니다.

</details>

## 파일 규칙

보통 직접 수정하는 파일은 아래 세 가지입니다.

- `openapi-k6/config.yaml`
- `openapi-k6/.env`
- `openapi-k6/scenarios/**/*.yaml`

아래 파일은 직접 고치기보다 명령으로 다시 만듭니다.

- `openapi-k6/openapi/*.openapi.json`: `sync` 생성물
- `openapi-k6/openapi/*.catalog.json`: `sync` 생성물
- `openapi-k6/generated/**/*.k6.js`: `generate` 생성물

`openapi-k6/.env`는 생성되지 않습니다.
비밀값이 필요하면 `openapi-k6/.env.example`을 참고해 직접 만들고 commit하지 않습니다.

기본 `openapi-k6/.gitignore`는 `scenarios/**`만 추적 대상에 남기고 scaffold/config/생성물은 제외합니다.
전체 작업 공간을 git에 포함하려면 ignore 규칙을 조정합니다.

## openapi-k6 명령 모음

| 상황 | 명령 |
| --- | --- |
| 작업 공간 생성 | `npx --yes openapi-k6 init` |
| 작업 공간 생성 후 즉시 sync | `npx --yes openapi-k6 init --base-url <url> --openapi <path-or-url> --sync` |
| OpenAPI snapshot/catalog 갱신 | `npx --yes openapi-k6 sync` |
| endpoint 검색 | `npx --yes openapi-k6 catalog --query <검색어>` |
| AI용 scenario 초안 | `npx --yes openapi-k6 catalog --query <검색어> --ai` |
| 최신 sync 후 AI용 scenario 초안 | `npx --yes openapi-k6 catalog --sync --query <검색어> --ai` |
| 정적 검증 | `npx --yes openapi-k6 validate -s <scenario-key>` |
| 실행 검증 | `npx --yes openapi-k6 test -s <scenario-key>` |
| 정적 검증 후 k6 스크립트 생성 | `npx --yes openapi-k6 generate -s <scenario-key>` |
| 검증+생성+실행 편의 명령 | `npx --yes openapi-k6 run -s <scenario-key>` |
| 로컬 UI | `npx --yes openapi-k6 ui` |
| 점검 | `npx --yes openapi-k6 doctor` |
| scaffold 갱신 | `npx --yes openapi-k6 update` |
| Codex 스킬 설치 | `npx --yes openapi-k6 install-skill --yes` |

## k6 명령 모음

먼저 scenario를 k6 스크립트로 생성합니다.

```bash
npx --yes openapi-k6 generate -s <scenario-key>
```

| 상황 | 명령 |
| --- | --- |
| 1회 smoke | `k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 1 --iterations 1` |
| 30초 짧은 부하 | `k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 10 --duration 30s` |
| 부하 증가/감소 | `k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --stage 30s:10 --stage 1m:50 --stage 30s:0` |
| summary JSON 저장 | `k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 10 --duration 30s --summary-export openapi-k6/logs/<scenario-key>-summary.json` |
| 실시간 Web Dashboard | `K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_OPEN=true k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 10 --duration 30s` |
| HTML report 저장 | `K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=openapi-k6/logs/<scenario-key>-report.html k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 10 --duration 30s` |

## 지원 범위

- Node.js 20 이상
- OpenAPI 3.x 문서
- 검증과 실행 시 접근 가능한 백엔드 서버
- k6 스크립트 실행용 k6 별도 설치
- Swagger/OpenAPI 2.0 문서는 지원하지 않습니다.

이 도구의 목표는 범용 API 테스트 플랫폼이 아니라 OpenAPI 기반 scenario 검증과 k6 스크립트 생성입니다.

`init` 후 생성되는 작업공간 README.md에는 선택한 디렉터리와 module 이름이 반영된 작업 안내가 들어 있습니다.

## 참고문서

- [변경 이력](https://github.com/aqwsde321/openapi-k6-runner/blob/main/CHANGELOG.md)
- [문서 색인](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/README.md)
- [도구 개발/유지보수](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/03-maintainer-notes.md)
