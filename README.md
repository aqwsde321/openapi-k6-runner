# openapi-k6-runner

OpenAPI 스펙과 사람이 읽기 쉬운 Scenario DSL로 k6 실행 스크립트를 생성하는 CLI 도구입니다.

이 프로젝트는 백엔드 프로젝트마다 반복되는 부하 테스트 준비 작업을 줄이기 위해 만들었습니다. 백엔드 루트에 `load-tests/` 폴더를 만들고, OpenAPI snapshot, scenario YAML, generated k6 script를 한곳에서 관리하게 합니다.

## 용도

- OpenAPI endpoint catalog를 만들어 테스트할 API를 쉽게 고릅니다.
- YAML scenario로 로그인, 조회, 주문 같은 API 흐름을 작성합니다.
- scenario YAML을 k6 JavaScript로 생성합니다.
- 비밀번호나 토큰 같은 값은 `{{env.NAME}}` 템플릿으로 분리해 `load-tests/.env`에만 둡니다.

## 설치

개발 중에는 이 저장소에서 의존성을 설치하고 빌드한 뒤 전역 link로 CLI를 연결합니다.

```bash
cd /path/to/openapi-k6-runner
pnpm install
pnpm run build
pnpm link --global
openapi-k6 --help
```

`pnpm link --global`은 보통 한 번만 실행하면 됩니다. 이후에는 상황별로 generator 저장소에서 갱신합니다.

로컬 코드만 수정했을 때:

```bash
pnpm run build
```

generator 저장소를 pull/checkout해서 새 버전으로 업데이트했을 때:

```bash
pnpm install
pnpm run build
```

개발 중 수동 빌드가 번거로우면 별도 터미널에서 watch 빌드를 켜둡니다.

```bash
pnpm run build:watch
```

<details>
<summary>`pnpm link --global`에서 global bin directory 오류가 날 때</summary>

pnpm shell 설정을 적용한 뒤 다시 link합니다.

```bash
pnpm setup
source ~/.zshrc
pnpm link --global
openapi-k6 --help
```

</details>

전역 link를 쓰지 않는 환경에서는 빌드된 CLI를 직접 실행할 수 있습니다.

```bash
node /path/to/openapi-k6-runner/dist/cli/index.js --help
```

생성된 스크립트를 실행하려면 별도로 k6가 설치되어 있어야 합니다.

## 백엔드 프로젝트에 추가하기

테스트할 백엔드 프로젝트 루트에서 한 번만 실행합니다.

```bash
cd /path/to/backend-project
openapi-k6 init
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
openapi-k6 init --force
```

`--force`는 `config.yaml`, `.env.example`, `.gitignore`, `run.sh`, `scenarios/smoke.yaml`, `README.md`만 다시 씁니다. `.env`, `openapi/`, `generated/`, `logs/`, 추가 scenario 파일은 지우지 않습니다.

### `.env` 위치

`load-tests/run.sh`는 `run.sh`와 같은 폴더의 `load-tests/.env`만 source합니다. 백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다.

```bash
cp load-tests/.env.example load-tests/.env
```

scenario YAML에서 `{{env.LOGIN_PASSWORD}}`처럼 참조한 값은 `load-tests/.env`에 `LOGIN_PASSWORD=...` 형식으로 작성합니다. 루트 `.env` 값을 재사용하려면 필요한 키만 `load-tests/.env`로 복사하거나, 실행 전에 shell에서 직접 export합니다.

## 다음 단계는 AI에게 맡기기

`openapi-k6 init` 후에는 생성된 `load-tests/README.md`가 실제 작업 가이드입니다. AI에게 아래 프롬프트를 복사해서 붙여넣으면 됩니다.

기본 smoke 테스트를 만들 때:

```text
Read load-tests/README.md first and follow it.
Fill TODO values in load-tests/config.yaml for this backend project.
Run the OpenAPI snapshot command from load-tests/README.md to create the catalog.
Read load-tests/openapi/*.catalog.json and choose one unauthenticated GET endpoint.
Update load-tests/scenarios/smoke.yaml for that endpoint.
Run the scenario validation command from load-tests/README.md.
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

루트 README는 여기까지만 안내합니다. 실제 config 작성, OpenAPI sync, scenario 작성, scenario 검증, k6 script 생성, k6 실행은 `load-tests/README.md`를 기준으로 진행합니다.

## 알아둘 점

- `config.yaml` 안의 상대 경로는 `config.yaml`이 있는 디렉터리 기준으로 해석됩니다.
- `sync`는 외부 파일이나 URL을 가리키는 `$ref`를 snapshot 내부 참조로 묶어 저장합니다.
- `pathParams` 값은 URL path segment로 encode되어 `/`, 공백, `?`, `#` 등이 URL 구조를 깨지 않습니다.
- `openapi-k6 generate`는 config의 `baseUrl`을 생성된 k6 스크립트의 기본값으로 넣습니다. k6 실행 시 `BASE_URL=... k6 run ...`처럼 환경 변수를 넘기면 이 기본값보다 우선합니다.
- `openapi-k6 test -s <scenario>`는 k6 파일을 만들기 전에 scenario YAML을 Node.js에서 1회 직접 실행해 API 흐름을 검증합니다. 실행 중 step 로그와 최종 결과를 CLI에 바로 보여줍니다.
- 실제 비밀 값은 scenario YAML에 쓰지 말고 `{{env.NAME}}`으로 참조합니다. `load-tests/run.sh`는 `load-tests/.env`만 자동으로 읽으며, 백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다.
- `multipart/form-data` 파일 업로드는 scenario YAML의 `request.multipart`로 작성합니다. 파일 경로는 `load-tests/` 기준이며, 기본 fixture 위치는 `load-tests/fixtures/`입니다.
- 생성된 k6 스크립트는 각 step을 k6 `group()`으로 묶고, 요청에 `openapi_scenario`, `openapi_step`, `openapi_method`, `openapi_path`, `openapi_api` tag를 붙입니다.
- 생성된 k6 스크립트는 `condition` 실패 시 scenario, step, method, path, status, URL, duration, 응답 body 일부를 console error로 출력합니다.
- `load-tests/run.sh <scenario> --log`를 사용하면 k6 출력이 `load-tests/logs/<scenario>.log`에도 저장됩니다.
- `load-tests/run.sh <scenario> --trace`를 사용하면 step 시작/종료 로그가 출력됩니다.
- `load-tests/run.sh <scenario> --report`를 사용하면 k6 Web Dashboard HTML report가 `load-tests/logs/<scenario>-report.html`에 저장됩니다.
- `{{env.NAME}}` 값을 쓰려면 `cp load-tests/.env.example load-tests/.env`로 `run.sh` 옆에 `.env`를 만든 뒤 값을 채웁니다.

## 개발 검증

이 저장소에서 전체 검증을 실행합니다.

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

CLI 코드를 수정하면서 백엔드 프로젝트에서 바로 확인할 때는 `pnpm run build:watch`를 켜두면 `dist`가 자동 갱신됩니다. 단, 새 버전으로 업데이트한 뒤에는 watch를 다시 시작하는 편이 안전합니다.

## 문서

- [문서 색인](docs/README.md)
- [MVP 설계](docs/spec/mvp-design.md)
- [기능 세분화](docs/spec/feature-breakdown.md)
- [작업 계획](docs/planning/work-plan.md)
- [참조 프로젝트 분석](docs/reference/reference-projects.md)
