---
title: UI·Suite·운영
description: 로컬 UI 실행 모델, suite·report 계약, 테스트 계층과 npm 배포 절차
read_when: UI route·상태, suite 실행, report 형식, CI·smoke·release를 변경할 때
---

[← Project Context](../project-context.md)

# UI·Suite·운영

## 로컬 UI 실행 모델

`openapi-k6 ui`는 browser를 자동으로 열지 않고 로컬 HTTP 서버 URL을 출력한다. 기본 bind는 `127.0.0.1:3766`이며 기본 포트가 사용 중이면 인접 포트를 제한적으로 시도한다. `/`와 `/index.html`은 번들된 React UI를 제공하고 `/ui-assets/**`만 정적 자산으로 노출한다. 이전 전환용 `/next*`와 `/legacy*` route는 없다. 서버는 scenario/suite 목록·상세, 실행, report 조회·다운로드, 상태 점검 route를 제공한다. 근거: [React UI](../../src/cli/ui/app/App.tsx), [UI server](../../src/cli/ui/server.ts), [HTTP lifecycle](../../src/cli/ui/server-http.ts).

scenario validate/test는 새 엔진을 구현하지 않고 명시적 scenario·config 경로로 기존 CLI를 다시 호출한다. 실행 상태는 프로세스 메모리 `Map`에 두며 stdout/stderr, step 결과, input 요청을 SSE로 전달한다. UI test는 요청·응답 상세 수집을 기본 활성화하고, input step은 사용자가 값을 제출할 때 같은 실행을 대기한다. 실제 파싱·검증·요청 규칙은 [Scenario 파이프라인](./scenario-pipeline.md)이 canonical이다. 근거: [UI run adapter](../../src/cli/ui/run-command.ts), [run state](../../src/cli/ui/run-state.ts).

서버에는 인증·Origin 검사가 없고 상세 실행값이 SSE에 포함될 수 있다. 따라서 loopback 기본값을 유지한다. 외부 bind, 장기 실행, 실행 이력 영속화를 추가하려면 접근 통제, 메모리 정리, 재시작 후 상태 의미를 먼저 정해야 한다.

## Suite와 실패 정책

suite YAML은 `name`, 선택 `description`, 비어 있지 않은 `scenarios` 목록으로 구성된다. scenario key는 template, 절대경로, 확장자, 빈·`.`·`..` segment와 중복을 허용하지 않는다. suite는 step 재사용 기능이 아니라 최종 scenario 실행 순서를 정의한다. 근거: [suite parser](../../src/parser/suite.parser.ts), [suite parser tests](../../test/suite.parser.test.ts).

CLI `test`는 기존 `--scenario`와 additive `--suite` 중 정확히 하나를 요구한다. suite test는 선언 순서대로 기존 `runTestCommand`를 재사용하며, 한 scenario가 실패해도 다음 scenario를 실행해 전체 결과를 수집한다. 반면 각 scenario 내부에서는 첫 실패 step 뒤 요청을 중단한다. 이 두 실패 정책을 합치지 않는다. 공개 명령 호환성은 [CLI와 작업공간](./cli-workspace.md)을 따른다. 근거: [CLI dispatch](../../src/cli/program.ts), [suite orchestration](../../src/cli/scenario-command.ts), [CLI tests](../../test/cli.test.ts).

UI suite validate는 공개 `validate --suite` 명령이 아니다. UI가 suite 항목을 순회하며 단일 scenario validate를 호출하는 전용 orchestration이다. UI suite test는 CLI suite orchestration을 직접 사용한다.

## Report 계약

suite test는 성공·실패 모두 `<workspace>/reports/<timestamp>_<suite-key>.json`을 쓴다. JSON에는 suite 정보, aggregate scenario/step 수, duration, scenario별 결과와 step method/path/status/condition/extract/error를 기록한다. 요청·응답 body는 의도적으로 저장하지 않는다. UI 실행 중 SSE 상세값과 영속 report의 데이터 범위를 같게 만들지 않는다. 근거: [suite report writer](../../src/cli/scenario-command.ts), [report assertions](../../test/cli.test.ts).

UI는 기존 JSON report를 다시 읽어 최신순으로 보여주고 raw JSON, 렌더링한 HTML, 두 형식의 download를 제공한다. report id는 reports 디렉터리의 basename `.json`만 허용한다. 필드명을 바꿀 때 이미 저장된 report와의 읽기 호환성을 고려한다. 근거: [UI reports](../../src/cli/ui/reports.ts).

## 검증과 배포 계층

| 계층 | 확인 범위 |
| --- | --- |
| `pnpm test` | parser, validator, executor, generator, CLI, UI·suite/report 통합 |
| `pnpm run typecheck` / `build` | strict TypeScript와 npm 배포용 `dist`·scaffold asset |
| `pnpm run smoke:ui-assets` | 설치 tarball의 React UI·정적 자산·API/SSE와 legacy 파일·route 부재 |
| `pnpm run smoke:e2e` | 서로 다른 seed/auth/bos 서버의 init→module/sync→validate→test→generate→run |
| `pnpm run test:compat` | packed tarball의 npx 흐름, legacy workspace 명시적 `--config` 실행, 사용자 자산 보존 |
| `npm pack --dry-run` | 배포 파일과 package metadata |
| `pnpm run smoke:published` | npm registry 실제 배포본의 version/help/init/standalone validate·generate |

PR/main CI는 Node 20에서 install, typecheck, test, build, 설치 tarball UI smoke, E2E, compatibility smoke, pack을 모두 실행한다. `vX.Y.Z` publish는 tag commit이 main에 포함되고 tag와 package version이 일치해야 하며 Node 24에서 typecheck, test, build, 설치 tarball UI smoke, E2E, pack 후 npm publish한다. Publish job에는 `test:compat`가 없고, 성공 뒤 published smoke가 별도 실행된다. 근거: [CI workflow](../../.github/workflows/ci.yml), [publish workflow](../../.github/workflows/publish.yml), [published smoke workflow](../../.github/workflows/published-smoke.yml).

suite/report/UI는 Vitest 통합 테스트와 설치 tarball UI smoke가 검증한다. E2E·compatibility·published smoke는 UI 흐름을 직접 실행하지 않는다. UI 육안 확인은 build 후 `pnpm run sample:ui`로 임시 workspace를 띄워 수행한다.

## 검증 방법

```bash
pnpm exec vitest run test/suite.parser.test.ts test/cli.test.ts test/ui.base-url.test.ts test/ui.scenario-paths.test.ts
pnpm run typecheck
pnpm test
pnpm run build
pnpm run smoke:ui-assets
pnpm run smoke:e2e
pnpm run test:compat
npm pack --dry-run
```

## 미확정 사항

없음. 다만 suite/report/UI가 smoke 계층에 포함되지 않은 상태는 새 회귀가 생기면 재검토한다.

## 근거

- [suite parser](../../src/parser/suite.parser.ts)
- [suite command](../../src/cli/scenario-command.ts)
- [UI server](../../src/cli/ui/server.ts)
- [UI run adapter](../../src/cli/ui/run-command.ts)
- [UI run state](../../src/cli/ui/run-state.ts)
- [UI reports](../../src/cli/ui/reports.ts)
- [CI workflow](../../.github/workflows/ci.yml)
- [publish workflow](../../.github/workflows/publish.yml)
- [published smoke](../../scripts/published-smoke.mjs)
