# openapi-k6-runner

OpenAPI 스펙과 사람이 읽기 쉬운 Scenario DSL로 k6 실행 스크립트를 생성하는 CLI 도구입니다.

이 프로젝트는 백엔드 프로젝트마다 반복되는 부하 테스트 준비 작업을 줄이기 위해 만들었습니다. 백엔드 루트에 `load-tests/` 폴더를 만들고, OpenAPI snapshot, scenario YAML, generated k6 script를 한곳에서 관리하게 합니다.

## 용도

- OpenAPI endpoint catalog를 만들어 테스트할 API를 쉽게 고릅니다.
- YAML scenario로 로그인, 조회, 주문 같은 API 흐름을 작성합니다.
- scenario YAML을 k6 JavaScript로 생성합니다.
- 비밀번호나 토큰 같은 값은 `{{env.NAME}}` 템플릿으로 분리해 `.env`에만 둡니다.

## 설치

개발 중에는 이 저장소에서 의존성을 설치하고 빌드한 뒤 전역 link로 CLI를 연결합니다.

```bash
cd /path/to/openapi-k6-runner
pnpm install
pnpm run build
pnpm link --global
openapi-k6 --help
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

생성되는 파일:

- `load-tests/config.yaml`
- `load-tests/.env.example`
- `load-tests/.gitignore`
- `load-tests/scenarios/smoke.yaml`
- `load-tests/README.md`

기존 파일은 덮어쓰지 않습니다. 다시 만들려면 `--force`를 명시합니다.

```bash
openapi-k6 init --force
```

## 다음 단계는 AI에게 맡기기

`openapi-k6 init` 후에는 생성된 `load-tests/README.md`가 실제 작업 가이드입니다. AI에게 아래 프롬프트를 복사해서 붙여넣으면 됩니다.

기본 smoke 테스트를 만들 때:

```text
Read load-tests/README.md first and follow it.
Fill TODO values in load-tests/config.yaml for this backend project.
Run the OpenAPI snapshot command from load-tests/README.md to create the catalog.
Read load-tests/openapi/*.catalog.json and choose one unauthenticated GET endpoint.
Update load-tests/scenarios/smoke.yaml for that endpoint.
Run the k6 script generation command from load-tests/README.md.
Do not edit load-tests/generated/*.k6.js or load-tests/openapi/*.openapi.json directly.
Keep human-facing documentation in Korean. Keep AI instruction sections in English.
```

새 시나리오를 만들 때:

```text
Read load-tests/README.md and load-tests/openapi/*.catalog.json.
Create load-tests/scenarios/basic-read.yaml for one read endpoint that can be called without login.
Generate the k6 script using the command documented in load-tests/README.md.
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
Generate the k6 script using the command documented in load-tests/README.md.
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
    ├── .gitignore
    ├── openapi/
    │   ├── default.openapi.json
    │   └── default.catalog.json
    ├── scenarios/
    │   └── smoke.yaml
    └── generated/
        └── smoke.k6.js
```

루트 README는 여기까지만 안내합니다. 실제 config 작성, OpenAPI sync, scenario 작성, k6 script 생성, k6 실행은 `load-tests/README.md`를 기준으로 진행합니다.

## 알아둘 점

- `config.yaml` 안의 상대 경로는 `config.yaml`이 있는 디렉터리 기준으로 해석됩니다.
- `sync`는 외부 파일이나 URL을 가리키는 `$ref`를 snapshot 내부 참조로 묶어 저장합니다.
- `pathParams` 값은 URL path segment로 encode되어 `/`, 공백, `?`, `#` 등이 URL 구조를 깨지 않습니다.
- `openapi-k6 generate`는 config의 `baseUrl`을 생성된 k6 스크립트의 기본값으로 넣습니다. k6 실행 시 `BASE_URL=... k6 run ...`처럼 환경 변수를 넘기면 이 기본값보다 우선합니다.
- 실제 비밀 값은 scenario YAML에 쓰지 말고 `{{env.NAME}}`으로 참조합니다.

## 개발 검증

이 저장소에서 전체 검증을 실행합니다.

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

## 문서

- [문서 색인](docs/README.md)
- [MVP 설계](docs/spec/mvp-design.md)
- [기능 세분화](docs/spec/feature-breakdown.md)
- [작업 계획](docs/planning/work-plan.md)
- [참조 프로젝트 분석](docs/reference/reference-projects.md)
