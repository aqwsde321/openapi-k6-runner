# Changelog

이 프로젝트의 공개 npm 배포 이력을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 따르고, 버전 번호는 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 기준으로 관리합니다.

## [Unreleased]

## [0.10.0] - 2026-06-23

### Added

- Scenario YAML에서 `{{k6.scenario.iterationInTest}}`, `{{k6.vu.idInTest}}` 같은 k6 실행 context 값을 참조해 generated k6 실행마다 달라지는 request 값을 만들 수 있게 했습니다.
- Scenario YAML에서 `{{k6.run.id}}`를 참조해 k6 scenario 시작 timestamp 기반 prefix를 만들 수 있게 했습니다. `OPENAPI_K6_RUN_ID` 환경변수로 값을 고정할 수 있습니다.
- `openapi-k6 test --iterations <count>` 옵션을 추가해 k6 없이도 반복 실행 시 `{{k6.*}}` 값이 증가하는지 검증할 수 있게 했습니다.

### Changed

- README, init scaffold README, Codex 스킬 안내에서 `.env`는 비밀/접속 값에 한정하고, synthetic unique 값은 `{{k6.run.id}}-{{k6.scenario.iterationInTest}}` 패턴을 먼저 사용하도록 기준을 명확히 했습니다.

## [0.9.1] - 2026-06-22

### Changed

- README 첫 설명을 endpoint 단건 호출이 아니라 응답값을 다음 요청에 연결하는 scenario 흐름과 k6 JS 생성 흐름 중심으로 정리했습니다.

## [0.9.0] - 2026-06-19

### Added

- `auth/login` 같은 폴더형 scenario key를 지원해 `scenarios/auth/login.yaml`, `generated/auth/login.k6.js`, `logs/auth/login.log`처럼 시나리오, 생성물, 로그/리포트 경로를 같은 구조로 관리할 수 있게 했습니다.
- Scenario YAML `steps`에서 `- use: auth/login`으로 scenario root 기준의 다른 시나리오 steps를 재사용할 수 있게 했습니다.
- UI의 scenario 목록/상세에서 폴더형 시나리오와 `use` 재사용 참조를 확인할 수 있게 했습니다.
- UI 실행 결과에서 step별 성공/실패, HTTP status, 소요시간, step 출처를 요약해 표시하도록 했습니다.
- UI에서 scenario step 원문 YAML을 step별 토글로 확인할 수 있게 했습니다.
- `openapi-k6 doctor`가 module별 baseUrl 연결 여부와 snapshot 상태를 함께 점검하도록 보강했습니다.
- 로컬 fixture 백엔드와 샘플 workspace를 띄우는 `pnpm run sample:ui`를 추가했습니다.

### Changed

- `init` 기본 scaffold를 단순화해 `partials/`와 `fixtures/` 예시 파일을 기본 생성하지 않도록 했습니다.
- 루트 README와 scaffold README를 `use`, `vars`, `--var-file`, 직접 `k6 run` 흐름 중심으로 정리했습니다.
- README의 k6 명령 모음을 별도 섹션으로 분리하고, k6 Web Dashboard와 HTML report 예시를 추가했습니다.
- UI에서 서버 상태를 scenario 상세가 아니라 헤더 요약으로 표시하고, module별 연결 상태를 hover 팝업에서 확인하도록 정리했습니다.
- UI에서 실행 히스토리 목록을 제거하고, 선택한 scenario의 최근 validate/test 결과와 실행 로그를 중심으로 표시하도록 정리했습니다.
- `validate`, `generate`, `run`에서 정적 검증 후 AST를 준비하는 흐름을 공통화했습니다.

### Fixed

- `run`에서 k6 check 실패가 프로세스 실패로 반영되도록 수정했습니다.
- `generate`가 정적 검증 실패 시 기존 생성물을 덮어쓰지 않도록 보강했습니다.
- `run` 실패 시 기존 생성물을 보존하도록 보강했습니다.
- UI 서버 연결이 끊기면 화면 전체에 연결 끊김 상태를 표시하고, 재연결되면 다시 사용할 수 있도록 했습니다.
- UI step 코드 토글이 여러 step에서 독립적으로 열리고 닫히도록 수정했습니다.
- UI 서버 상태 팝업이 마우스를 옮기는 동안 너무 빨리 닫히지 않도록 수정했습니다.

## [0.8.0] - 2026-06-11

### Added

- `openapi-k6 install-skill` 명령을 추가해 Codex용 `openapi-k6-scenario` 스킬을 설치할 수 있게 했습니다.
- 스킬은 scenario YAML 작성 전에 업무 프로세스와 API 호출 계획을 사용자에게 확인받고, `validate`와 가능한 경우 `test`까지 수행하도록 안내합니다.

### Changed

- 신규 기본 작업공간을 `load-tests/`에서 `openapi-k6/`로 변경했습니다.
- 기본 `update` 실행 시 기존 `load-tests/config.yaml` workspace를 감지하면 `load-tests/` 전체를 `openapi-k6/`로 이전한 뒤 scaffold를 갱신합니다.
- `init` 생성 README를 AI agent용 작업 계약 중심으로 줄여 반복 컨텍스트 사용량을 낮췄습니다.
- 루트 README 상단에 AI agent 시작 흐름과 스킬 설치 안내를 배치했습니다.

## [0.7.2] - 2026-06-08

### Changed

- 별도 `docs/advanced-usage.md`로 분리했던 고급 기능 설명을 루트 README의 접힌 섹션으로 통합했습니다.
- 루트 README 상단에 빠른 시작과 AI 작업 프롬프트로 바로 이동하는 링크를 추가했습니다.

## [0.7.1] - 2026-06-08

### Changed

- 루트 README와 `init` 생성 README를 첫 실행 흐름 중심으로 단순화하고, 고급 기능 예시는 별도 문서와 접힌 섹션으로 분리했습니다.
- `login`, `smoke` 같은 예시 값은 출력 예시나 기본 scaffold 설명에서만 보이도록 하고, 복사해서 실행하는 명령 안내는 `<검색어>`, `<scenario-name>` placeholder 기준으로 정리했습니다.
- `init` 완료 후 다음 명령 안내, `catalog` summary, `run.sh --help` 예시도 placeholder 기준으로 맞췄습니다.

## [0.7.0] - 2026-05-27

### Added

- `validate`, `generate`, `test`, `run`에 `--var-file`과 `--var` 옵션을 추가해 같은 scenario를 환경별 테스트 데이터로 실행할 수 있게 했습니다.
- `openapi-k6 ui` 명령을 추가해 브라우저에서 scenario 목록, module/server 상태, validate/test CLI 출력을 확인할 수 있게 했습니다.

### Changed

- README와 scaffold README의 빠른 시작, scenario 작성, AI 작업 가이드를 실제 CLI 흐름에 맞게 정리했습니다.

### Fixed

- UI의 test 출력이 `--no-color`로 고정되지 않도록 하고, ANSI 색상을 브라우저 출력 영역에 안전하게 렌더링하도록 수정했습니다.

## [0.6.0] - 2026-05-24

### Added

- Scenario YAML 상단 `vars:`와 `fixtures:` 및 `{{vars.NAME}}` template 참조를 추가해 SKU, tenant 같은 테스트 데이터를 scenario 단위로 관리할 수 있게 했습니다.
- Scenario YAML의 `steps`에서 `- include: ./partials/login.yaml`로 공통 step 파일을 펼쳐 여러 scenario에서 로그인/seed 흐름을 재사용할 수 있게 했습니다.
- `openapi-k6 doctor` 명령을 추가해 config, snapshot, catalog, scaffold metadata, module base URL env 충돌, k6 설치 여부를 한 번에 점검할 수 있게 했습니다.
- `init`이 `scenarios/partials/login.yaml.example`과 `scenarios/fixtures/dev.yaml.example` 예시를 함께 생성하도록 했습니다.

## [0.5.1] - 2026-05-24

### Changed

- `pnpm run smoke:e2e`가 seed/auth/bos fixture를 서로 다른 로컬 서버 포트로 띄워 module별 OpenAPI 탐색과 cross-module API 호출을 검증하도록 보강했습니다.
- README와 scaffold README에 서로 다른 Swagger/OpenAPI 서버를 module로 연결하는 사용 예시를 보강했습니다.
- 유지보수자가 현재 아키텍처와 검증 체계를 빠르게 파악할 수 있도록 프로젝트 리뷰 문서를 추가했습니다.
- `init`/`update`가 scaffold metadata를 기록하고, 오래된 scaffold에서 `validate`/`test`/`generate`/`run` 실행 시 구분되는 `Scaffold update available` 안내를 표시하도록 했습니다.

## [0.5.0] - 2026-05-24

### Added

- 빌드된 CLI를 로컬 fixture 백엔드에 붙여 multi-module `init -> module add --sync -> validate -> test -> generate -> run` 흐름을 확인하는 `pnpm run smoke:e2e`를 추가했습니다.
- `openapi-k6 module list/add/set-default` 명령을 추가해 `load-tests/config.yaml`의 OpenAPI module을 CLI로 관리할 수 있게 했습니다.
- `openapi-k6 module remove` 명령을 추가해 config의 OpenAPI module 항목을 안전하게 제거할 수 있게 했습니다.
- npm registry에 배포된 실제 패키지를 `npm exec`로 확인하는 published smoke 명령과 후속 GitHub Actions workflow를 추가했습니다.

### Changed

- CI와 Publish workflow가 빌드 후 `pnpm run smoke:e2e`를 실행해 배포 전 실제 multi-module 로컬 백엔드 흐름을 검증하도록 했습니다.
- `openapi-k6 module add`가 `--openapi` 없이도 `--base-url`에서 흔한 OpenAPI 경로를 자동 탐색할 수 있게 했습니다.
- `openapi-k6 module add`가 추가하는 config module 항목에 OpenAPI, snapshot, catalog 설명 주석을 함께 쓰도록 개선했습니다.
- `openapi-k6 module add` 완료 출력에 다음에 실행할 catalog/module list 명령과 scenario `api.module` 힌트를 추가했습니다.
- README와 scaffold README에 `openapi-k6 module list --json`의 자동화/UI adapter 활용 방법을 문서화했습니다.

## [0.4.0] - 2026-05-18

### Added

- API 호출 없이 Scenario YAML을 OpenAPI snapshot과 대조하는 `openapi-k6 validate` 명령을 추가했습니다.
- `validate`가 지원하지 않는 `condition` 표현식과 `extract.from` JSONPath를 API 호출 전에 실패로 처리하도록 보강했습니다.
- Scenario YAML step의 `api.module`로 여러 OpenAPI module을 하나의 scenario에서 섞어 사용할 수 있게 했습니다.
- `validate`가 request 안의 context template 참조를 이전 step의 `extract` 기준으로 정적으로 검증하도록 보강했습니다.
- `openapi-k6 run` 명령을 추가해 scenario 정적 검증, k6 스크립트 생성, `k6 run` 실행을 한 번에 수행할 수 있게 했습니다.

### Fixed

- 생성된 k6 스크립트의 trace/check 실패 로그에서 `{{env.NAME}}`으로 참조한 비밀 값이 URL과 response body에 노출되지 않도록 masking했습니다.
- 생성된 k6 스크립트에서도 `extract` 결과가 `undefined`이면 k6 `check` 실패로 표시되도록 했습니다.

## [0.3.0] - 2026-05-10

### Added

- Scenario YAML 작성에 필요한 endpoint 후보를 찾을 수 있도록 `openapi-k6 catalog` 명령을 추가했습니다.
- PR/push 시 Node.js 20에서 typecheck, test, build, npm pack 검증을 실행하는 CI workflow를 추가했습니다.
- `npm pack`으로 만든 tarball을 `npm exec --package`로 실행해 `--version`과 기존 `init`, `update`, `sync`, `catalog`, `test`, `generate` 흐름을 확인하는 하위 호환성 smoke test를 추가했습니다.

### Changed

- `openapi-k6 catalog`가 catalog 파일을 찾지 못하면 먼저 실행할 `sync` 명령과 재시도 명령을 안내하도록 했습니다.

## [0.2.1] - 2026-05-07

### Fixed

- npm/npx가 bin을 symlink로 실행할 때 CLI entrypoint가 실행되지 않던 문제를 수정했습니다.

## [0.2.0] - 2026-05-07

### Added

- 기존 `load-tests` 작업공간의 `config.yaml`, `.env`, `scenarios/`, `openapi/`, `generated/`, `logs/`를 보존하면서 README, runner, `.env.example`, `.gitignore`를 갱신하는 `openapi-k6 update` 명령을 추가했습니다.

### Changed

- 기존 작업공간에서 `init`을 다시 실행하면 `init --force` 대신 `update` 사용을 먼저 안내하도록 했습니다.
- 생성되는 `load-tests/README.md`가 선택 module의 실제 snapshot/catalog 경로와 `--config`/`--module` 옵션을 반영하도록 개선했습니다.
- TODO config 값 오류 메시지를 수정 위치와 필드가 더 명확하게 보이도록 정리했습니다.

## [0.1.3] - 2026-05-02

### Added

- 대화형 `init`에서 API base URL만 입력하면 흔한 OpenAPI 경로를 자동 탐색하고 OpenAPI 3.x 문서인지 확인하도록 했습니다.
- OpenAPI 자동 탐색 실패 시 사용자가 직접 URL/파일 경로를 입력하거나 `skip`으로 나중에 설정할 수 있게 했습니다.

### Changed

- CLI `init` 완료 출력과 다음 실행 명령을 더 읽기 쉽게 정리했습니다.
- npm README를 Scenario YAML 중심의 빠른 시작과 API 흐름 연결 예시 중심으로 개선했습니다.
- 생성되는 `load-tests/README.md`의 중복 설명을 줄이고, 사람용 빠른 시작과 AI 작업 guardrail을 분리했습니다.
- maintainer/spec 문서에 대화형 `init` 자동 탐색 흐름을 반영했습니다.

## [0.1.2] - 2026-04-30

### Added

- 공개 배포 이력을 추적하는 `CHANGELOG.md`를 추가했습니다.
- npm 패키지에 `CHANGELOG.md`를 포함하도록 패키지 파일 목록을 갱신했습니다.
- 릴리스 절차에서 changelog 갱신을 누락하지 않도록 maintainer 문서를 보강했습니다.

### Changed

- 사용자 README의 빠른 시작 예시에서 혼동을 줄 수 있는 `/path/to/backend-project` 이동 명령을 제거했습니다.
- npm 랜딩 README를 빠른 시작 중심으로 줄이고, 상세 사용법과 실제 AI 작업 프롬프트는 생성되는 `load-tests/README.md`로 분리했습니다.
- 생성되는 `load-tests/README.md` 상단을 사람용 요약과 한국어 AI 작업 프롬프트 중심으로 정리하고, 상세 명령/DSL 설명은 접힘 영역으로 이동했습니다.
- 생성되는 `load-tests/README.md`에서 AI 작업 프롬프트가 사람이 직접 실행하는 명령보다 먼저 보이도록 순서를 조정했습니다.

## [0.1.1] - 2026-04-30

### Changed

- CLI 버전과 npm 패키지 버전을 `0.1.1`로 올렸습니다.
- GitHub Actions 기반 npm Trusted Publishing 자동 배포 경로가 정상 동작하는지 확인했습니다.

### Verified

- `pnpm run typecheck`
- `pnpm test`
- `pnpm run build`
- `npm pack --dry-run`
- `npm publish`

## [0.1.0] - 2026-04-30

### Added

- `openapi-k6` npm 패키지의 첫 공개 배포를 추가했습니다.
- `npx --yes openapi-k6 ...` 기준의 사용자 설치/실행 문서를 추가했습니다.
- GitHub Actions 기반 npm 배포 workflow를 추가했습니다.
- OpenAPI snapshot/catalog 생성 흐름을 제공했습니다.
- Scenario YAML 작성 후 `openapi-k6 test`로 실제 API 흐름을 검증하는 gate를 문서화했습니다.
- 검증된 scenario를 k6 스크립트로 생성하고 `run.sh`로 실행하는 흐름을 정리했습니다.
- 기존 소스 checkout/link 기반 사용법을 maintainer 문서로 분리했습니다.

### Changed

- 패키지명을 `openapi-k6-runner`에서 `openapi-k6`로 바꾸고 npm 공개 배포 가능 형태로 정리했습니다.
- `load-tests/README.md` scaffold 템플릿을 npm 배포 버전 사용법 중심으로 정리했습니다.

[Unreleased]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aqwsde321/openapi-k6-runner/releases/tag/v0.1.0
