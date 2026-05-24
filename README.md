# openapi-k6

OpenAPI에서 API 흐름을 **Scenario YAML**로 만들고, k6 실행 전에 검증한 뒤, 통과한 시나리오만 부하 테스트로 넘기는 CLI입니다.

`openapi-k6`의 중심은 k6 파일 생성이 아니라 scenario 작성과 검증입니다. 로그인 -> 토큰 추출 -> 인증 API 호출 같은 흐름을 사람이 읽기 쉬운 YAML로 연결하고, 먼저 OpenAPI snapshot과 대조한 뒤 백엔드에 요청해 실패 원인을 확인합니다.

## 한눈에 보기

```text
init -> sync -> catalog 검색 -> scenario YAML 수정 -> validate -> test -> run
```

| 단계 | 명령 | 하는 일 |
| --- | --- | --- |
| 1 | `npx --yes openapi-k6 init` | 백엔드 프로젝트에 `load-tests/` 생성 |
| 2 | `npx --yes openapi-k6 sync` | OpenAPI snapshot과 endpoint catalog 생성 |
| 3 | `npx --yes openapi-k6 catalog --query login` | scenario에 쓸 endpoint 후보 검색 |
| 4 | `load-tests/scenarios/smoke.yaml` 수정 | catalog 기준으로 API 흐름 작성 |
| 5 | `npx --yes openapi-k6 validate -s smoke` | OpenAPI snapshot 기준 정적 검증 |
| 6 | `npx --yes openapi-k6 test -s smoke` | Node.js에서 scenario 1회 실행 검증 |
| 7 | `npx --yes openapi-k6 run -s smoke --log -- --vus 1` | 정적 검증, k6 스크립트 생성, k6 실행 |
| 8 | `npx --yes openapi-k6 generate -s smoke`, `./load-tests/run.sh smoke --log` | 스크립트만 생성하거나 runner로 실행 |

`openapi-k6 validate`와 `openapi-k6 test`는 보조 명령이 아니라 k6 실행 전 검증 관문입니다. `validate`는 API 호출 없이 operation/path/query/header/body 정합성, context template 참조, condition/extract 문법을 확인하고, `test`는 URL, header, query, path, body, 환경변수, condition, extract를 실제 요청으로 확인합니다.

## 핵심 기능

| 기능 | 역할 |
| --- | --- |
| Scenario YAML | 로그인, 추출, 인증 요청 같은 API 흐름을 YAML로 표현합니다. |
| 재사용 step include | 로그인/seed 같은 공통 step YAML을 여러 scenario에서 include해 반복을 줄입니다. |
| 검증 관문 | k6 실행 전에 OpenAPI 정합성, 요청 구성, 추출, 설정 오류를 잡습니다. |
| OpenAPI catalog | `catalog` 명령으로 scenario에 쓸 `operationId`, `method`, `path`를 찾습니다. |
| 멀티모듈/멀티서버 | `module add`와 `api.module`로 서로 다른 OpenAPI/Swagger 서버를 하나의 scenario에서 연결합니다. |
| `load-tests/` 작업 공간 | config, scenario, snapshot, 생성된 k6 스크립트, runner를 백엔드 프로젝트 안에서 관리합니다. |
| AI 작업 프롬프트 | 루트 README에서 시작하고 생성 README로 이어지는 작업 지침을 제공합니다. |

## 지원 범위

- Node.js 20 이상
- OpenAPI 3.x 문서
- 검증과 실행 시 접근 가능한 백엔드 서버
- k6 스크립트 실행용 k6 별도 설치
- Swagger/OpenAPI 2.0 문서는 지원하지 않습니다.
- 목표는 범용 API 테스트 플랫폼이 아니라 OpenAPI 기반 scenario 검증과 k6 스크립트 생성입니다.

## 빠른 시작

### 1. 작업 공간 생성

```bash
npx --yes openapi-k6 init
```

백엔드 프로젝트 루트에서 실행합니다. 대화형 터미널에서는 `baseUrl`만 묻고 `<baseUrl>/v3/api-docs`가 OpenAPI 3.x JSON인지 확인합니다. 실패하면 `/api-docs`, `/openapi.json`, `/swagger.json` 같은 흔한 경로를 자동으로 시도하고, 그래도 찾지 못할 때만 OpenAPI spec URL 또는 파일 경로를 묻습니다.

### 2. 설정 확인

OpenAPI URL이 확인되면 `load-tests/config.yaml`의 `baseUrl`과 `modules.<name>.openapi`가 채워집니다. 자동 탐색이 실패하면 CLI 안내에 따라 URL/파일 경로를 입력하거나 `skip`으로 넘어간 뒤 config를 나중에 수정할 수 있습니다.

### 3. OpenAPI snapshot/catalog 생성

```bash
npx --yes openapi-k6 sync
```

### 4. Scenario 작성/수정

`catalog` 명령으로 테스트할 endpoint의 `operationId`, `method`, `path`, request body 여부를 확인합니다.

```bash
npx --yes openapi-k6 catalog --query login
npx --yes openapi-k6 catalog --tag auth
```

그 다음 `load-tests/scenarios/smoke.yaml`을 API 흐름에 맞게 수정합니다. 전체 catalog 파일은 `load-tests/openapi/*.catalog.json`에 있습니다.

반복되는 로그인, seed, cleanup 흐름은 별도 YAML로 분리한 뒤 scenario의 원하는 위치에서 include할 수 있습니다. include 경로는 entry scenario 파일 기준 상대 경로이며, entry scenario 디렉터리 안에 있어야 합니다.

```yaml
name: order-flow

steps:
  - include: ./partials/login.yaml
  - id: create-order
    api:
      operationId: createOrder
    request:
      headers:
        Authorization: "Bearer {{token}}"
```

`partials/login.yaml`은 `name` 없이 `steps`만 둘 수 있고, 포함된 step의 `extract` 값은 뒤 step에서 그대로 참조할 수 있습니다.

### 5. Scenario 정적 검증

```bash
npx --yes openapi-k6 validate -s smoke
```

`validate`는 백엔드에 요청하지 않고 scenario YAML을 OpenAPI snapshot과 대조합니다. AI가 작성한 YAML은 먼저 여기서 `operationId`, `method/path`, 필수 path/query/header/body 누락, `{{token}}` 같은 context template 참조, `condition`, `extract.from` 문법을 확인합니다.

### 6. Scenario 실행 검증

```bash
npx --yes openapi-k6 test -s smoke
```

`test`가 통과해야 k6 스크립트를 생성하거나 실행합니다.

### 7. k6 실행

```bash
npx --yes openapi-k6 run -s smoke --log -- --vus 1 --iterations 1
```

`run`은 scenario를 정적 검증하고, k6 스크립트를 다시 생성한 뒤 `k6 run`을 실행합니다. k6 옵션은 `--` 뒤에 붙입니다.

스크립트만 생성하거나 scaffold runner를 직접 쓰려면 기존 흐름도 그대로 사용할 수 있습니다.

```bash
npx --yes openapi-k6 generate -s smoke
./load-tests/run.sh smoke --log
```

k6 스크립트 실행에는 k6 설치가 필요합니다.

### 여러 백엔드 서버를 연결할 때

인증 서버와 업무 서버처럼 Swagger/OpenAPI 주소가 다른 백엔드를 하나의 scenario에서 이어야 하면 module을 추가합니다.

```bash
npx --yes openapi-k6 module add auth --base-url https://auth-api.example.com --sync
npx --yes openapi-k6 module add bos --base-url https://bos-api.example.com --sync
npx --yes openapi-k6 module list
```

scenario step에는 사용할 module을 명시합니다.

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

생성된 k6 스크립트는 `BASE_URL_AUTH`, `BASE_URL_BOS` 같은 module별 환경변수를 먼저 읽습니다. 같은 `operationId`가 여러 module에 있어도 step의 `api.module` 안에서만 찾습니다.

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

여러 OpenAPI module을 하나의 흐름에서 섞어야 하면 step의 `api.module`을 지정합니다. 지정하지 않은 step은 기존처럼 `--module`, `defaultModule`, 단일 module 추론 순서로 module을 선택합니다.

새 module은 config를 직접 편집하지 않고 CLI로 추가할 수 있습니다.

```bash
npx --yes openapi-k6 module add auth --base-url https://auth-api.example.com --sync
npx --yes openapi-k6 module list
npx --yes openapi-k6 module set-default auth
npx --yes openapi-k6 module remove auth
```

`--openapi`를 생략하면 `--base-url` 기준으로 `/v3/api-docs`, `/api-docs`, `/openapi.json` 같은 흔한 경로를 자동 탐색합니다. 사내 Swagger 경로가 다르면 `--openapi <url-or-path>`를 명시하면 됩니다.

`module remove`는 config 항목만 제거하고 snapshot/catalog 파일은 삭제하지 않습니다. 현재 `defaultModule`이거나 scenario에서 참조 중인 module은 기본적으로 삭제를 막고, 의도한 경우에만 `--force`로 제거합니다.

자동화나 UI adapter가 현재 module 구성을 읽어야 하면 `--json`을 사용합니다.

```bash
npx --yes openapi-k6 module list --json
```

출력에는 `configPath`, `defaultModule`, `modules[]`가 포함되고, 각 module은 `name`, `isDefault`, `baseUrl`, `openapi`, `snapshot`, `catalog` 필드를 가집니다.

```yaml
steps:
  - id: login
    api:
      module: auth
      operationId: loginUser

  - id: create-order
    api:
      module: bos
      operationId: createOrder
    request:
      headers:
        Authorization: "Bearer {{token}}"
```

생성된 k6 스크립트에서 multi-module scenario는 `BASE_URL_AUTH`, `BASE_URL_BOS`처럼 module별 환경변수를 먼저 읽고, 없으면 기존 `BASE_URL`과 config 기본값을 순서대로 사용합니다.

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
| `load-tests/scenarios/smoke.yaml` | 기본 scenario YAML |
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
| scenario용 endpoint 검색 | `npx --yes openapi-k6 catalog --query login` |
| scenario 정적 검증 | `npx --yes openapi-k6 validate -s <name>` |
| scenario 실행 검증 | `npx --yes openapi-k6 test -s <name>` |
| 정적 검증, 생성, k6 실행 | `npx --yes openapi-k6 run -s <name> --log -- --vus 1` |
| k6 스크립트 생성 | `npx --yes openapi-k6 generate -s <name>` |
| k6 설치 후 실행 | `./load-tests/run.sh <name> --log` |
| 기존 scaffold 안전 갱신 | `npx --yes openapi-k6 update` |
| scaffold 파일 재생성 | `npx --yes openapi-k6 init --force` |

## AI에게 맡기기

AI coding agent에게 아래 프롬프트를 붙여넣으세요. `load-tests/README.md`가 없어도 시작할 수 있습니다.

```text
이 백엔드 프로젝트에 openapi-k6 Scenario YAML 검증과 k6 부하 테스트 준비를 적용해줘.

1. 먼저 이 README의 빠른 시작과 지원 범위를 읽어.
2. 모든 명령은 백엔드 프로젝트 루트에서 실행해.
3. 아직 load-tests/README.md가 없으면 npx --yes openapi-k6 init을 실행해.
   baseUrl 또는 OpenAPI spec URL을 확실히 모르면 나에게 물어봐.
4. init 후 생성된 load-tests/README.md를 읽고, 그 문서의 작업 순서와 규칙을 기준으로 진행해.
5. load-tests/config.yaml에 TODO가 남아 있으면 이 백엔드 프로젝트에 맞게 채워.
6. npx --yes openapi-k6 sync를 실행해서 OpenAPI snapshot과 catalog를 생성해.
7. npx --yes openapi-k6 catalog --query login처럼 적절한 검색어로 테스트할 endpoint 후보를 확인해. 필요하면 load-tests/openapi/*.catalog.json도 열어봐.
8. 내가 원하는 API 흐름을 확인한 뒤 load-tests/scenarios/*.yaml을 작성하거나 수정해.
   반복되는 로그인/seed 흐름은 load-tests/scenarios/partials/*.yaml로 분리하고 steps에서 - include: ./partials/login.yaml로 재사용해.
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

`init` 후 생성되는 `load-tests/README.md`에는 선택한 디렉터리, module 이름, config 경로가 반영된 더 구체적인 AI 작업 프롬프트가 들어 있습니다. 작업 중간부터는 생성 README를 기준으로 따르세요.

## 참고문서

- [변경 이력](https://github.com/aqwsde321/openapi-k6-runner/blob/main/CHANGELOG.md)
- [문서 색인](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/README.md)
- [도구 개발/유지보수](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/03-maintainer-notes.md)
- [MVP 설계](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/spec/mvp-design.md)
- [기능 세분화](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/spec/feature-breakdown.md)
- [작업 계획](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/planning/work-plan.md)
- [참조 프로젝트 분석](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/reference/reference-projects.md)
