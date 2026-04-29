# Maintainer Notes

이 문서는 이 저장소 자체를 수정하거나 npm 배포 전 로컬 checkout 코드를 직접 실행하는 사람을 위한 문서입니다.

## 역할

이 저장소는 백엔드 프로젝트 안의 `load-tests/` 작업 폴더를 생성하고 갱신하는 CLI 원본입니다.

즉:

- 이 저장소 자체는 보통 테스트 결과물을 담지 않습니다.
- 결과물은 대상 백엔드 프로젝트 안의 `load-tests/`에 생성됩니다.
- npm 배포 버전 사용자는 보통 `npx --yes openapi-k6 ...`로 실행합니다.
- 저장소 내부 개발/검증은 `pnpm install` 후 `pnpm test`, `pnpm run typecheck`, `pnpm run build`로 진행합니다.

## 핵심 엔트리포인트

- CLI 진입점: `src/cli/index.ts`
- 빌드 산출물: `dist/cli/index.js`
- 명령 구현: `src/cli/index.ts`
- OpenAPI snapshot/catalog: `src/openapi/openapi.catalog.ts`
- Scenario 실행 검증: `src/executor/scenario.executor.ts`
- k6 생성: `src/compiler/k6.generator.ts`
- init scaffold: `src/scaffold/load-test.init.ts`
- 생성 README 템플릿: `src/scaffold/templates/load-tests.README.md`

## 소스에서 직접 실행하기

npm 배포 버전이 아니라 현재 checkout 코드를 직접 테스트하려면 아래처럼 실행합니다.

```bash
git clone https://github.com/aqwsde321/openapi-k6-runner.git
cd openapi-k6-runner
pnpm install
pnpm run build
node ./dist/cli/index.js --help
```

백엔드 프로젝트에 현재 checkout 코드를 바로 적용해 보려면, 백엔드 프로젝트 루트에서 빌드된 CLI 파일을 직접 실행합니다.

```bash
cd <백엔드 프로젝트 루트>
node <openapi-k6-runner 저장소 루트>/dist/cli/index.js init
node <openapi-k6-runner 저장소 루트>/dist/cli/index.js sync
node <openapi-k6-runner 저장소 루트>/dist/cli/index.js test -s smoke
node <openapi-k6-runner 저장소 루트>/dist/cli/index.js generate -s smoke
```

개발 중 전역 명령처럼 반복해서 쓰고 싶을 때만 link를 사용합니다.

```bash
cd <openapi-k6-runner 저장소 루트>
pnpm install
pnpm run build
pnpm link --global

cd <백엔드 프로젝트 루트>
openapi-k6 init
```

`pnpm link --global`에서 global bin directory 오류가 나면 pnpm shell 설정을 적용한 뒤 다시 link합니다.

```bash
pnpm setup
source ~/.zshrc
cd <openapi-k6-runner 저장소 루트>
pnpm link --global
openapi-k6 --help
```

로컬 코드만 수정했을 때는 다시 빌드합니다.

```bash
pnpm run build
```

수동 빌드가 번거로우면 별도 터미널에서 watch 빌드를 켜둡니다. 새 버전으로 업데이트한 뒤에는 watch를 다시 시작하는 편이 안전합니다.

```bash
pnpm run build:watch
```

## 현재 repo 검증

이 저장소에서 전체 검증을 실행합니다.

```bash
pnpm test
pnpm run typecheck
pnpm run build
npm pack --dry-run
```

로컬 npm 캐시 권한 문제로 `npm pack --dry-run`이 실패하면 임시 캐시를 지정해 패키지 내용을 확인할 수 있습니다.

```bash
npm --cache /private/tmp/npm-cache pack --dry-run
```

## npm 배포

패키지 이름은 `openapi-k6`이고, CLI bin도 `openapi-k6`입니다.

배포는 GitHub Actions의 npm Trusted Publishing을 기준으로 자동화합니다. npm 패키지 설정에서 Trusted Publisher를 아래 값으로 등록해야 합니다.

| 항목 | 값 |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `aqwsde321` |
| Repository | `openapi-k6-runner` |
| Workflow filename | `publish.yml` |
| Environment name | 비워둠 |

배포 절차:

```bash
# package.json version을 먼저 올리고 커밋
git tag v0.1.1
git push origin main --tags
```

`.github/workflows/publish.yml`은 태그의 `v`를 제외한 값과 `package.json`의 `version`이 같을 때만 `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `npm pack --dry-run`, `npm publish`를 실행합니다.

## bootstrap 시나리오

새 빈 백엔드 프로젝트 디렉터리에서 `init`이 `load-tests/`를 만들고, `config.yaml` 설정 후 `sync -> test -> generate -> run.sh`가 정상 진행해야 합니다.

예:

```bash
cd /tmp/smoke-backend
node <openapi-k6-runner 저장소 루트>/dist/cli/index.js init
# load-tests/config.yaml 의 baseUrl, modules.default.openapi 값을 실제 값으로 설정
node <openapi-k6-runner 저장소 루트>/dist/cli/index.js sync
node <openapi-k6-runner 저장소 루트>/dist/cli/index.js test -s smoke
node <openapi-k6-runner 저장소 루트>/dist/cli/index.js generate -s smoke
./load-tests/run.sh smoke --log
```

기존 bootstrap 초기화가 필요할 때만 아래처럼 실행합니다.

```bash
node <openapi-k6-runner 저장소 루트>/dist/cli/index.js init --force
```

## 문서 원칙

- root `README.md`
  - npm 배포 버전을 사용하는 대상 프로젝트 사용자가 먼저 읽는 문서
- `src/scaffold/templates/load-tests.README.md`
  - `init` 후 대상 프로젝트에 생성되는 실제 작업 가이드
- `docs/03-maintainer-notes.md`
  - 도구 저장소 수정, 로컬 checkout 실행, npm 배포용 문서
- `docs/spec/*`
  - 기능 계약과 설계 기준
- `docs/planning/*`
  - 구현 이력과 후속 후보

사용자 문서와 개발자 문서를 다시 섞지 않는 것이 중요합니다.
