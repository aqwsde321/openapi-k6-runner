# Changelog

이 프로젝트의 공개 npm 배포 이력을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 따르고, 버전 번호는 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 기준으로 관리합니다.

## [Unreleased]

- 아직 릴리스되지 않은 변경 사항을 여기에 기록합니다.

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

[Unreleased]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/aqwsde321/openapi-k6-runner/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aqwsde321/openapi-k6-runner/releases/tag/v0.1.0
