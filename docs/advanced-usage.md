# 고급 기능

루트 README의 빠른 시작이 통과한 뒤, 반복을 줄이거나 여러 서버를 연결해야 할 때만 사용합니다.

## 테스트 데이터 재사용

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

환경별 값은 fixture 파일로 분리할 수 있습니다.

```yaml
fixtures:
  - ./fixtures/dev.yaml
```

```yaml
# load-tests/scenarios/fixtures/dev.yaml
sku: ABC-001
tenantId: dev-tenant
```

실행 시점 override도 가능합니다.

```bash
npx --yes openapi-k6 test -s <scenario-name> --var-file load-tests/scenarios/fixtures/stage.yaml
npx --yes openapi-k6 test -s <scenario-name> --var sku=ABC-002
```

우선순위는 `fixtures:` < `vars:` < `--var-file` < `--var`입니다.

## 공통 step include

로그인이나 seed 같은 공통 step은 partial YAML로 뺄 수 있습니다.

```yaml
steps:
  - include: ./partials/login.yaml
  - id: get-me
    api:
      operationId: getMe
    request:
      headers:
        Authorization: "Bearer {{token}}"
```

partial 파일에는 `steps`만 둡니다.

```yaml
# load-tests/scenarios/partials/login.yaml
steps:
  - id: login
    api:
      operationId: loginUser
    request:
      body:
        username: "{{vars.loginId}}"
        password: "{{env.LOGIN_PASSWORD}}"
    extract:
      token:
        from: $.token
    condition: status == 200
```

include 파일에는 `vars:`나 `fixtures:`를 두지 않습니다.
변수는 실행하는 entry scenario에서 관리합니다.

## 여러 서버 연결

API 서버가 여러 개면 module을 추가합니다.

```bash
npx --yes openapi-k6 module add auth --base-url https://auth-api.example.com --sync
npx --yes openapi-k6 module list
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
생성된 k6 스크립트는 `BASE_URL_AUTH` 같은 module별 환경변수를 먼저 읽고, 없으면 `BASE_URL`과 config 값을 사용합니다.

## UI, doctor, update

```bash
npx --yes openapi-k6 ui
npx --yes openapi-k6 doctor
npx --yes openapi-k6 update
```

- `ui`: 브라우저에서 scenario를 고르고 `validate`/`test`를 실행합니다.
- `doctor`: config, snapshot, catalog, scaffold metadata, module env 충돌, k6 설치 여부를 점검합니다.
- `update`: 기존 `config.yaml`, `.env`, `scenarios/`, snapshot/catalog, `generated/`, `logs/`를 보존하고 scaffold 파일만 갱신합니다.

CLI가 `Scaffold update available`을 표시하면 안내된 `update` 명령을 실행합니다.
초기 scaffold를 의도적으로 다시 만들 때만 `init --force`를 사용합니다.

## generate와 runner

스크립트만 만들 때는 `generate`를 씁니다.

```bash
npx --yes openapi-k6 generate -s <scenario-name>
```

생성된 runner를 직접 쓰는 기존 흐름도 유지됩니다.

```bash
./load-tests/run.sh <scenario-name> --log
```

k6 옵션은 scenario 이름 뒤에 붙입니다.

```bash
./load-tests/run.sh <scenario-name> --log --vus 1 --iterations 1
```

## 제약

- OpenAPI 3.x만 지원합니다.
- `condition`은 분기가 아니라 검증식입니다.
- `body`와 `multipart`는 같은 step에서 함께 쓰지 않습니다.
- include와 fixture 경로는 entry scenario 디렉터리 밖으로 나갈 수 없습니다.
- 비밀값은 scenario YAML에 직접 쓰지 않고 `{{env.NAME}}`으로 참조합니다.
