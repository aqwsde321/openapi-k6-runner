# Test Fixtures

이 디렉터리는 대상 백엔드 프로젝트의 `load-tests` 구조를 작게 재현한다.

```text
fixtures/
├── openapi/
│   └── store.openapi.yaml
├── scenarios/
│   └── login-order-flow.yaml
└── expected/
    └── login-order-flow.k6.js
```

- `openapi/`: `openapi-k6 sync --openapi` 입력으로 사용하는 OpenAPI 원본
- `scenarios/`: `openapi-k6 generate --scenario` 입력으로 사용하는 Scenario DSL
- `expected/`: 생성 결과를 고정하는 snapshot 파일

Fixture 기반 테스트는 임시 workspace에 `load-tests/openapi`, `load-tests/scenarios`, `load-tests/generated`를 만들고, 실제 CLI 흐름과 같은 상대 경로로 실행한다.
