---
name: openapi-k6-scenario
description: Use when the user asks to use $openapi-k6-scenario, create or update an openapi-k6 Scenario YAML after confirming the process and planned API calls, build API flow tests from OpenAPI, verify scenarios with validate/test, group scenarios in folders, reuse login/auth/seed steps through scenario use or include partials, or says requests like "[스킬] 회원 로그인 시나리오", "로그인 시나리오 만들어줘", "Scenario YAML 작성", "openapi-k6 시나리오 테스트까지".
---

# openapi-k6-scenario

Use `openapi-k6` to create scenario-first API flow tests from OpenAPI and finish only after the Scenario YAML is validated and, when the backend is reachable, tested once.

## Project Root

Work from the backend or API project root where the openapi-k6 workspace should live.

The default workspace directory is `openapi-k6/`. If the user or project uses a project/team-specific name, create or use that workspace with `init --dir <path>` and follow the generated README paths.

If the current directory is the `openapi-k6` CLI source repository, do not create scenario files there unless the user explicitly asks to test the CLI itself. Ask for or infer the target backend project root.

## Workspace Setup

At the start of a scenario task:

1. If a workspace README exists (`openapi-k6/README.md` by default, or the path chosen with `--dir`), read only the top task contract sections needed for command paths and file rules: `AI 작업 계약`, `프로젝트 값`, and `명령`.
   - If those sections were already read in this conversation after the latest `init`, `update`, or README change, do not reread them. Reuse the known guidance and open only a specific section if needed.
2. If the workspace README is missing, run `npx --yes openapi-k6@latest init` only after the target project root is clear. Add `--dir <path>` only when the user asks for a non-default workspace name. Then read the generated README's top task contract sections.
3. Never rerun `init` in an existing workspace. If `load-tests/config.yaml` exists and `openapi-k6/config.yaml` does not, run `npx --yes openapi-k6@latest update` to migrate the legacy default workspace to `openapi-k6/`.
4. If scaffold guidance is stale or the CLI prints `Scaffold update available`, ask before running `npx --yes openapi-k6@latest update`; after update, reread only the top task contract sections.
5. Read the config path from the generated README (`openapi-k6/config.yaml` by default). If required values still contain `TODO`, ask for the missing API base URL or OpenAPI location instead of guessing.
6. Run `npx --yes openapi-k6@latest sync` when snapshots/catalogs are missing, stale, or the user wants latest OpenAPI.

Do not edit scaffold-managed files unless the user explicitly asks: workspace `README.md`, `run.sh`, `.env.example`, `.gitignore`, `.openapi-k6.json`, `openapi/*`, and `generated/*`.

## Scenario Workflow

1. Convert the user's request into endpoint search terms.
   - Example: `회원 로그인 시나리오` -> `회원`, `로그인`, `member`, `login`, `auth`.
2. Run `npx --yes openapi-k6@latest catalog --query <term> --ai`.
   - Use `--sync` only when a fresh OpenAPI snapshot is needed.
   - If one term is weak, try a small number of adjacent terms.
3. Read the matching catalog output and, when needed, the workspace `openapi/*.catalog.json`.
4. Resolve the API flow with the user only if multiple plausible endpoints or required business data cannot be inferred.
5. Before writing or editing Scenario YAML, summarize the process and planned API calls, then get explicit user confirmation.
6. After confirmation, write or update one scenario file under the workspace `scenarios/**/*.yaml`.
7. Start with top-level `name`, `description`, and plain steps: `id`, `api`, `request`, `extract`, `condition`.
8. Run `npx --yes openapi-k6@latest validate -s <scenario-key>`.
9. Fix validation failures from the reported errors and fix hints.
10. Run `npx --yes openapi-k6@latest test -s <scenario-key>` when the backend is reachable and required env/vars are available.
11. Fix API-flow failures by adjusting request data, extracts, headers, or endpoint selection based on the observed failure.

Completion means the scenario exists and `validate` passes. If `test` cannot run because the backend, auth data, or env values are unavailable, report the exact blocker and leave the scenario in the best validated state.

## Confirmation Gate

Do not create or modify Scenario YAML until the user confirms the plan.

The confirmation summary must include:

- Scenario purpose, target scenario key, and target scenario file path.
- Scenario description to write in top-level `description:`.
- API call sequence with method/path or operationId.
- Required request data, including which values come from `{{env.*}}`, `{{vars.*}}`, or `{{k6.*}}`.
- Values extracted from earlier responses and where they are reused.
- Existing scenarios to `use`, partials to include, or new reusable files to create.
- Assumptions, ambiguous endpoint choices, and test data the user must provide.

If the user replies with a short affirmative response such as `ㅇ`, `ok`, or `ㄱ`, treat that as confirmation and proceed. If the user changes the process or endpoint choice, update the plan and ask for confirmation again when the change affects the API call sequence or data dependencies.

## Scenario Authoring Rules

- Prefer `api.operationId` when it is unique and stable.
- Use `api.method` and `api.path` when `operationId` is missing or ambiguous.
- Add top-level `description:` for every entry scenario so the UI summary explains what the scenario verifies. Keep it to 1-3 concise lines about the business flow, API target, and success criteria.
- Do not leave `<...>` placeholders before validation.
- Keep secrets out of Scenario YAML. Use `{{env.NAME}}` only for secrets and environment-specific connection values, and tell the user which workspace `.env` values are required.
- Do not put ordinary test data in `.env`. Use `vars:` for repeated non-secret values.
- Use `fixtures:` or `--var-file` for environment-specific non-secret data.
- Use `--var name=value` only for one-off overrides.
- Use the value precedence `fixtures:` < `vars:` < `--var-file` < `--var`.
- For generated emails, external IDs, order numbers, and other synthetic unique data, prefer the simple pattern `{{k6.run.id}}-{{k6.scenario.iterationInTest}}` before introducing fixture datasets.
- Introduce fixed dataset files only when the API must use pre-existing accounts, tenants, branches, permissions, or other stateful records that cannot be generated by the scenario.
- Use `{{k6.run.id}}` as a scenario start timestamp prefix when repeated load-test runs might collide with existing data. It can be fixed with the `OPENAPI_K6_RUN_ID` environment variable.
- Use `{{k6.scenario.iterationInTest}}`, `{{k6.vu.idInTest}}`, or `{{k6.vu.iterationInScenario}}` when generated k6 runs need per-iteration or per-VU values.
- Remember that `test` resolves `{{k6.*}}` as one VU on the first iteration by default. Use `test --iterations <count>` when you need to verify increasing iteration values before generated k6 runs.
- Use folder-based scenario keys when they improve scanability, for example `auth/login` for `openapi-k6/scenarios/auth/login.yaml`.
- Scenario keys must be extensionless and must not include `.yaml`, dotted filenames like `auth/login.v2`, empty path segments, `.`, or `..`.
- Generated k6, log, and report paths preserve the scenario key folders, for example `generated/auth/login.k6.js` and `logs/auth/login.log`.
- Do not run long load tests unless the user asks. After `validate`/`test`, suggest `run` or `generate` commands instead of running them automatically.

## Reusing Existing Steps

Use scenario-root `use` for reusable flows that are useful as named scenarios, and include partials for small local fragments.

For a reusable scenario in another folder:

```yaml
steps:
  - use: auth/login
  - id: get-me
    api:
      operationId: getMe
    request:
      headers:
        Authorization: "Bearer {{token}}"
```

`use` rules:

- Resolve from the workspace scenario root, for example `auth/login` -> `scenarios/auth/login.yaml`.
- Use an extensionless key such as `auth/login`; do not use `auth/login.yaml` or `auth/login.v2`.
- Keep the value static; do not use templates.
- Keep shared data in the entry scenario. Reused files must not define `vars:` or `fixtures:`.
- Ensure reused step ids do not duplicate local step ids.

Use include partials for repeated login, auth token, setup, seed, or cleanup fragments that should stay relative to the entry scenario file.

Before writing a repeated fragment:

1. Look for reusable files under the workspace `scenarios/partials/*.yaml`.
2. If a suitable partial exists, include it:

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

3. If the repeated flow does not exist yet and at least two scenarios need it, create a partial.

Partial rules:

- Put only `steps:` in partial files.
- Do not put `name:`, `vars:`, or `fixtures:` in partial files.
- Manage variables in the entry scenario.
- Keep include paths relative to the entry scenario file and inside the scenario directory.
- Ensure included step ids do not duplicate local step ids.

## Multi-Module APIs

Use OpenAPI modules only when one scenario must call multiple API servers or OpenAPI specs.

- Inspect existing modules with `npx --yes openapi-k6@latest module list`.
- Add a module only when needed, using `npx --yes openapi-k6@latest module add <name> --base-url <url> --sync`.
- In scenario steps, use `api.module` only for calls that should not use the default module.

Do not confuse module APIs with include partials: modules select an API spec/server; include partials reuse step sequences.

## Verification Report

When finished, report:

- Scenario file path.
- Reused or created partials.
- Required workspace `.env` keys or vars.
- `validate` command and result.
- `test` command and result, or the exact reason it could not run.
- Suggested next command only if useful, such as `generate` or a short `run`.
