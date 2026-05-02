# openapi-k6

OpenAPI 기반으로 **Scenario YAML을 만들고**, 실제 API 흐름을 먼저 검증한 뒤, 통과한 시나리오를 k6 부하 테스트로 실행하게 만드는 CLI 도구입니다.

`openapi-k6`의 중심은 k6 파일 생성이 아니라 scenario 작성입니다. OpenAPI에서 endpoint catalog를 만들고, 로그인 -> 토큰 추출 -> 인증 API 호출 같은 여러 API 흐름을 사람이 읽기 쉬운 YAML로 연결합니다.

백엔드 프로젝트 루트에 `load-tests/` 작업 공간을 만들고 OpenAPI snapshot, endpoint catalog, scenario YAML, scenario test, generated k6 script를 한곳에서 관리합니다.

## 할 수 있는 것

- OpenAPI spec에서 테스트 가능한 endpoint catalog 생성
- `operationId` 또는 `method + path`로 API step 선택
- 이전 API 응답 값을 `extract`로 저장하고 다음 API의 header, query, path, body에 연결
- k6 실행 전에 `openapi-k6 test`로 실제 API 흐름을 1회 검증
- 검증된 scenario만 k6 script로 생성하고 `run.sh`로 실행

## 핵심 흐름

```text
OpenAPI snapshot/catalog
  -> scenario YAML 작성
  -> scenario test로 실제 API 흐름 검증
  -> k6 script 생성
  -> k6 부하 테스트 실행
```

`openapi-k6 test`는 보조 명령이 아니라 k6 실행 전 필수 gate입니다. 실제 백엔드에 요청을 보내 status, condition, extract, template 치환을 먼저 확인하고, 통과한 scenario만 부하 테스트 스크립트로 넘깁니다.

## Scenario YAML 예시

아래처럼 여러 API를 하나의 사용자 흐름으로 작성할 수 있습니다.

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

이 YAML은 `openapi-k6 test`에서는 실제 API 요청으로 실행되고, `openapi-k6 generate`에서는 같은 흐름의 k6 script로 변환됩니다.

## 빠른 시작

### 1. 작업 공간 생성

```bash
npx --yes openapi-k6 init
```

테스트를 추가할 백엔드 프로젝트 루트 터미널에서 실행합니다.
대화형 터미널에서는 `baseUrl`만 묻고 `<baseUrl>/v3/api-docs`가 OpenAPI 3.x JSON인지 먼저 확인합니다. 실패하면 `/api-docs`, `/openapi.json`, `/swagger.json` 같은 흔한 경로를 자동으로 시도하고, 그래도 찾지 못할 때만 OpenAPI spec URL 또는 파일 경로를 따로 묻습니다.

### 2. 설정 확인

OpenAPI URL을 찾았으면 `load-tests/config.yaml`의 `baseUrl`과 `openapi`가 바로 채워집니다. 자동 탐색이 실패하면 CLI 안내에 따라 직접 URL/파일 경로를 입력하거나 `skip`으로 넘어간 뒤 config를 나중에 수정할 수 있습니다.

### 3. OpenAPI snapshot/catalog 생성

```bash
npx --yes openapi-k6 sync
```

### 4. Scenario 검증

```bash
npx --yes openapi-k6 test -s smoke
```

`test`가 통과하기 전에는 k6 스크립트를 생성하거나 실행하지 않습니다.

### 5. k6 스크립트 생성 및 실행

```bash
npx --yes openapi-k6 generate -s smoke
./load-tests/run.sh smoke --log
```

### 선택: 버전 고정

같은 버전을 프로젝트에 고정하고 싶으면 devDependency로 설치합니다.

```bash
pnpm add -D openapi-k6
pnpm exec openapi-k6 --help
```

생성된 k6 스크립트를 실행하려면 별도로 k6가 설치되어 있어야 합니다. npm 배포 버전이 아니라 현재 저장소 코드를 직접 실행하려면 [도구 개발/유지보수](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/03-maintainer-notes.md)를 참고하세요.

## 생성되는 작업 공간

| 파일 | 역할 |
| --- | --- |
| `load-tests/README.md` | 실제 작업 가이드 |
| `load-tests/config.yaml` | API base URL, OpenAPI URL, snapshot/catalog 경로 |
| `load-tests/.env.example` | secret 값을 둘 `.env` 예시 |
| `load-tests/run.sh` | generated k6 script 실행 helper |
| `load-tests/scenarios/smoke.yaml` | 기본 scenario YAML |
| `load-tests/openapi/*.openapi.json` | `sync`가 만든 OpenAPI snapshot |
| `load-tests/openapi/*.catalog.json` | scenario 작성용 endpoint catalog |
| `load-tests/generated/*.k6.js` | `generate`가 만든 k6 script |

`load-tests/.env`는 생성되지 않습니다. 비밀 값이 필요할 때 `.env.example`을 복사해서 직접 만들고 commit하지 않습니다.

기존 scaffold 관리 파일은 덮어쓰지 않습니다. 다시 만들려면 `--force`를 명시합니다.

```bash
npx --yes openapi-k6 init --force
```

`--force`는 scaffold 관리 파일만 다시 쓰고 `.env`, `openapi/`, `generated/`, `logs/`, 추가 scenario 파일은 지우지 않습니다.

## AI에게 맡기기

`npx --yes openapi-k6 init` 후 생성된 `load-tests/README.md`의 "AI에게 작업 맡기기" 섹션을 AI coding agent에게 붙여넣으세요.

루트 README는 npm 설치와 전체 흐름만 안내합니다. 실제 작업 프롬프트는 init 시 선택한 디렉터리와 명령이 반영된 생성 README를 기준으로 합니다.

## 문서

- [변경 이력](https://github.com/aqwsde321/openapi-k6-runner/blob/main/CHANGELOG.md)
- [문서 색인](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/README.md)
- [도구 개발/유지보수](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/03-maintainer-notes.md)
- [MVP 설계](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/spec/mvp-design.md)
- [기능 세분화](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/spec/feature-breakdown.md)
- [작업 계획](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/planning/work-plan.md)
- [참조 프로젝트 분석](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/reference/reference-projects.md)
