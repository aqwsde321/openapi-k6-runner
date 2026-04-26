# openapi-k6-runner

OpenAPI 스펙과 Scenario DSL을 기반으로 k6 실행 스크립트를 생성하는 CLI 도구입니다.

## 사용 위치

실제 시나리오, OpenAPI 입력, `.env`는 테스트 대상 백엔드 프로젝트에 두는 것을 기본으로 합니다.

```text
backend-project/
├── .env
├── openapi.yaml
├── scenarios/
│   └── order-flow.yaml
└── k6/
    └── order-flow.js
```

`backend-project/.env`:

```dotenv
BASE_URL=https://dev-api.example.com
```

생성 명령은 대상 프로젝트 루트에서 실행합니다.

```bash
openapi-k6 generate \
  --scenario scenarios/order-flow.yaml \
  --openapi openapi.yaml \
  --write k6/order-flow.js
```

이 저장소의 `.env`는 generator 개발/검증용 로컬 설정입니다.

## 문서

- [문서 색인](docs/README.md)
- [MVP 설계](docs/mvp-design.md)
- [기능 세분화](docs/feature-breakdown.md)
- [참조 프로젝트 분석](docs/reference-projects.md)
- [문서 기반 작업 계획](docs/work-plan.md)
