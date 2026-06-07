# openapi-k6

[![npm version](https://img.shields.io/npm/v/openapi-k6?label=npm)](https://www.npmjs.com/package/openapi-k6)
[![Publish](https://github.com/aqwsde321/openapi-k6-runner/actions/workflows/publish.yml/badge.svg)](https://github.com/aqwsde321/openapi-k6-runner/actions/workflows/publish.yml)

OpenAPI에서 API 흐름을 **Scenario YAML**로 작성하고, k6 실행 전에 `validate`와 `test`로 먼저 검증하는 CLI입니다.

핵심 흐름은 단순합니다.

```text
OpenAPI 가져오기 -> scenario 작성 -> validate/test -> run
```

## 빠른 시작

백엔드 프로젝트 루트에서 실행합니다.
처음 적용하는 프로젝트는 `init`부터 실행하고, 이미 `load-tests/`가 있는 프로젝트는 `init`을 다시 실행하지 말고 `update`로 scaffold 안내만 갱신합니다.

```bash
npx --yes openapi-k6 init
npx --yes openapi-k6 sync
npx --yes openapi-k6 catalog --query <검색어>
# load-tests/scenarios/<scenario-name>.yaml 작성
npx --yes openapi-k6 validate -s <scenario-name>
npx --yes openapi-k6 test -s <scenario-name>
npx --yes openapi-k6 run -s <scenario-name> --log -- --vus 1 --iterations 1
```

`<검색어>`는 endpoint를 찾을 단어이고, `<scenario-name>`은 `load-tests/scenarios/<scenario-name>.yaml`에서 확장자를 뺀 이름입니다.
아래 예시는 이해를 돕기 위한 값입니다. 실제 명령에는 위 placeholder를 프로젝트에 맞게 바꿔 넣습니다.

`run`은 k6 설치가 필요합니다. 스크립트만 만들려면 아래 명령을 씁니다.

```bash
npx --yes openapi-k6 generate -s <scenario-name>
```

기존 프로젝트에서 CLI가 `Scaffold update available`을 표시하면 안내된 `update` 명령을 실행하면 됩니다.

```bash
npx --yes openapi-k6 update
```

## 1. 작업 공간 만들기

```bash
npx --yes openapi-k6 init
```

`init`은 백엔드 프로젝트 안에 `load-tests/`를 만들고 API 기본 주소를 묻습니다.
이미 `load-tests/`가 있으면 `init --force`로 덮어쓰지 말고 먼저 `npx --yes openapi-k6 update`를 사용합니다.

```text
API base URL [http://localhost:8080]: https://api.example.com
```

Swagger UI 주소가 아니라 실제 API 요청의 기본 주소를 입력합니다.
OpenAPI 문서를 자동으로 찾지 못하면 OpenAPI JSON/YAML URL이나 파일 경로를 입력합니다.
지금 모르면 `skip`으로 넘어간 뒤 `load-tests/config.yaml`을 직접 채웁니다.

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

아래는 검색어 `login`을 사용한 출력 예시입니다.

```text
Catalog: load-tests/openapi/default.catalog.json
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

`init`은 기본 예시인 `load-tests/scenarios/smoke.yaml`을 만듭니다.
처음 확인은 이 파일을 수정해도 되고, 실제 흐름은 새 YAML 파일로 만들어도 됩니다.

최소 필드는 `id`, `api`, `request`, `extract`, `condition`입니다.

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

`{{env.*}}` 값은 `test` 전에 `load-tests/.env`에 둡니다.
비밀값은 scenario YAML에 직접 쓰지 않습니다.

## 4. 검증과 실행

| 명령 | API 호출 | k6 필요 | 목적 |
| --- | --- | --- | --- |
| `validate` | 없음 | 없음 | YAML과 OpenAPI 정합성 확인 |
| `test` | 있음 | 없음 | 실제 API 흐름을 1회 실행 |
| `generate` | 없음 | 없음 | k6 스크립트 생성 |
| `run` | 있음 | 있음 | k6 실행 |

```bash
npx --yes openapi-k6 validate -s <scenario-name>
npx --yes openapi-k6 test -s <scenario-name>
npx --yes openapi-k6 run -s <scenario-name> --log -- --vus 1 --iterations 1
```

`test`가 통과한 scenario만 `run`하거나 `generate`하는 흐름을 권장합니다.

## 필요할 때만

| 필요 | 사용 |
| --- | --- |
| 브라우저에서 scenario 선택/검증 | `npx --yes openapi-k6 ui` |
| 반복 값 관리 | scenario `vars:` 또는 `--var-file`, `--var` |
| 공통 step 재사용 | `steps` 안에서 `- include: ./partials/login.yaml` |
| 여러 서버 연결 | `npx --yes openapi-k6 module add auth --base-url <url> --sync` |
| 작업 공간 점검 | `npx --yes openapi-k6 doctor` |
| 기존 scaffold 안전 갱신 | CLI가 `Scaffold update available`을 표시하면 `npx --yes openapi-k6 update` |

include와 fixture 경로는 실행하는 scenario 파일 기준 상대 경로이며, scenario 디렉터리 밖으로 나갈 수 없습니다.
여러 OpenAPI module을 한 scenario에서 섞을 때는 step의 `api.module`을 지정합니다.

아래 기능은 [고급 기능](docs/advanced-usage.md)에서 예시를 봅니다.

- `vars`/`fixtures`와 CLI override
- 공통 step `include`
- 여러 서버를 연결하는 module
- UI, doctor, update
- `generate`와 `run.sh`

## 파일 규칙

보통 직접 수정하는 파일은 아래 세 가지입니다.

- `load-tests/config.yaml`
- `load-tests/.env`
- `load-tests/scenarios/*.yaml`

아래 파일은 직접 고치기보다 명령으로 다시 만듭니다.

- `load-tests/openapi/*.openapi.json`: `sync` 생성물
- `load-tests/openapi/*.catalog.json`: `sync` 생성물
- `load-tests/generated/*.k6.js`: `generate` 생성물

`load-tests/.env`는 생성되지 않습니다.
비밀값이 필요하면 `load-tests/.env.example`을 참고해 직접 만들고 commit하지 않습니다.

기본 `load-tests/.gitignore`는 `scenarios/**`만 추적 대상에 남기고 scaffold/config/생성물은 제외합니다.
전체 작업 공간을 git에 포함하려면 ignore 규칙을 조정합니다.

## 명령 모음

| 상황 | 명령 |
| --- | --- |
| 작업 공간 생성 | `npx --yes openapi-k6 init` |
| OpenAPI snapshot/catalog 갱신 | `npx --yes openapi-k6 sync` |
| endpoint 검색 | `npx --yes openapi-k6 catalog --query <검색어>` |
| 정적 검증 | `npx --yes openapi-k6 validate -s <scenario-name>` |
| 실행 검증 | `npx --yes openapi-k6 test -s <scenario-name>` |
| k6 스크립트 생성 | `npx --yes openapi-k6 generate -s <scenario-name>` |
| k6 실행 | `npx --yes openapi-k6 run -s <scenario-name> --log -- --vus 1` |
| 로컬 UI | `npx --yes openapi-k6 ui` |
| 점검 | `npx --yes openapi-k6 doctor` |
| scaffold 갱신 | `npx --yes openapi-k6 update` |

## 지원 범위

- Node.js 20 이상
- OpenAPI 3.x 문서
- 검증과 실행 시 접근 가능한 백엔드 서버
- k6 스크립트 실행용 k6 별도 설치
- Swagger/OpenAPI 2.0 문서는 지원하지 않습니다.

이 도구의 목표는 범용 API 테스트 플랫폼이 아니라 OpenAPI 기반 scenario 검증과 k6 스크립트 생성입니다.

## AI에게 맡기기

AI coding agent에게는 아래처럼 요청하면 됩니다.

```text
이 백엔드 프로젝트에 openapi-k6 Scenario YAML 검증과 k6 부하 테스트 준비를 적용해줘.

1. 먼저 이 openapi-k6 루트 README와 docs/advanced-usage.md를 읽어.
2. 모든 명령은 적용할 백엔드 프로젝트 루트에서 실행해.
3. 백엔드 프로젝트에 load-tests/README.md가 없으면 npx --yes openapi-k6 init을 실행해.
   baseUrl 또는 OpenAPI spec URL을 확실히 모르면 나에게 물어봐.
   이미 load-tests/README.md가 있으면 init을 다시 실행하지 말고 기존 문서를 먼저 읽어.
4. CLI가 Scaffold update available을 표시하거나 scaffold README/runner를 최신화해야 하면 npx --yes openapi-k6 update를 실행해.
5. init 또는 update 후 백엔드 프로젝트의 load-tests/README.md를 다시 읽고, 그 문서의 실제 경로와 명령을 기준으로 진행해.
6. load-tests/config.yaml에 TODO가 남아 있으면 실제 API 정보로 채워.
7. npx --yes openapi-k6 sync로 OpenAPI snapshot과 catalog를 만들어.
8. npx --yes openapi-k6 catalog --query <검색어>로 endpoint 후보를 확인해. 필요하면 load-tests/openapi/*.catalog.json도 열어봐.
9. 내가 원하는 API 흐름을 확인한 뒤 load-tests/scenarios/*.yaml을 작성하거나 수정해.
   처음에는 id, api, request, extract, condition만 채워.
   operationId가 없거나 애매하면 api.method와 api.path를 사용해.
   같은 값이나 같은 step이 반복될 때만 vars, fixtures, include를 사용해.
   include 파일에는 vars:나 fixtures:를 두지 말고, 변수는 실행하는 scenario 파일에서 관리해.
   여러 서버를 이어야 할 때만 module add와 api.module을 사용해.
10. 비밀값은 scenario YAML에 직접 쓰지 말고 {{env.NAME}}으로 참조해. 실제 값은 load-tests/.env에만 둬.
11. npx --yes openapi-k6 validate -s <scenario-name>으로 YAML/OpenAPI 정합성을 먼저 확인해.
12. npx --yes openapi-k6 test -s <scenario-name>으로 실제 API 흐름을 검증해.
13. validate와 test가 통과하기 전에는 run이나 generate를 하지 마.
14. 통과한 scenario만 npx --yes openapi-k6 run -s <scenario-name> --log -- --vus 1 --iterations 1로 짧게 실행해.
    스크립트만 필요하면 npx --yes openapi-k6 generate -s <scenario-name>을 사용해.
15. 장시간 부하 테스트는 내가 요청하기 전에는 실행하지 말고, 실행 명령과 확인 포인트만 알려줘.
16. load-tests/README.md, load-tests/run.sh, load-tests/.env.example, load-tests/.gitignore, load-tests/.openapi-k6.json은 scaffold 파일이므로 명시 요청 없이는 수정하지 마.
    load-tests/openapi/*.openapi.json, load-tests/openapi/*.catalog.json, load-tests/generated/*.k6.js도 직접 수정하지 말고 sync/generate로 다시 만들어.
```

`init` 후 생성되는 `load-tests/README.md`에는 선택한 디렉터리와 module 이름이 반영된 작업 안내가 들어 있습니다.

## 참고문서

- [변경 이력](https://github.com/aqwsde321/openapi-k6-runner/blob/main/CHANGELOG.md)
- [문서 색인](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/README.md)
- [도구 개발/유지보수](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/03-maintainer-notes.md)
