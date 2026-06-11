# __DIRECTORY__

AI coding agent용 openapi-k6 작업 계약입니다. 매번 전체를 다시 읽지 말고, 같은 대화에서 최신 `init`, `update`, README 변경 이후 이미 읽었다면 필요한 섹션만 확인합니다.

핵심 흐름:

```text
OpenAPI sync -> catalog 확인 -> API 호출 계획 확인 -> Scenario YAML 작성 -> validate/test
```

## AI 작업 계약

1. 모든 명령은 백엔드 프로젝트 루트에서 실행합니다.
2. `__CONFIG_PATH__`에 TODO가 남아 있으면 실제 API base URL 또는 OpenAPI URL을 사용자에게 묻습니다.
3. snapshot/catalog가 없거나 최신 OpenAPI가 필요하면 `__SYNC_COMMAND__`를 실행합니다.
4. endpoint 후보와 step 초안은 `__CATALOG_AI_COMMAND__`로 확인합니다. `<검색어>`는 실제 API 이름, path, tag로 바꿉니다.
5. Scenario YAML을 쓰기 전에 사용자에게 아래 계획을 확인받습니다.
   - scenario 파일명
   - 업무 프로세스
   - API 호출 순서와 method/path 또는 operationId
   - request 값과 `{{env.*}}`, `{{vars.*}}` 처리
   - response extract 값과 다음 step 재사용 위치
   - 기존 partial include 재사용 또는 새 partial 생성 여부
   - 모호한 endpoint 선택지와 필요한 테스트 데이터
6. 사용자가 `ㅇ`, `ok`, `ㄱ`처럼 긍정하면 `__DIRECTORY__/scenarios/*.yaml`을 작성하거나 수정합니다.
7. 처음에는 `id`, `api`, `request`, `extract`, `condition`만 채웁니다. 반복이 생길 때만 `vars`, `fixtures`, `include`를 사용합니다.
8. 비밀 값은 scenario YAML에 직접 쓰지 말고 `{{env.NAME}}`으로 참조합니다. 실제 값은 `__ENV_PATH__`에만 둡니다.
9. `__VALIDATE_NAME_COMMAND__`를 먼저 통과시킨 뒤, 가능한 경우 `__TEST_NAME_COMMAND__`로 실제 API 흐름을 1회 검증합니다.
10. validate/test 전에는 `generate`, `run`, 장시간 k6 실행을 하지 않습니다.
11. CLI가 `Scaffold update available`을 표시하면 `__UPDATE_COMMAND__`를 실행하고 이 README를 다시 확인합니다. 기존 workspace에는 `init --force`를 쓰지 않습니다.

## 프로젝트 값

- config: `__CONFIG_PATH__`
- module: `__MODULE_NAME__`
- snapshot: `__SNAPSHOT_PATH__`
- catalog: `__CATALOG_PATH__`
- scenario: `__SCENARIO_TEMPLATE_PATH__`
- env: `__ENV_PATH__`
- generated: `__DIRECTORY__/generated/*.k6.js`
- runner: `__RUN_SCRIPT_PATH__`

## 명령

| 상황 | 명령 |
| --- | --- |
| OpenAPI snapshot/catalog 갱신 | `__SYNC_COMMAND__` |
| endpoint 검색 | `__CATALOG_SEARCH_COMMAND__` |
| AI용 endpoint/step 초안 | `__CATALOG_AI_COMMAND__` |
| 최신 sync 후 AI 초안 | `__CATALOG_SYNC_AI_COMMAND__` |
| 정적 검증 | `__VALIDATE_NAME_COMMAND__` |
| 실행 검증 | `__TEST_NAME_COMMAND__` |
| k6 스크립트 생성 | `__GENERATE_NAME_COMMAND__` |
| 짧은 k6 실행 | `__RUN_NAME_COMMAND__ --log -- --vus 1 --iterations 1` |
| 로컬 UI | `__UI_COMMAND__` |
| scaffold 안전 갱신 | `__UPDATE_COMMAND__` |

자주 쓰는 runner:

```bash
__RUN_SCRIPT_ARG__ <scenario-name>
__RUN_SCRIPT_ARG__ <scenario-name> --log
__RUN_SCRIPT_ARG__ <scenario-name> --vus 1 --iterations 1
```

로그 파일: `__DIRECTORY__/logs/<scenario-name>.log`

## Scenario 작성 규칙

- `operationId`가 유일하면 `api.operationId`를 우선 사용합니다.
- `operationId`가 없거나 애매하면 `api.method`와 `api.path`를 사용합니다.
- `catalog --ai` 초안의 `<...>` placeholder가 남아 있으면 `validate`가 실패합니다.
- `request.body`와 `request.multipart`는 같은 step에 함께 쓰지 않습니다.
- `condition`은 검증식이지 분기 조건이 아닙니다.
- 응답 값은 `extract`로 저장하고 뒤 step에서 `{{variableName}}`으로 참조합니다.

## 재사용 규칙

- 반복 값은 scenario `vars:` 또는 `--var-file`, `--var`로 관리합니다.
- 값 우선순위는 `fixtures:` < `vars:` < CLI `--var-file` < CLI `--var`입니다.
- 공통 로그인/auth/seed step은 `steps` 안의 `- include: ./partials/login.yaml`로 재사용합니다.
- include 파일에는 `steps:`만 두고 `vars:`나 `fixtures:`는 entry scenario에서 관리합니다.
- include와 fixture 경로는 entry scenario 파일 기준 상대 경로이며 scenario 디렉터리 밖으로 나갈 수 없습니다.
- 여러 OpenAPI 서버를 한 scenario에서 섞을 때만 `api.module`을 사용합니다.

## 파일 규칙

직접 수정 가능:

- `__CONFIG_PATH__`
- `__ENV_PATH__`
- `__DIRECTORY__/scenarios/*.yaml`

직접 수정 금지:

- `__DIRECTORY__/README.md`
- `__RUN_SCRIPT_PATH__`
- `__DIRECTORY__/.env.example`
- `__DIRECTORY__/.gitignore`
- `__DIRECTORY__/.openapi-k6.json`
- `__SNAPSHOT_PATH__`
- `__CATALOG_PATH__`
- `__DIRECTORY__/generated/*.k6.js`

생성물은 `sync`, `generate`, `update`로 다시 만듭니다.

## 필요할 때만

```bash
__ENV_COPY_COMMAND__
__CLI_COMMAND__ module add auth --base-url <url> --sync
__GENERATE_NAME_COMMAND__
__UPDATE_COMMAND__
```

`update`는 `config.yaml`, `.env`, `scenarios/`, snapshot/catalog 파일, `generated/`, `logs/`를 보존하고 README, runner, `.env.example`, `.gitignore`, `.openapi-k6.json` 같은 scaffold 파일만 최신화합니다.
오래된 scaffold에서 `validate`, `test`, `generate`, `run`을 실행하면 최신 README/runner를 받을 수 있도록 `Scaffold update available` notice와 `__UPDATE_COMMAND__` 명령이 표시됩니다.
