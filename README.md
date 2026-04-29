# openapi-k6

OpenAPI 스펙에서 테스트할 API를 고르고, 사람이 읽기 쉬운 Scenario DSL로 API 흐름을 먼저 검증한 뒤, 통과한 시나리오를 k6 부하 테스트로 실행하게 만드는 CLI 도구입니다.

백엔드 프로젝트 루트에 `load-tests/` 작업 공간을 만들고 OpenAPI snapshot, endpoint catalog, scenario YAML, scenario test, generated k6 script를 한곳에서 관리합니다.

## 핵심 흐름

```text
OpenAPI snapshot/catalog
  -> scenario YAML 작성
  -> scenario test로 실제 API 흐름 검증
  -> k6 script 생성
  -> k6 부하 테스트 실행
```

`openapi-k6 test`는 보조 명령이 아니라 k6 실행 전 필수 gate입니다. 실제 백엔드에 요청을 보내 status, condition, extract, template 치환을 먼저 확인하고, 통과한 scenario만 부하 테스트 스크립트로 넘깁니다.

## 빠른 시작

테스트를 추가할 백엔드 프로젝트 루트 터미널에서 바로 실행합니다.

```bash
npx --yes openapi-k6 init
```

생성된 `load-tests/config.yaml`의 TODO 값을 채운 뒤 기본 흐름은 아래 순서입니다.

```bash
npx --yes openapi-k6 sync
npx --yes openapi-k6 test -s smoke
npx --yes openapi-k6 generate -s smoke
./load-tests/run.sh smoke --log
```

같은 버전을 프로젝트에 고정하고 싶으면 devDependency로 설치합니다.

```bash
pnpm add -D openapi-k6
pnpm exec openapi-k6 --help
```

생성된 k6 스크립트를 실행하려면 별도로 k6가 설치되어 있어야 합니다. npm 배포 버전이 아니라 현재 저장소 코드를 직접 실행하려면 [도구 개발/유지보수](docs/03-maintainer-notes.md)를 참고하세요.

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

## 알아둘 점

- 상세한 config 작성, scenario DSL, k6 실행 옵션은 생성된 `load-tests/README.md`를 기준으로 진행합니다.
- `npx --yes openapi-k6 test -s <scenario>`는 k6 파일을 만들기 전에 scenario YAML을 Node.js에서 1회 직접 실행해 API 흐름을 검증합니다.
- `load-tests/run.sh`는 `run.sh`와 같은 폴더의 `load-tests/.env`만 자동으로 읽습니다. 백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다.
- `sync`는 외부 파일이나 URL을 가리키는 `$ref`를 snapshot 내부 참조로 묶어 저장합니다.
- `pathParams` 값은 URL path segment로 encode되어 `/`, 공백, `?`, `#` 등이 URL 구조를 깨지 않습니다.

## 문서

- [변경 이력](CHANGELOG.md)
- [문서 색인](docs/README.md)
- [도구 개발/유지보수](docs/03-maintainer-notes.md)
- [MVP 설계](docs/spec/mvp-design.md)
- [기능 세분화](docs/spec/feature-breakdown.md)
- [작업 계획](docs/planning/work-plan.md)
- [참조 프로젝트 분석](docs/reference/reference-projects.md)
