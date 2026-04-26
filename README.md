# openapi-k6-runner

OpenAPI 스펙과 Scenario DSL을 기반으로 k6 실행 스크립트를 생성하는 CLI 도구입니다.

## 사용 위치

실제 시나리오, OpenAPI snapshot, `.env`는 테스트 대상 백엔드 프로젝트에 두는 것을 기본으로 합니다.

```text
backend-project/
├── .env
└── load-tests/
    ├── openapi/
    │   ├── dev.openapi.json
    │   └── catalog.json
    ├── scenarios/
    │   └── order-flow.yaml
    └── generated/
        └── order-flow.k6.js
```

`backend-project/.env`:

```dotenv
BASE_URL=https://dev-api.example.com
```

생성 명령은 대상 프로젝트 루트에서 실행합니다.

```bash
openapi-k6 sync \
  --openapi https://dev-api.example.com/v3/api-docs \
  --write load-tests/openapi/dev.openapi.json \
  --catalog load-tests/openapi/catalog.json

openapi-k6 generate \
  --scenario load-tests/scenarios/order-flow.yaml \
  --openapi load-tests/openapi/dev.openapi.json \
  --write load-tests/generated/order-flow.k6.js
```

`sync`는 원격 OpenAPI URL 또는 로컬 OpenAPI 파일을 snapshot으로 저장하고, scenario 작성 참고용 `catalog.json`을 생성합니다. `generate`는 원격 URL이 아니라 snapshot 파일을 입력으로 사용하는 것을 기본으로 합니다.

이 저장소의 `.env`는 generator 개발/검증용 로컬 설정입니다.

## 문서

- [문서 색인](docs/README.md)
- [MVP 설계](docs/mvp-design.md)
- [기능 세분화](docs/feature-breakdown.md)
- [참조 프로젝트 분석](docs/reference-projects.md)
- [문서 기반 작업 계획](docs/work-plan.md)
