# openapi-k6

OpenAPI 스펙에서 테스트할 API를 고르고, 사람이 읽기 쉬운 Scenario DSL로 API 흐름을 먼저 검증한 뒤, 통과한 시나리오를 k6 부하 테스트로 실행하게 만드는 CLI 도구입니다.

이 프로젝트는 백엔드 프로젝트마다 반복되는 API 시나리오 검증과 부하 테스트 준비 작업을 줄이기 위해 만들었습니다. 백엔드 루트에 `load-tests/` 폴더를 만들고, OpenAPI snapshot, scenario YAML, scenario test 결과, generated k6 script를 한곳에서 관리하게 합니다.

## 용도

- OpenAPI endpoint catalog를 만들어 테스트할 API를 쉽게 고릅니다.
- YAML scenario로 로그인, 조회, 주문 같은 API 흐름을 작성합니다.
- `openapi-k6 test`로 실제 API를 1회 호출해 scenario 흐름, condition, extract, template 값을 검증합니다.
- 검증을 통과한 scenario YAML을 k6 JavaScript로 생성합니다.
- 비밀번호나 토큰 같은 값은 `{{env.NAME}}` 템플릿으로 분리해 `load-tests/.env`에만 둡니다.

## 핵심 흐름

```text
OpenAPI snapshot/catalog
  -> scenario YAML 작성
  -> scenario test로 API 흐름 검증
  -> k6 script 생성
  -> k6 부하 테스트 실행
```

`openapi-k6 test`는 보조 명령이 아니라 k6 실행 전 필수 확인 단계입니다. 여기서 실제 백엔드에 요청을 보내 status, condition, extract, template 치환을 먼저 확인하고, 통과한 scenario만 부하 테스트 스크립트로 넘기는 흐름을 기준으로 합니다.

## 빠른 시작

백엔드 프로젝트 루트에서 실행합니다.

```bash
cd /path/to/backend-project
npx --yes openapi-k6 init
```

생성된 `load-tests/config.yaml`의 TODO 값을 채운 뒤, 기본 흐름은 아래 순서입니다.

```bash
npx --yes openapi-k6 sync
npx --yes openapi-k6 test -s smoke
npx --yes openapi-k6 generate -s smoke
./load-tests/run.sh smoke --log
```

`npx --yes openapi-k6`는 매번 npm 배포 버전을 받아 실행합니다. 같은 버전을 프로젝트에 고정하고 싶으면 devDependency로 설치한 뒤 `pnpm exec`를 사용합니다.

```bash
pnpm add -D openapi-k6
pnpm exec openapi-k6 --help
```

npm 배포 버전이 아니라 현재 저장소 코드를 직접 실행하려면 [도구 개발/유지보수](docs/03-maintainer-notes.md)를 참고하세요.

생성된 k6 스크립트를 실행하려면 별도로 k6가 설치되어 있어야 합니다.

## 백엔드 프로젝트에 추가하기

테스트할 백엔드 프로젝트 루트에서 한 번만 실행합니다.

```bash
npx --yes openapi-k6 init
```

생성되는 파일과 이후 직접 만들 파일:

- `load-tests/config.yaml`
- `load-tests/.env.example`
- `load-tests/.env`는 생성되지 않습니다. 비밀 값이 필요할 때 `.env.example`을 복사해서 직접 만듭니다.
- `load-tests/.gitignore`
- `load-tests/run.sh`
- `load-tests/scenarios/smoke.yaml`
- `load-tests/README.md`

기존 scaffold 관리 파일은 덮어쓰지 않습니다. 다시 만들려면 `--force`를 명시합니다.

```bash
npx --yes openapi-k6 init --force
```

`--force`는 `config.yaml`, `.env.example`, `.gitignore`, `run.sh`, `scenarios/smoke.yaml`, `README.md`만 다시 씁니다. `.env`, `openapi/`, `generated/`, `logs/`, 추가 scenario 파일은 지우지 않습니다.

### `.env` 위치

`load-tests/run.sh`는 `run.sh`와 같은 폴더의 `load-tests/.env`만 source합니다. 백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다.

```bash
cp load-tests/.env.example load-tests/.env
```

scenario YAML에서 `{{env.LOGIN_PASSWORD}}`처럼 참조한 값은 `load-tests/.env`에 `LOGIN_PASSWORD=...` 형식으로 작성합니다. 루트 `.env` 값을 재사용하려면 필요한 키만 `load-tests/.env`로 복사하거나, 실행 전에 shell에서 직접 export합니다.

## 다음 단계는 AI에게 맡기기

`npx --yes openapi-k6 init` 후에는 생성된 `load-tests/README.md`가 실제 작업 가이드입니다. AI에게 아래 프롬프트를 복사해서 붙여넣으면 됩니다.

기본 smoke 테스트를 만들 때:

```text
Read load-tests/README.md first and follow it.
Fill TODO values in load-tests/config.yaml for this backend project.
Run the OpenAPI snapshot command from load-tests/README.md to create the catalog.
Read load-tests/openapi/*.catalog.json and choose one unauthenticated GET endpoint.
Update load-tests/scenarios/smoke.yaml for that endpoint.
Run the scenario validation command from load-tests/README.md before generating k6.
Do not generate or run k6 until the scenario validation passes.
Run the k6 script generation command from load-tests/README.md.
Do not edit load-tests/README.md, load-tests/run.sh, load-tests/.env.example, or load-tests/.gitignore unless explicitly asked to change scaffold files.
Do not edit load-tests/generated/*.k6.js or load-tests/openapi/*.openapi.json directly.
Keep human-facing documentation in Korean. Keep AI instruction sections in English.
```

새 시나리오를 만들 때:

```text
Read load-tests/README.md and load-tests/openapi/*.catalog.json.
Create load-tests/scenarios/basic-read.yaml for one read endpoint that can be called without login.
Validate the scenario using the command documented in load-tests/README.md.
Do not generate or run k6 until the scenario validation passes.
Generate the k6 script using the command documented in load-tests/README.md.
Do not edit load-tests/README.md, load-tests/run.sh, load-tests/.env.example, or load-tests/.gitignore unless explicitly asked to change scaffold files.
Do not edit load-tests/generated/*.k6.js directly.
Keep human-facing documentation in Korean. Keep AI instruction sections in English.
```

로그인이 필요한 흐름을 만들 때:

```text
Read load-tests/README.md and load-tests/openapi/*.catalog.json.
Find the login API and one authenticated read API.
Create a login-flow scenario.
Extract the token from the login response.
Use Bearer {{token}} in the Authorization header of the next step.
Use {{env.NAME}} for secrets and keep real values in load-tests/.env only.
Validate the scenario using the command documented in load-tests/README.md.
Do not generate or run k6 until the scenario validation passes.
Generate the k6 script using the command documented in load-tests/README.md.
Do not edit load-tests/README.md, load-tests/run.sh, load-tests/.env.example, or load-tests/.gitignore unless explicitly asked to change scaffold files.
Do not edit load-tests/generated/*.k6.js directly.
Keep human-facing documentation in Korean. Keep AI instruction sections in English.
```

## 생성 후 구조

```text
backend-project/
└── load-tests/
    ├── README.md
    ├── config.yaml
    ├── .env.example
    ├── .env          # 필요 시 직접 생성, git commit 금지
    ├── .gitignore
    ├── run.sh
    ├── openapi/
    │   ├── default.openapi.json
    │   └── default.catalog.json
    ├── scenarios/
    │   └── smoke.yaml
    └── generated/
        └── smoke.k6.js
```

루트 README는 여기까지만 안내합니다. 실제 config 작성, OpenAPI sync, scenario 작성, scenario test, k6 script 생성, k6 실행은 `load-tests/README.md`를 기준으로 진행합니다.

## 알아둘 점

- `config.yaml` 안의 상대 경로는 `config.yaml`이 있는 디렉터리 기준으로 해석됩니다.
- `sync`는 외부 파일이나 URL을 가리키는 `$ref`를 snapshot 내부 참조로 묶어 저장합니다.
- `pathParams` 값은 URL path segment로 encode되어 `/`, 공백, `?`, `#` 등이 URL 구조를 깨지 않습니다.
- `npx --yes openapi-k6 generate`는 config의 `baseUrl`을 생성된 k6 스크립트의 기본값으로 넣습니다. k6 실행 시 `BASE_URL=... k6 run ...`처럼 환경 변수를 넘기면 이 기본값보다 우선합니다.
- `npx --yes openapi-k6 test -s <scenario>`는 k6 파일을 만들기 전에 scenario YAML을 Node.js에서 1회 직접 실행해 API 흐름을 검증하는 gate입니다. 실행 중 step 로그와 최종 결과를 CLI에 바로 보여줍니다.
- 실제 비밀 값은 scenario YAML에 쓰지 말고 `{{env.NAME}}`으로 참조합니다. `load-tests/run.sh`는 `load-tests/.env`만 자동으로 읽으며, 백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다.
- `multipart/form-data` 파일 업로드는 scenario YAML의 `request.multipart`로 작성합니다. 파일 경로는 `load-tests/` 기준이며, 기본 fixture 위치는 `load-tests/fixtures/`입니다.
- 생성된 k6 스크립트는 각 step을 k6 `group()`으로 묶고, 요청에 `openapi_scenario`, `openapi_step`, `openapi_method`, `openapi_path`, `openapi_api` tag를 붙입니다.
- 생성된 k6 스크립트는 `condition` 실패 시 scenario, step, method, path, status, URL, duration, 응답 body 일부를 console error로 출력합니다.
- `load-tests/run.sh <scenario> --log`를 사용하면 k6 출력이 `load-tests/logs/<scenario>.log`에도 저장됩니다.
- `load-tests/run.sh <scenario> --trace`를 사용하면 step 시작/종료 로그가 출력됩니다.
- `load-tests/run.sh <scenario> --report`를 사용하면 k6 Web Dashboard HTML report가 `load-tests/logs/<scenario>-report.html`에 저장됩니다.
- `{{env.NAME}}` 값을 쓰려면 `cp load-tests/.env.example load-tests/.env`로 `run.sh` 옆에 `.env`를 만든 뒤 값을 채웁니다.

## 문서

- [문서 색인](docs/README.md)
- [도구 개발/유지보수](docs/03-maintainer-notes.md)
- [MVP 설계](docs/spec/mvp-design.md)
- [기능 세분화](docs/spec/feature-breakdown.md)
- [작업 계획](docs/planning/work-plan.md)
- [참조 프로젝트 분석](docs/reference/reference-projects.md)
