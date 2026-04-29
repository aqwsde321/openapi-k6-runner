import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/index.js';

function createSink(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function createCapture(options: { isTTY?: boolean } = {}): { stream: Writable & { isTTY?: boolean }; output: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  }) as Writable & { isTTY?: boolean };

  stream.isTTY = options.isTTY;

  return {
    stream,
    output: () => Buffer.concat(chunks).toString('utf8'),
  };
}

async function waitForOutput(readOutput: () => string, expected: string): Promise<void> {
  const deadline = Date.now() + 1000;

  while (!readOutput().includes(expected)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for output: ${expected}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function writeGenerateFixtures(workspace: string, serverUrl = 'https://openapi.test.local'): Promise<void> {
  await writeFile(
    path.join(workspace, 'scenario.yaml'),
    [
      'name: smoke',
      'steps:',
      '  - id: health',
      '    api:',
      '      operationId: getHealth',
      '    condition: status == 200',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(workspace, 'openapi.yaml'),
    [
      'openapi: 3.0.3',
      'info:',
      '  title: Fixture API',
      '  version: 1.0.0',
      'servers:',
      `  - url: ${serverUrl}`,
      'paths:',
      '  /health:',
      '    get:',
      '      operationId: getHealth',
      '      responses:',
      '        "200":',
      '          description: OK',
      '',
    ].join('\n'),
    'utf8',
  );
}

describe('openapi-k6 CLI', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-cli-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('creates a generated k6 output file when required options are provided', async () => {
    await writeGenerateFixtures(workspace);

    await runCli(
      [
        'generate',
        '--scenario',
        'scenario.yaml',
        '--openapi',
        'openapi.yaml',
        '--write',
        'generated/script.js',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const outputPath = path.join(workspace, 'generated/script.js');
    const output = await readFile(outputPath, 'utf8');

    expect(output).toContain("import http from 'k6/http';");
    expect(output).toContain('const BASE_URL = __ENV.BASE_URL || "https://openapi.test.local";');
    expect(output).toContain('import { check, group } from \'k6\';');
    expect(output).toContain('group("health GET /health", () => {');
    expect(output).toContain('const params0 = { tags: tags0 };');
    expect(output).toContain('const res0 = http.get(url0, params0);');
    expect(output).toContain('"health status == 200": (res) => res.status === 200,');
  });

  it('initializes a load-tests scaffold in the target project', async () => {
    const cliPath = path.join(workspace, 'openapi-k6-runner/dist/cli/index.js');

    await runCli(
      [
        'init',
        '--module',
        'pharma',
        '--base-url',
        'https://dev-api.pharmaresearch.com',
        '--openapi',
        'https://dev-api.pharmaresearch.com/v3/api-docs',
        '--smoke-path',
        '/__dev/error-codes',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink(), cliPath },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');
    const envExample = await readFile(path.join(workspace, 'load-tests/.env.example'), 'utf8');
    const gitignore = await readFile(path.join(workspace, 'load-tests/.gitignore'), 'utf8');
    const runScriptPath = path.join(workspace, 'load-tests/run.sh');
    const runScript = await readFile(runScriptPath, 'utf8');
    const runScriptStat = await stat(runScriptPath);
    const runScriptSyntax = spawnSync('bash', ['-n', runScriptPath], { encoding: 'utf8' });
    const scenario = await readFile(path.join(workspace, 'load-tests/scenarios/smoke.yaml'), 'utf8');
    const readme = await readFile(path.join(workspace, 'load-tests/README.md'), 'utf8');

    expect(config).toBe([
      '# API 호출 기준 URL입니다. 생성된 k6 스크립트의 기본 BASE_URL로 사용됩니다.',
      '# k6 실행 시 BASE_URL 환경 변수를 넘기면 이 값보다 우선합니다.',
      'baseUrl: https://dev-api.pharmaresearch.com',
      '',
      '# 기본으로 사용할 OpenAPI module 이름입니다.',
      '# 아래 modules.<name> 중 하나와 같아야 합니다.',
      '# module이 1개뿐이면 보통 default 그대로 둬도 됩니다.',
      'defaultModule: pharma',
      '',
      '# OpenAPI module 목록입니다.',
      '# module을 여러 개 두면 openapi-k6 sync/generate에서 --module <name>으로 선택할 수 있습니다.',
      'modules:',
      '  pharma:',
      '    # sync가 읽을 OpenAPI URL 또는 파일 경로입니다.',
      '    # 예: https://api.example.com/v3/api-docs',
      '    openapi: https://dev-api.pharmaresearch.com/v3/api-docs',
      '',
      '    # sync가 저장하고 generate가 읽을 OpenAPI snapshot 경로입니다.',
      '    # 상대 경로는 이 config.yaml 위치 기준입니다.',
      '    snapshot: openapi/pharma.openapi.json',
      '',
      '    # scenario 작성자가 endpoint를 고를 때 참고할 catalog 경로입니다.',
      '    # generate 입력은 catalog가 아니라 snapshot입니다.',
      '    catalog: openapi/pharma.catalog.json',
      '',
    ].join('\n'));
    expect(envExample).toBe([
      '# Copy this file to .env next to run.sh and fill local secret values.',
      '# run.sh auto-loads this .env file. Plain k6 run does not.',
      '',
      '# Add or rename variables to match {{env.NAME}} templates in scenario YAML.',
      'LOGIN_ID=',
      'LOGIN_PASSWORD=',
      '',
    ].join('\n'));
    expect(gitignore).toBe('.env\nlogs/\n');
    expect(runScript).toContain('#!/usr/bin/env bash');
    expect(runScript).toContain('SCENARIO="smoke"');
    expect(runScript).toContain('LOG_ENABLED=false');
    expect(runScript).toContain('TRACE_ENABLED=false');
    expect(runScript).toContain('REPORT_ENABLED=false');
    expect(runScript).toContain('DASHBOARD_OPEN_ENABLED=false');
    expect(runScript).toContain('K6_ARGS=()');
    expect(runScript).toContain('Usage: $0 [scenario] [run.sh flags] [k6 run options]');
    expect(runScript).toContain('This script loads only the .env file next to run.sh.');
    expect(runScript).toContain('It does not load the backend project root .env.');
    expect(runScript).toContain('See README.md in this directory for the full workflow.');
    expect(runScript).toContain('source "$ENV_FILE"');
    expect(runScript).toContain('LOG_FILE="$LOG_DIR/$SCENARIO.log"');
    expect(runScript).toContain('REPORT_FILE="$LOG_DIR/$SCENARIO-report.html"');
    expect(runScript).toContain('export OPENAPI_K6_TRACE=1');
    expect(runScript).toContain('export K6_WEB_DASHBOARD=true');
    expect(runScript).toContain('export K6_WEB_DASHBOARD_PERIOD="${K6_WEB_DASHBOARD_PERIOD:-1s}"');
    expect(runScript).toContain('export K6_WEB_DASHBOARD_EXPORT="${K6_WEB_DASHBOARD_EXPORT:-$REPORT_FILE}"');
    expect(runScript).toContain('export K6_WEB_DASHBOARD_OPEN=true');
    expect(runScript).toContain('k6 run ${K6_ARGS[@]+"${K6_ARGS[@]}"} "$SCRIPT_PATH" 2>&1 | tee "$LOG_FILE"');
    expect(runScript).toContain('status="${PIPESTATUS[0]}"');
    expect(runScript).toContain('exec k6 run ${K6_ARGS[@]+"${K6_ARGS[@]}"} "$SCRIPT_PATH"');
    expect(runScriptStat.mode & 0o111).not.toBe(0);
    expect(runScriptSyntax.stderr).toBe('');
    expect(runScriptSyntax.status).toBe(0);
    expect(scenario).toContain('path: /__dev/error-codes');
    expect(readme).toContain('openapi-k6 sync');
    expect(readme).toContain('openapi-k6 generate \\');
    expect(readme).toContain('  -s smoke');
    expect(readme).toContain('run.sh');
    expect(readme).toContain('./load-tests/run.sh smoke');
    expect(readme).toContain('./load-tests/run.sh smoke --vus 1 --iterations 1');
    expect(readme).toContain('./load-tests/run.sh smoke --log');
    expect(readme).toContain('로그 파일: `load-tests/logs/smoke.log`');
    expect(readme).toContain('`--trace`: 각 scenario step의 시작/종료 로그 출력');
    expect(readme).toContain('`--report`: k6 Web Dashboard HTML report를 `logs/<scenario>-report.html`에 저장');
    expect(readme).toContain('./load-tests/run.sh smoke --report --duration 10s --vus 1');
    expect(readme).toContain('./load-tests/run.sh smoke --trace --log --report --duration 10s --vus 1');
    expect(readme).toContain('`run.sh`는 자신과 같은 폴더의 `.env`(`load-tests/.env`)만 자동으로 로드한 뒤');
    expect(readme).toContain('백엔드 프로젝트 루트의 `.env`는 자동으로 읽지 않습니다.');
    expect(readme).toContain('빠른 사용법은 `run.sh --help`로 확인할 수 있습니다.');
    expect(readme).toContain('## 0. openapi-k6 명령 준비');
    expect(readme).toContain('사람이 꼭 이해해야 하는 내용은 이 README 앞부분에 있습니다.');
    expect(readme).toContain('## 사람이 꼭 알아야 하는 것');
    expect(readme).toContain('직접 수정하는 파일은 이 폴더의 `config.yaml`, `.env`, `scenarios/*.yaml`입니다.');
    expect(readme).toContain('일반적인 config/scenario 작업에서는 `README.md`, `run.sh`, `.env.example`, `.gitignore`를 수정하지 않습니다.');
    expect(readme).toContain('이 README는 `openapi-k6 init`으로 생성되었습니다.');
    expect(readme).toContain('먼저 현재 shell에서 명령이 실행되는지 확인합니다.');
    expect(readme).toContain('pnpm install');
    expect(readme).toContain('pnpm link --global');
    expect(readme).toContain('<details>');
    expect(readme).toContain('<summary>`pnpm link --global`에서 global bin directory 오류가 날 때</summary>');
    expect(readme).toContain('pnpm setup');
    expect(readme).toContain('source ~/.zshrc');
    expect(readme).toContain(`alias openapi-k6='node ${cliPath}'`);
    expect(readme).toContain('전역 link를 쓰지 않는 환경에서는 아래 alias를 현재 터미널에서 실행합니다.');
    expect(readme).toContain('alias는 현재 터미널 세션에만 적용됩니다.');
    expect(readme).toContain(`cd ${path.dirname(path.dirname(path.dirname(cliPath)))}`);
    expect(readme).toContain('pnpm run build');
    expect(readme).toContain('generator 로컬 코드만 수정한 뒤에는 generator 저장소에서 다시 빌드합니다.');
    expect(readme).toContain('generator 저장소를 pull/checkout해서 새 버전으로 업데이트한 뒤에는 의존성도 다시 설치하고 빌드합니다.');
    expect(readme).toContain('pnpm run build:watch');
    expect(readme).toContain('개발 중 수동 빌드가 번거로우면 generator 저장소의 별도 터미널에서 watch 빌드를 켜둡니다.');
    expect(readme).toContain('새 버전으로 업데이트한 뒤에는 watch를 다시 시작하는 편이 안전합니다.');
    expect(readme).toContain('이 폴더는 백엔드 프로젝트 안에서 OpenAPI snapshot, scenario YAML, 생성된 k6 스크립트를 관리합니다.');
    expect(readme).toContain('## 1. 최소 설정');
    expect(readme).toContain('## 2. 기본 실행 흐름');
    expect(readme).toContain('| 순서 | 사용자가 준비하는 것 | 실행 명령 | 생성/갱신되는 것 |');
    expect(readme).toContain('`config.yaml`의 `baseUrl`, `modules.pharma.openapi` TODO 채우기');
    expect(readme).toContain('`load-tests/openapi/pharma.openapi.json`, `load-tests/openapi/pharma.catalog.json`');
    expect(readme).toContain('`load-tests/scenarios/<name>.yaml`');
    expect(readme).toContain('`load-tests/generated/<name>.k6.js`');
    expect(readme).toContain('`./load-tests/run.sh <name> --log`');
    expect(readme).toContain('### 2-1. OpenAPI snapshot/catalog 생성');
    expect(readme).toContain('### 2-2. Scenario YAML 작성');
    expect(readme).toContain('### 2-3. Scenario 검증');
    expect(readme).toContain('### 2-4. k6 스크립트 생성');
    expect(readme).toContain('### 2-5. k6 실행');
    expect(readme).toContain('생성/갱신: `load-tests/openapi/pharma.openapi.json`, `load-tests/openapi/pharma.catalog.json`');
    expect(readme).toContain('`load-tests/openapi/pharma.catalog.json`에서 테스트할 endpoint의 `operationId`, `method`, `path`, `parameters`, `hasRequestBody`, `requestBodyContentTypes`를 확인합니다.');
    expect(readme).toContain('기본 smoke 테스트는 `load-tests/scenarios/smoke.yaml`를 수정합니다.');
    expect(readme).toContain('openapi-k6 test -s smoke');
    expect(readme).toContain('step 실행 중 URL, Running 상태, status, condition, extract 결과를 바로 확인한 뒤 통과한 scenario만 k6 스크립트로 생성합니다.');
    expect(readme).toContain('색상은 터미널에서만 켜지며 `--no-color` 옵션이나 `NO_COLOR=1` 환경변수로 끌 수 있습니다.');
    expect(readme).toContain('생성/갱신: `load-tests/generated/smoke.k6.js`');
    expect(readme).toContain('## 3. 비밀 값 사용');
    expect(readme).toContain('## 4. 자주 하는 수정');
    expect(readme).toContain('## 5. 제거 방법');
    expect(readme).toContain('### Scenario DSL Reference');
    expect(readme).toContain('Endpoint selection:');
    expect(readme).toContain('OperationId-based example:');
    expect(readme).toContain('Method-and-path example:');
    expect(readme).toContain('Authorization: "Bearer {{token}}"');
    expect(readme).toContain('password: "{{env.LOGIN_PASSWORD}}"');
    expect(readme).toContain('Supported templates:');
    expect(readme).toContain('openapi-k6 generate -s login-flow');
    expect(readme).toContain('API base URL은 `openapi-k6 generate` 실행 시점의 `config.yaml` `baseUrl` 값이 생성된 k6 스크립트에 기본값으로 들어갑니다.');
    expect(readme).toContain('`config.yaml`을 수정한 뒤에는 스크립트를 다시 생성해야 반영됩니다.');
    expect(readme).toContain('실행 시점에 `BASE_URL` 환경 변수를 넘기면 스크립트에 들어간 기본값보다 우선합니다.');
    expect(readme).toContain('시나리오에서 `{{env.NAME}}`을 사용한다면 `load-tests/.env.example`을 `load-tests/.env`로 복사한 뒤 비밀 값을 채웁니다.');
    expect(readme).toContain('cp load-tests/.env.example load-tests/.env');
    expect(readme).toContain('`openapi-k6 test`와 `run.sh`가 `load-tests/.env`를 읽습니다.');
    expect(readme).toContain('Read `openapi/*.catalog.json` and inspect `operationId`, `method`, `path`, `parameters`, `hasRequestBody`, and `requestBodyContentTypes`');
    expect(readme).toContain('rm -rf load-tests');
    expect(readme).toContain('필요한 scenario, snapshot, catalog가 있으면 먼저 백업합니다.');
    expect(readme).toContain('## AI Work Guide');
    expect(readme).toContain('This section is for AI agents. Human users only need the Korean sections above unless they want implementation details.');
    expect(readme).toContain('### Workflow');
    expect(readme).toContain('Update or create `scenarios/*.yaml`.');
    expect(readme).toContain('Run `openapi-k6 test` to validate the scenario API flow before generating k6.');
    expect(readme).toContain('Do not edit scaffold-managed files during ordinary backend test work: `README.md`, `run.sh`, `.env.example`, `.gitignore`.');
    expect(readme).toContain('If scaffold docs or helper scripts must change, update the generator template in openapi-k6-runner and rerun `openapi-k6 init --force` intentionally.');
    expect(readme).toContain('Do not edit `generated/*.k6.js` directly. Edit scenario YAML and regenerate.');
    expect(readme).toContain('Keep human-facing documentation in Korean.');
    expect(readme).toContain('Do not write secrets such as passwords directly in YAML. Use `{{env.NAME}}`.');
    expect(readme).toContain('Store real secret values in `load-tests/.env` and do not commit it.');
    expect(readme).toContain('Do not use `request.body` and `request.multipart` in the same step.');
    expect(readme).toContain('Resolve config-relative paths from the directory containing `config.yaml`.');
    expect(readme).toContain('`load-tests/run.sh`: k6 runner that auto-loads `load-tests/.env` values');
    expect(readme).toContain('### Files to inspect');
    expect(readme).toContain('### Prompt Examples');
    expect(readme).toContain('Basic smoke test:');
    expect(readme).toContain('Read load-tests/README.md first and follow it.');
    expect(readme).toContain('Create load-tests/scenarios/basic-read.yaml.');
    expect(readme).toContain('Find the login API and a user-profile/read API.');
    expect(readme).toContain('Do not edit load-tests/README.md, load-tests/run.sh, load-tests/.env.example, or load-tests/.gitignore unless explicitly asked to change scaffold files.');
    expect(readme).toContain('`multipart`: multipart/form-data request body for file uploads');
    expect(readme).toContain('Multipart upload example:');
    expect(readme).toContain('path: fixtures/product.png');
    expect(readme).toContain('Multipart file paths are relative to `load-tests/`.');
    expect(readme).toContain('Spring endpoints such as `@PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)` should be modeled with `request.multipart`.');
    expect(readme.indexOf('## AI Work Guide')).toBeGreaterThan(readme.indexOf('## 5. 제거 방법'));
  });

  it('runs the generated run.sh with --log when no k6 options are provided', async () => {
    await runCli(
      ['init'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );
    await writeFile(
      path.join(workspace, 'load-tests/generated/smoke.k6.js'),
      'export default function () {}\n',
      'utf8',
    );
    const binDir = path.join(workspace, 'bin');
    const argLogPath = path.join(workspace, 'k6-args.txt');
    await mkdir(binDir, { recursive: true });
    await writeFile(
      path.join(binDir, 'k6'),
      [
        '#!/usr/bin/env bash',
        'printf "%s\\n" "$@" > "$K6_ARG_LOG"',
        'echo fake-k6-output',
        '',
      ].join('\n'),
      'utf8',
    );
    await chmod(path.join(binDir, 'k6'), 0o755);

    const result = spawnSync(
      path.join(workspace, 'load-tests/run.sh'),
      ['smoke', '--log'],
      {
        cwd: workspace,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          K6_ARG_LOG: argLogPath,
        },
      },
    );
    const log = await readFile(path.join(workspace, 'load-tests/logs/smoke.log'), 'utf8');
    const args = await readFile(argLogPath, 'utf8');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Writing k6 output to');
    expect(log).toContain('fake-k6-output');
    expect(args).toBe([
      'run',
      path.join(workspace, 'load-tests/generated/smoke.k6.js'),
      '',
    ].join('\n'));
  });

  it('prints generated run.sh usage with --help', async () => {
    await runCli(
      ['init'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const result = spawnSync(
      path.join(workspace, 'load-tests/run.sh'),
      ['--help'],
      {
        cwd: workspace,
        encoding: 'utf8',
        env: process.env,
      },
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('run.sh flags:');
    expect(result.stdout).toContain('k6 options must come after the scenario name.');
    expect(result.stdout).toContain('This script loads only the .env file next to run.sh.');
    expect(result.stdout).toContain('It does not load the backend project root .env.');
  });

  it('runs the generated run.sh with report, trace, and dashboard flags', async () => {
    await runCli(
      ['init'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );
    await writeFile(
      path.join(workspace, 'load-tests/generated/smoke.k6.js'),
      'export default function () {}\n',
      'utf8',
    );
    const binDir = path.join(workspace, 'bin');
    const argLogPath = path.join(workspace, 'k6-args.txt');
    const envLogPath = path.join(workspace, 'k6-env.txt');
    await mkdir(binDir, { recursive: true });
    await writeFile(
      path.join(binDir, 'k6'),
      [
        '#!/usr/bin/env bash',
        'printf "%s\\n" "$@" > "$K6_ARG_LOG"',
        '{',
        '  printf "OPENAPI_K6_TRACE=%s\\n" "${OPENAPI_K6_TRACE-}"',
        '  printf "K6_WEB_DASHBOARD=%s\\n" "${K6_WEB_DASHBOARD-}"',
        '  printf "K6_WEB_DASHBOARD_PERIOD=%s\\n" "${K6_WEB_DASHBOARD_PERIOD-}"',
        '  printf "K6_WEB_DASHBOARD_EXPORT=%s\\n" "${K6_WEB_DASHBOARD_EXPORT-}"',
        '  printf "K6_WEB_DASHBOARD_OPEN=%s\\n" "${K6_WEB_DASHBOARD_OPEN-}"',
        '} > "$K6_ENV_LOG"',
        'echo fake-k6-output',
        '',
      ].join('\n'),
      'utf8',
    );
    await chmod(path.join(binDir, 'k6'), 0o755);

    const result = spawnSync(
      path.join(workspace, 'load-tests/run.sh'),
      ['smoke', '--report', '--trace', '--open-dashboard', '--log', '--duration', '10s', '--vus', '1'],
      {
        cwd: workspace,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          K6_ARG_LOG: argLogPath,
          K6_ENV_LOG: envLogPath,
        },
      },
    );
    const args = await readFile(argLogPath, 'utf8');
    const envLog = await readFile(envLogPath, 'utf8');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Writing k6 HTML report to');
    expect(result.stdout).toContain('Writing k6 output to');
    expect(args).toBe([
      'run',
      '--duration',
      '10s',
      '--vus',
      '1',
      path.join(workspace, 'load-tests/generated/smoke.k6.js'),
      '',
    ].join('\n'));
    expect(envLog).toContain('OPENAPI_K6_TRACE=1');
    expect(envLog).toContain('K6_WEB_DASHBOARD=true');
    expect(envLog).toContain('K6_WEB_DASHBOARD_PERIOD=1s');
    expect(envLog).toContain(`K6_WEB_DASHBOARD_EXPORT=${path.join(workspace, 'load-tests/logs/smoke-report.html')}`);
    expect(envLog).toContain('K6_WEB_DASHBOARD_OPEN=true');
  });

  it('initializes a placeholder scaffold with no required options', async () => {
    await runCli(
      ['init'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');
    const envExample = await readFile(path.join(workspace, 'load-tests/.env.example'), 'utf8');
    const scenario = await readFile(path.join(workspace, 'load-tests/scenarios/smoke.yaml'), 'utf8');

    expect(config).toBe([
      '# API 호출 기준 URL입니다. 생성된 k6 스크립트의 기본 BASE_URL로 사용됩니다.',
      '# k6 실행 시 BASE_URL 환경 변수를 넘기면 이 값보다 우선합니다.',
      'baseUrl: TODO',
      '',
      '# 기본으로 사용할 OpenAPI module 이름입니다.',
      '# 아래 modules.<name> 중 하나와 같아야 합니다.',
      '# module이 1개뿐이면 보통 default 그대로 둬도 됩니다.',
      'defaultModule: default',
      '',
      '# OpenAPI module 목록입니다.',
      '# module을 여러 개 두면 openapi-k6 sync/generate에서 --module <name>으로 선택할 수 있습니다.',
      'modules:',
      '  default:',
      '    # sync가 읽을 OpenAPI URL 또는 파일 경로입니다.',
      '    # 예: https://api.example.com/v3/api-docs',
      '    openapi: TODO',
      '',
      '    # sync가 저장하고 generate가 읽을 OpenAPI snapshot 경로입니다.',
      '    # 상대 경로는 이 config.yaml 위치 기준입니다.',
      '    snapshot: openapi/default.openapi.json',
      '',
      '    # scenario 작성자가 endpoint를 고를 때 참고할 catalog 경로입니다.',
      '    # generate 입력은 catalog가 아니라 snapshot입니다.',
      '    catalog: openapi/default.catalog.json',
      '',
    ].join('\n'));
    expect(envExample).not.toContain('BASE_URL=');
    expect(envExample).toContain('LOGIN_PASSWORD=');
    expect(scenario).toContain('path: /health');
  });

  it('stores relative OpenAPI paths from the generated config directory', async () => {
    await writeGenerateFixtures(workspace);

    await runCli(
      [
        'init',
        '--base-url',
        'https://api.test.local',
        '--openapi',
        'openapi.yaml',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(config).toContain('    openapi: ../openapi.yaml');

    await runCli(
      ['sync'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const snapshot = await readFile(
      path.join(workspace, 'load-tests/openapi/default.openapi.json'),
      'utf8',
    );

    expect(JSON.parse(snapshot).openapi).toBe('3.0.3');
  });

  it('uses the configured scaffold directory in generated README commands', async () => {
    await runCli(
      [
        'init',
        '--dir',
        'perf-tests',
        '--module',
        'pharma',
        '--base-url',
        'https://dev-api.pharmaresearch.com',
        '--openapi',
        'https://dev-api.pharmaresearch.com/v3/api-docs',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const readme = await readFile(path.join(workspace, 'perf-tests/README.md'), 'utf8');

    expect(readme).toContain('# perf-tests');
    expect(readme).toContain('openapi-k6 sync --config perf-tests/config.yaml --module pharma');
    expect(readme).toContain('--config perf-tests/config.yaml');
    expect(readme).toContain('--scenario perf-tests/scenarios/smoke.yaml');
    expect(readme).toContain('--write perf-tests/generated/smoke.k6.js');
    expect(readme).toContain('--scenario perf-tests/scenarios/login-flow.yaml');
    expect(readme).toContain('--write perf-tests/generated/login-flow.k6.js');
    expect(readme).toContain('./perf-tests/run.sh smoke');
    expect(readme).toContain('./perf-tests/run.sh smoke --vus 1 --iterations 1');
    expect(readme).toContain('./perf-tests/run.sh smoke --log');
    expect(readme).toContain('로그 파일: `perf-tests/logs/smoke.log`');
    expect(readme).toContain('./perf-tests/run.sh smoke --report --duration 10s --vus 1');
    expect(readme).toContain('BASE_URL=https://api.example.com ./perf-tests/run.sh smoke');
    expect(readme).toContain('cp perf-tests/.env.example perf-tests/.env');
    expect(readme).toContain('rm -rf perf-tests');
    expect(readme).not.toContain('load-tests/');
  });

  it('shell-quotes scaffold README commands when the directory contains spaces', async () => {
    await runCli(
      [
        'init',
        '--dir',
        'perf tests',
        '--module',
        'pharma',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const readme = await readFile(path.join(workspace, 'perf tests/README.md'), 'utf8');

    expect(readme).toContain("openapi-k6 sync --config 'perf tests/config.yaml' --module pharma");
    expect(readme).toContain("--config 'perf tests/config.yaml'");
    expect(readme).toContain("--scenario 'perf tests/scenarios/smoke.yaml'");
    expect(readme).toContain("--write 'perf tests/generated/smoke.k6.js'");
    expect(readme).toContain("'./perf tests/run.sh' smoke");
    expect(readme).toContain("'./perf tests/run.sh' smoke --log");
    expect(readme).toContain("cp 'perf tests/.env.example' 'perf tests/.env'");
  });

  it('overwrites scaffold-managed files with --force without deleting local artifacts', async () => {
    await runCli(
      [
        'init',
        '--base-url',
        'https://api.test.local',
        '--openapi',
        'https://api.test.local/v3/api-docs',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );
    await writeFile(path.join(workspace, 'load-tests/README.md'), 'stale readme\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/run.sh'), '#!/usr/bin/env bash\necho stale\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/scenarios/smoke.yaml'), 'name: stale\nsteps: []\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/.env'), 'LOGIN_PASSWORD=local-secret\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/scenarios/custom.yaml'), 'name: custom\nsteps: []\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/generated/custom.k6.js'), 'export default function () {}\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/openapi/custom.openapi.json'), '{}\n', 'utf8');
    await mkdir(path.join(workspace, 'load-tests/logs'), { recursive: true });
    await writeFile(path.join(workspace, 'load-tests/logs/smoke.log'), 'old log\n', 'utf8');

    await expect(
      runCli(
        [
          'init',
          '--base-url',
          'https://changed.test.local',
          '--openapi',
          'https://changed.test.local/v3/api-docs',
        ],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('already exists. Use --force to overwrite.');

    await runCli(
      [
        'init',
        '--base-url',
        'https://changed.test.local',
        '--openapi',
        'https://changed.test.local/v3/api-docs',
        '--force',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');
    const readme = await readFile(path.join(workspace, 'load-tests/README.md'), 'utf8');
    const runScript = await readFile(path.join(workspace, 'load-tests/run.sh'), 'utf8');
    const scenario = await readFile(path.join(workspace, 'load-tests/scenarios/smoke.yaml'), 'utf8');
    const env = await readFile(path.join(workspace, 'load-tests/.env'), 'utf8');
    const customScenario = await readFile(path.join(workspace, 'load-tests/scenarios/custom.yaml'), 'utf8');
    const generated = await readFile(path.join(workspace, 'load-tests/generated/custom.k6.js'), 'utf8');
    const snapshot = await readFile(path.join(workspace, 'load-tests/openapi/custom.openapi.json'), 'utf8');
    const log = await readFile(path.join(workspace, 'load-tests/logs/smoke.log'), 'utf8');

    expect(config).toContain('baseUrl: https://changed.test.local');
    expect(readme).toContain('# load-tests');
    expect(readme).toContain('`init --force`는 scaffold 관리 파일만 다시 씁니다.');
    expect(runScript).toContain('exec k6 run ${K6_ARGS[@]+"${K6_ARGS[@]}"} "$SCRIPT_PATH"');
    expect(scenario).toContain('path: /health');
    expect(env).toBe('LOGIN_PASSWORD=local-secret\n');
    expect(customScenario).toBe('name: custom\nsteps: []\n');
    expect(generated).toBe('export default function () {}\n');
    expect(snapshot).toBe('{}\n');
    expect(log).toBe('old log\n');
  });

  it('fails when --scenario is missing', async () => {
    await expect(
      runCli(
        ['generate', '--openapi', 'openapi.yaml', '--write', 'generated/script.js'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
  });

  it('fails when neither --openapi nor default config is available', async () => {
    await expect(
      runCli(
        ['generate', '--scenario', 'scenario.yaml', '--write', 'generated/script.js'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('load-tests/config.yaml was not found. Run openapi-k6 init or pass --config.');
  });

  it('uses a default generated output path when --write is omitted', async () => {
    await writeGenerateFixtures(workspace);

    await runCli(
      ['generate', '--scenario', 'scenario.yaml', '--openapi', 'openapi.yaml'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const output = await readFile(path.join(workspace, 'load-tests/generated/scenario.k6.js'), 'utf8');

    expect(output).toContain('const res0 = http.get(url0, params0);');
  });

  it('includes BASE_URL from .env in the generated output', async () => {
    await writeGenerateFixtures(workspace);
    await writeFile(path.join(workspace, '.env'), 'BASE_URL=https://api.test.local\n', 'utf8');

    await runCli(
      [
        'generate',
        '-s',
        'scenario.yaml',
        '-o',
        'openapi.yaml',
        '-w',
        'generated/script.js',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const output = await readFile(path.join(workspace, 'generated/script.js'), 'utf8');

    expect(output).toContain('const BASE_URL = __ENV.BASE_URL || "https://api.test.local";');
  });

  it('falls back to OpenAPI servers[0].url when .env BASE_URL is absent', async () => {
    await writeGenerateFixtures(workspace, 'https://server-fallback.test.local');

    await runCli(
      [
        'generate',
        '-s',
        'scenario.yaml',
        '-o',
        'openapi.yaml',
        '-w',
        'generated/script.js',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const output = await readFile(path.join(workspace, 'generated/script.js'), 'utf8');

    expect(output).toContain('const BASE_URL = __ENV.BASE_URL || "https://server-fallback.test.local";');
  });

  it('creates OpenAPI snapshot and catalog files with sync command', async () => {
    await writeGenerateFixtures(workspace);

    await runCli(
      [
        'sync',
        '--openapi',
        'openapi.yaml',
        '--write',
        'load-tests/openapi/dev.openapi.json',
        '--catalog',
        'load-tests/openapi/catalog.json',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const snapshot = JSON.parse(
      await readFile(path.join(workspace, 'load-tests/openapi/dev.openapi.json'), 'utf8'),
    ) as Record<string, unknown>;
    const catalog = JSON.parse(
      await readFile(path.join(workspace, 'load-tests/openapi/catalog.json'), 'utf8'),
    ) as { operations: Array<Record<string, unknown>> };

    expect(snapshot.openapi).toBe('3.0.3');
    expect(catalog.operations).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: '/health',
        operationId: 'getHealth',
        hasRequestBody: false,
      }),
    ]);
  });

  it('fails clearly when sync sees TODO config values from init', async () => {
    await runCli(
      ['init'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    await expect(
      runCli(
        ['sync'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('modules.default.openapi is not configured. Replace TODO before running sync.');
  });

  it('generates with the default module from config', async () => {
    await writeGenerateFixtures(workspace, 'https://openapi-fallback.test.local');
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await writeFile(
      path.join(workspace, 'load-tests/openapi/app.openapi.yaml'),
      [
        'openapi: 3.0.3',
        'info:',
        '  title: App API',
        '  version: 1.0.0',
        'servers:',
        '  - url: https://openapi-fallback.test.local',
        'paths:',
        '  /app-health:',
        '    get:',
        '      operationId: getHealth',
        '      responses:',
        '        "200":',
        '          description: OK',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    await runCli(
      [
        'generate',
        '--config',
        'load-tests/config.yaml',
        '--scenario',
        'scenario.yaml',
        '--write',
        'generated/script.js',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const output = await readFile(path.join(workspace, 'generated/script.js'), 'utf8');

    expect(output).toContain('const BASE_URL = __ENV.BASE_URL || "https://config-base.test.local";');
    expect(output).toContain('const url0 = joinUrl(BASE_URL, `/app-health`);');
  });

  it('generates by scenario name using default config and output paths', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: getHealth',
        '    condition: status == 200',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    await runCli(
      ['generate', '-s', 'smoke'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const output = await readFile(path.join(workspace, 'load-tests/generated/smoke.k6.js'), 'utf8');

    expect(output).toContain('const BASE_URL = __ENV.BASE_URL || "https://config-base.test.local";');
    expect(output).toContain('const url0 = joinUrl(BASE_URL, `/app-health`);');
  });

  it('tests a scenario by name using default config and output paths', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: getHealth',
        '    condition: status == 200',
        '    extract:',
        '      ok:',
        '        from: $.ok',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    const stdout = createCapture();
    await runCli(
      ['test', '-s', 'smoke'],
      {
        cwd: workspace,
        stdout: stdout.stream,
        stderr: createSink(),
        env: {},
        fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK' }),
      },
    );

    expect(stdout.output()).toContain('scenario: smoke');
    expect(stdout.output()).toContain('base url: https://config-base.test.local');
    expect(stdout.output()).toContain('steps: 1');
    expect(stdout.output()).toContain('[1/1] health');
    expect(stdout.output()).toContain('request: GET /app-health');
    expect(stdout.output()).toContain('url: https://config-base.test.local/app-health');
    expect(stdout.output()).toContain('state: → running');
    expect(stdout.output()).toContain('status: ✓ 200 OK');
    expect(stdout.output()).toContain('result: ✓ PASS');
    expect(stdout.output()).toContain('checks: ✓ status == 200');
    expect(stdout.output()).toContain('extract: ✓ ok');
    expect(stdout.output()).toContain('summary: ✓ PASS');
  });

  it('streams scenario test output before the request finishes', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: getHealth',
        '    condition: status == 200',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    let resolveResponse: (response: Response) => void = () => {};
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const stdout = createCapture();
    const runPromise = runCli(
      ['test', '-s', 'smoke'],
      {
        cwd: workspace,
        stdout: stdout.stream,
        stderr: createSink(),
        env: {},
        fetch: async () => responsePromise,
      },
    );

    await waitForOutput(stdout.output, 'state: → running');

    expect(stdout.output()).toContain('scenario: smoke');
    expect(stdout.output()).toContain('[1/1] health');
    expect(stdout.output()).toContain('url: https://config-base.test.local/app-health');
    expect(stdout.output()).not.toContain('summary:');

    resolveResponse(new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK' }));
    await runPromise;

    expect(stdout.output()).toContain('status: ✓ 200 OK');
    expect(stdout.output()).toContain('result: ✓ PASS');
    expect(stdout.output()).toContain('summary: ✓ PASS');
  });

  it('fails an HTTP error response without explicit assertions', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: getHealth',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    const stdout = createCapture();
    await expect(
      runCli(
        ['test', '-s', 'smoke'],
        {
          cwd: workspace,
          stdout: stdout.stream,
          stderr: createSink(),
          env: {},
          fetch: async () => new Response(JSON.stringify({ message: 'boom' }), {
            status: 500,
            statusText: 'Internal Server Error',
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'openapi-k6.test.failed',
    });

    expect(stdout.output()).toContain('status: ✗ 500 Internal Server Error');
    expect(stdout.output()).toContain('result: ✗ FAIL');
    expect(stdout.output()).toContain('summary: ✗ FAIL');
    expect(stdout.output()).toContain('body:');
    expect(stdout.output()).not.toContain('result: ✓ PASS');
  });

  it('colors an explicitly expected HTTP error status as passing', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: getHealth',
        '    condition: status == 404',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    const stdout = createCapture({ isTTY: true });
    await runCli(
      ['test', '-s', 'smoke'],
      {
        cwd: workspace,
        stdout: stdout.stream,
        stderr: createSink(),
        env: {},
        fetch: async () => new Response(JSON.stringify({ message: 'not found' }), {
          status: 404,
          statusText: 'Not Found',
        }),
      },
    );

    expect(stdout.output()).toContain('\u001b[32m404 Not Found\u001b[0m');
    expect(stdout.output()).not.toContain('\u001b[31m404 Not Found');
    expect(stdout.output()).toContain('\u001b[32m✓ PASS\u001b[0m');
  });

  it('does not print ANSI color codes to captured streams', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: getHealth',
        '    condition: status == 200',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    const stdout = createCapture();
    await runCli(
      ['test', '-s', 'smoke'],
      {
        cwd: workspace,
        stdout: stdout.stream,
        stderr: createSink(),
        env: {},
        fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK' }),
      },
    );

    expect(stdout.output()).not.toMatch(/\u001b\[/);
  });

  it('disables ANSI colors with --no-color and NO_COLOR', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: getHealth',
        '    condition: status == 200',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    const colorOutput = createCapture({ isTTY: true });
    await runCli(
      ['test', '-s', 'smoke'],
      {
        cwd: workspace,
        stdout: colorOutput.stream,
        stderr: createSink(),
        env: {},
        fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK' }),
      },
    );

    const noColorOutput = createCapture({ isTTY: true });
    await runCli(
      ['test', '-s', 'smoke', '--no-color'],
      {
        cwd: workspace,
        stdout: noColorOutput.stream,
        stderr: createSink(),
        env: {},
        fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK' }),
      },
    );

    const noColorEnvOutput = createCapture({ isTTY: true });
    await runCli(
      ['test', '-s', 'smoke'],
      {
        cwd: workspace,
        stdout: noColorEnvOutput.stream,
        stderr: createSink(),
        env: { NO_COLOR: '1' },
        fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK' }),
      },
    );

    expect(colorOutput.output()).toMatch(/\u001b\[/);
    expect(noColorOutput.output()).not.toMatch(/\u001b\[/);
    expect(noColorEnvOutput.output()).not.toMatch(/\u001b\[/);
  });

  it('fails clearly when test sees TODO config values', async () => {
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: getHealth',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: TODO',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: TODO',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['test', '-s', 'smoke'],
        { cwd: workspace, stdout: createSink(), stderr: createSink(), env: {} },
      ),
    ).rejects.toThrow('modules.app.snapshot is not configured. Replace TODO before running test.');
  });

  it('returns a failing command when scenario test conditions fail', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: getHealth',
        '    condition: status == 200',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    const stdout = createCapture();
    await expect(
      runCli(
        ['test', '-s', 'smoke'],
        {
          cwd: workspace,
          stdout: stdout.stream,
          stderr: createSink(),
          env: {},
          fetch: async () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'openapi-k6.test.failed',
    });

    expect(stdout.output()).toContain('result: ✗ FAIL');
    expect(stdout.output()).toContain('checks: ✗ status == 200');
    expect(stdout.output()).toContain('body:');
    expect(stdout.output()).toContain('"message":"boom"');
    expect(stdout.output()).toContain('summary: ✗ FAIL');
  });

  it('masks env secrets in CLI reporter URLs, errors, and truncated response bodies', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: condition-failure',
        '    api:',
        '      operationId: getHealth',
        '    request:',
        '      query:',
        '        token: "{{env.API_TOKEN}}"',
        '    condition: status == 200',
        '  - id: network-failure',
        '    api:',
        '      operationId: getHealth',
        '    request:',
        '      query:',
        '        token: "{{env.API_TOKEN}}"',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    const secret = 'SENSITIVE_BOUNDARY_TOKEN';
    let requestCount = 0;
    const stdout = createCapture();

    await expect(
      runCli(
        ['test', '-s', 'smoke'],
        {
          cwd: workspace,
          stdout: stdout.stream,
          stderr: createSink(),
          env: { API_TOKEN: secret },
          fetch: async (input) => {
            requestCount += 1;

            if (requestCount === 1) {
              return new Response(`${'x'.repeat(1995)}${secret} response tail`, {
                status: 500,
                statusText: 'Internal Server Error',
              });
            }

            throw new Error(`network failed for ${String(input)}`);
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'openapi-k6.test.failed',
    });

    const output = stdout.output();

    expect(output).toContain('url: https://config-base.test.local/app-health?token=***');
    expect(output).toContain('body:');
    expect(output).toContain('error: ✗ network failed for https://config-base.test.local/app-health?token=***');
    expect(output).toContain('***');
    expect(output).not.toContain(secret);
    expect(output).not.toContain(secret.slice(0, 8));
  });

  it('selects an isolated module registry with --module', async () => {
    await writeGenerateFixtures(workspace);
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await writeModuleOpenApi('bos.openapi.yaml', '/bos-health', 'https://bos-openapi.test.local');
    await writeModuleOpenApi('vendor.openapi.yaml', '/vendor-health', 'https://vendor-openapi.test.local');
    await writeConfig([
      'defaultModule: bos',
      'modules:',
      '  bos:',
      '    baseUrl: https://bos-api.test.local',
      '    snapshot: openapi/bos.openapi.yaml',
      '    catalog: openapi/bos.catalog.json',
      '  vendor:',
      '    baseUrl: https://vendor-api.test.local',
      '    snapshot: openapi/vendor.openapi.yaml',
      '    catalog: openapi/vendor.catalog.json',
      '',
    ]);

    await runCli(
      [
        'generate',
        '--config',
        'load-tests/config.yaml',
        '--module',
        'vendor',
        '--scenario',
        'scenario.yaml',
        '--write',
        'generated/vendor-script.js',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const output = await readFile(path.join(workspace, 'generated/vendor-script.js'), 'utf8');

    expect(output).toContain('const BASE_URL = __ENV.BASE_URL || "https://vendor-api.test.local";');
    expect(output).toContain('const url0 = joinUrl(BASE_URL, `/vendor-health`);');
    expect(output).not.toContain('/bos-health');
  });

  it('fails clearly when config module is unknown', async () => {
    await writeGenerateFixtures(workspace);
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await writeModuleOpenApi('bos.openapi.yaml', '/bos-health', 'https://bos-openapi.test.local');
    await writeConfig([
      'defaultModule: bos',
      'modules:',
      '  bos:',
      '    snapshot: openapi/bos.openapi.yaml',
      '    catalog: openapi/bos.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        [
          'generate',
          '--config',
          'load-tests/config.yaml',
          '--module',
          'unknown',
          '--scenario',
          'scenario.yaml',
          '--write',
          'generated/script.js',
        ],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('module "unknown" was not found. Available modules: bos');
  });

  it('fails clearly when --module is used without --config', async () => {
    await expect(
      runCli(
        [
          'generate',
          '--module',
          'bos',
          '--scenario',
          'scenario.yaml',
          '--openapi',
          'openapi.yaml',
          '--write',
          'generated/script.js',
        ],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('--module requires --config');
  });

  async function writeConfig(lines: string[]): Promise<void> {
    await mkdir(path.join(workspace, 'load-tests'), { recursive: true });
    await writeFile(path.join(workspace, 'load-tests/config.yaml'), lines.join('\n'), 'utf8');
  }

  async function writeModuleOpenApi(
    fileName: string,
    endpointPath: string,
    serverUrl: string,
  ): Promise<void> {
    await writeFile(
      path.join(workspace, 'load-tests/openapi', fileName),
      [
        'openapi: 3.0.3',
        'info:',
        `  title: ${fileName}`,
        '  version: 1.0.0',
        'servers:',
        `  - url: ${serverUrl}`,
        'paths:',
        `  ${endpointPath}:`,
        '    get:',
        '      operationId: getHealth',
        '      responses:',
        '        "200":',
        '          description: OK',
        '',
      ].join('\n'),
      'utf8',
    );
  }
});
