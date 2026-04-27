# Test Fixtures

이 디렉터리는 대상 백엔드 프로젝트의 `load-tests` 구조를 작게 재현한다.

```text
fixtures/
├── config.yaml
├── openapi/
│   └── store.openapi.yaml
├── scenarios/
│   └── login-order-flow.yaml
└── expected/
    └── login-order-flow.k6.js
```

- `config.yaml`: `load-tests/config.yaml` 예시
- `openapi/`: `openapi-k6 sync --config` 입력으로 사용하는 OpenAPI 원본
- `scenarios/`: `openapi-k6 generate --scenario` 입력으로 사용하는 Scenario DSL
- `expected/`: 생성 결과를 고정하는 snapshot 파일

`login-order-flow.yaml`은 secret 값을 직접 쓰지 않고 `{{env.LOGIN_ID}}`, `{{env.LOGIN_PASSWORD}}`를 사용한다. generated k6 script에서는 각각 `__ENV.LOGIN_ID`, `__ENV.LOGIN_PASSWORD`로 컴파일된다.

Fixture 기반 테스트는 임시 workspace에 `load-tests/config.yaml`, `load-tests/openapi`, `load-tests/scenarios`, `load-tests/generated`를 만들고, 실제 CLI 흐름과 같은 상대 경로로 실행한다.
