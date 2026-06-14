---
title: Scenario key와 path 입력 분리
date: 2026-06-14
category: design-decisions
module: cli
problem_type: compatibility_regression
component: scenario-resolution
severity: medium
tags: [scenario-key, scenario-use, cli-compatibility, ui, generated-paths]
related_files:
  - src/parser/scenario.parser.ts
  - src/cli/index.ts
  - src/scaffold/load-test.init.ts
  - test/cli.test.ts
  - test/scenario.parser.test.ts
  - README.md
  - src/scaffold/templates/openapi-k6.README.md
---

## 문제

폴더 기반 scenario를 지원하면서 `openapi-k6/scenarios/auth/login.yaml`, `-s auth/login`, UI 그룹 표시, generated/log/report 경로 보존을 함께 맞춰야 했다.

비자명한 부분은 `--scenario`가 공개 옵션이고 의미가 `path-or-name`이라는 점이었다. 슬래시가 있고 확장자가 없는 값을 모두 내부 scenario key로 보면 기존 상대 경로 입력의 의미가 바뀔 수 있다.

## 증상

- `auth/login` 같은 nested scenario key는 `openapi-k6/scenarios/auth/login.yaml`로 해석되어야 한다.
- `custom/scenario` 같은 기존 명시적 경로가 실제로 존재하면 계속 그 파일로 해석되어야 한다.
- UI id `auth/login`은 프로젝트 루트에 `auth/login` 파일이 있어도 `openapi-k6/scenarios/auth/login.yaml`을 가리켜야 한다.
- `login.v2.yaml` 같은 dotted filename은 key parser가 확장자로 판단하므로 `auth/login.v2` key로 안전하게 바꿀 수 없다.
- `run.sh auth/login --log`는 `tee`가 `login.log`를 쓰기 전에 `logs/auth/`를 만들어야 한다.
- `use: auth/login`으로 다른 scenario steps를 재사용할 때도 같은 key namespace를 써야 한다.
- UI detail API가 재사용 참조를 내려줘도 화면에 표시하지 않으면 사용자는 어떤 scenario가 펼쳐졌는지 알 수 없다.

## 원인

폴더 기반 지원으로 내부 scenario key namespace가 생겼고, 이 namespace가 기존 상대 경로 입력과 겹쳤다. CLI 명령, UI id, generated output stem, scaffold runner의 log/report 경로가 비슷한 문자열을 공유했지만 각 문자열의 소유 경계는 달랐다.

## 결정 사항

- top-level name과 안전한 nested key는 additive하게 지원한다: `smoke`, `auth/login`.
- 일반 CLI resolution에서는 슬래시가 포함된 명시적 경로가 실제로 존재하면 scenario key보다 경로를 우선한다.
- UI resolution에서는 UI가 만든 id라면 scenario directory key를 우선한다.
- `scenarios/` 아래 scenario 파일은 nested output stem을 보존해 `generated/auth/login.k6.js`처럼 만든다.
- `auth/login.v2.yaml`처럼 valid scenario key가 아닌 파일명은 key id 대신 display path를 UI id로 쓴다.
- 생성되는 `run.sh`에서는 `logs/`만 만들지 말고 `$(dirname "$LOG_FILE")`를 만든다.
- `steps[].use`는 `openapi-k6/scenarios` 기준의 확장자 없는 valid scenario key만 받는다. `auth/login.v2`나 `auth/login.yaml`은 거부한다.
- `use`로 펼친 step의 `extract`는 같은 실행 context에 저장되어 뒤 step에서 `{{token}}`, `{{orderId}}`처럼 참조한다.
- UI detail 화면에는 펼쳐진 steps뿐 아니라 `reuse auth/login` 같은 참조 pill을 표시한다.

## 검증 방법

- `PATH=/opt/homebrew/bin:$PATH pnpm run typecheck`
- `PATH=/opt/homebrew/bin:$PATH pnpm run build`
- `/bin/zsh -lc "PATH=/opt/homebrew/bin:$PATH pnpm test"`
- `/bin/zsh -lc "PATH=/opt/homebrew/bin:$PATH NPM_CONFIG_CACHE=/private/tmp/openapi-k6-runner-npm-cache pnpm run test:compat"`
- `/bin/zsh -lc "PATH=/opt/homebrew/bin:$PATH pnpm run smoke:e2e"`
- parser test에서 `use` 성공, 확장자/dotted key 거부, `..`/absolute path 거부, cycle 감지를 확인한다.
- CLI test에서 `use` 흐름의 `validate -> test -> generate`, UI detail/list, module remove 참조 검사를 확인한다.

## 재발 방지

기존 공개 `path-or-name` 옵션에 shorthand identifier를 추가할 때는 문자열의 소유 계층을 먼저 나눈다.

- 공개 CLI path input
- workspace-relative scenario key
- UI scenario id
- generated output stem
- runner log/report path

shorthand를 받아들이기 전에 계층 간 충돌 회귀 테스트를 추가한다.

## 재사용 체크리스트

- 새 shorthand가 유효한 상대 파일 경로와 겹치는가?
- 슬래시가 포함된 입력이 디스크에 실제로 있으면 path resolution이 우선해야 하는가?
- UI가 생성한 상태값은 일반 CLI 입력보다 더 엄격한 resolver가 필요한가?
- 새 재사용 문법이 UI id와 같은 문자열 집합을 쓰는가? 그렇다면 dotted filename 같은 key-safe하지 않은 값의 정책을 맞췄는가?
- API가 내려주는 메타데이터가 실제 UI에 표시되는가?
- generated file, log, report가 nested path를 일관되게 보존하는가?
- dotted filename이나 key-safe하지 않은 이름도 UI action을 깨지 않고 처리하는가?
