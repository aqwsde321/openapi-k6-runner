import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
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

function createInput(): PassThrough & { isTTY?: boolean } {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
  stream.isTTY = true;
  return stream;
}

function createOpenApiResponse(): Response {
  return new Response(
    JSON.stringify({
      openapi: '3.0.3',
      info: {
        title: 'Fixture API',
        version: '1.0.0',
      },
      paths: {
        '/health': {
          get: {
            responses: {
              '200': {
                description: 'OK',
              },
            },
          },
        },
      },
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    },
  );
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

async function writeValidationOpenApi(workspace: string): Promise<void> {
  await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
  await writeFile(
    path.join(workspace, 'load-tests/openapi/app.openapi.yaml'),
    [
      'openapi: 3.0.3',
      'info:',
      '  title: App API',
      '  version: 1.0.0',
      'paths:',
      '  /orders/{orderId}:',
      '    get:',
      '      operationId: getOrder',
      '      parameters:',
      '        - name: orderId',
      '          in: path',
      '          required: true',
      '          schema:',
      '            type: string',
      '        - name: includeItems',
      '          in: query',
      '          required: true',
      '          schema:',
      '            type: boolean',
      '        - name: X-Tenant',
      '          in: header',
      '          required: true',
      '          schema:',
      '            type: string',
      '      responses:',
      '        "200":',
      '          description: OK',
      '    delete:',
      '      operationId: deleteOrder',
      '      parameters:',
      '        - name: orderId',
      '          in: path',
      '          required: true',
      '          schema:',
      '            type: string',
      '      requestBody:',
      '        required: true',
      '        content:',
      '          application/json:',
      '            schema:',
      '              type: object',
      '      responses:',
      '        "204":',
      '          description: Deleted',
      '  /orders:',
      '    post:',
      '      operationId: createOrder',
      '      requestBody:',
      '        required: true',
      '        content:',
      '          application/json:',
      '            schema:',
      '              type: object',
      '      responses:',
      '        "201":',
      '          description: Created',
      '  /uploads:',
      '    post:',
      '      operationId: uploadFile',
      '      requestBody:',
      '        required: true',
      '        content:',
      '          multipart/form-data:',
      '            schema:',
      '              type: object',
      '      responses:',
      '        "201":',
      '          description: Created',
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

  it('runs the CLI when invoked through a symlinked npm bin entrypoint', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string };
    const binPath = path.join(workspace, 'openapi-k6');

    await symlink(path.join(process.cwd(), 'src/cli/index.ts'), binPath);

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', binPath, '--version'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(packageJson.version);
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
      '# module을 여러 개 두면 npx --yes openapi-k6 sync/generate에서 --module <name>으로 선택할 수 있습니다.',
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
    expect(gitignore).toBe('*\n!.gitignore\n!scenarios/\n!scenarios/**\n');
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
    expect(readme).toContain('npx --yes openapi-k6 sync');
    expect(readme).toContain('npx --yes openapi-k6 run -s smoke --log');
    expect(readme).toContain('npx --yes openapi-k6 generate \\');
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
    expect(readme).toContain('## 0. openapi-k6 실행 방식');
    expect(readme).toContain('사람은 빠른 시작을 먼저 보면 됩니다. AI coding agent는 아래 프롬프트와 접힌 상세 지침까지 읽고 작업합니다.');
    expect(readme).toContain('## 사람이 직접 실행할 때');
    expect(readme).toContain('### 꼭 알아야 하는 것');
    expect(readme).toContain('### 빠른 시작');
    expect(readme).toContain('처음에는 아래 순서만 따라가면 됩니다. 모든 명령은 백엔드 프로젝트 루트에서 실행합니다.');
    expect(readme).toContain('1. `load-tests/config.yaml`에 TODO가 남아 있으면 먼저 채웁니다.');
    expect(readme).toContain('2. OpenAPI snapshot/catalog를 만듭니다.');
    expect(readme).toContain('3. scenario에 쓸 endpoint 후보를 검색합니다.');
    expect(readme).toContain('4. `load-tests/scenarios/smoke.yaml`를 수정한 뒤 YAML/OpenAPI 정합성을 확인합니다.');
    expect(readme).toContain('5. 실제 API 흐름을 검증합니다.');
    expect(readme).toContain('6. 검증을 통과한 scenario만 k6로 생성하고 실행합니다.');
    expect(readme).toContain('AI에게 맡기는 경우에는 위 프롬프트를 사용하세요.');
    expect(readme).toContain('직접 수정하는 파일은 `config.yaml`, `.env`, `scenarios/*.yaml`입니다.');
    expect(readme).toContain('명령은 백엔드 프로젝트 루트에서 실행합니다.');
    expect(readme).toContain('기본 `.gitignore`는 `scenarios/**`만 git 추적 대상에 남기고 scaffold/config/생성물은 제외합니다.');
    expect(readme).toContain('생성물은 직접 고치지 않습니다. OpenAPI snapshot은 `sync`, `generated/*.k6.js`는 `generate`로 다시 만듭니다.');
    expect(readme).toContain('이 README는 `npx --yes openapi-k6 init`으로 생성되었습니다.');
    expect(readme).toContain('npm 배포 버전은 설치 없이 `npx`로 실행하는 것을 기본으로 합니다.');
    expect(readme).toContain('npx --yes openapi-k6 --help');
    expect(readme).toContain('npm install -D openapi-k6');
    expect(readme).toContain('pnpm exec openapi-k6 ...');
    expect(readme).toContain('이 폴더는 백엔드 프로젝트 안에서 OpenAPI snapshot, scenario YAML, scenario validate/test, 생성된 k6 스크립트를 관리합니다.');
    expect(readme).toContain('핵심 흐름은 OpenAPI catalog에서 API를 고르고, `validate`로 YAML/OpenAPI 정합성을 먼저 확인한 뒤');
    expect(readme).toContain('다음 단계로 넘어가는 기준은 간단합니다. `npx --yes openapi-k6 validate`와 `npx --yes openapi-k6 test`가 통과한 scenario만 generate/run 합니다.');
    expect(readme).toContain('`npx --yes openapi-k6 validate`로 YAML/OpenAPI 정합성을 확인하고, `npx --yes openapi-k6 test`가 통과한 scenario만 `run`하거나 `generate`/`run.sh`로 실행합니다.');
    expect(readme).toContain('## 1. 최소 설정');
    expect(readme).toContain('## 2. OpenAPI -> Scenario Validate -> Scenario Test -> k6 흐름');
    expect(readme).toContain('| 순서 | 사용자가 준비하는 것 | 실행 명령 | 생성/갱신되는 것 |');
    expect(readme).toContain('대화형 `init`은 `baseUrl`만 입력받고 `<baseUrl>/v3/api-docs`를 먼저 확인합니다.');
    expect(readme).toContain('실패하면 `/api-docs`, `/openapi.json`, `/swagger.json`, `/swagger/v1/swagger.json` 같은 흔한 OpenAPI 경로를 자동으로 시도합니다.');
    expect(readme).toContain('자동 탐색이 실패하면 CLI 안내에 따라 직접 URL/파일 경로를 입력하거나 `skip`으로 넘어간 뒤 config를 나중에 수정할 수 있습니다.');
    expect(readme).toContain('`config.yaml`의 `baseUrl`, `modules.pharma.openapi` 확인 또는 TODO 채우기');
    expect(readme).toContain('`load-tests/openapi/pharma.openapi.json`, `load-tests/openapi/pharma.catalog.json`');
    expect(readme).toContain('catalog에서 endpoint 후보 검색 후 scenario 작성/수정');
    expect(readme).toContain('`npx --yes openapi-k6 catalog --query login`');
    expect(readme).toContain('`load-tests/scenarios/<name>.yaml`');
    expect(readme).toContain('`load-tests/generated/<name>.k6.js`');
    expect(readme).toContain('`./load-tests/run.sh <name> --log`');
    expect(readme).toContain('### 2-1. OpenAPI snapshot/catalog 생성');
    expect(readme).toContain('### 2-2. Scenario YAML 작성');
    expect(readme).toContain('### 2-3. Scenario 정적 검증');
    expect(readme).toContain('### 2-4. Scenario 실행 검증');
    expect(readme).toContain('### 2-5. CLI에서 k6 실행');
    expect(readme).toContain('### 2-6. k6 스크립트만 생성');
    expect(readme).toContain('### 2-7. run.sh로 생성된 k6 실행');
    expect(readme).toContain('생성/갱신: `load-tests/openapi/pharma.openapi.json`, `load-tests/openapi/pharma.catalog.json`');
    expect(readme).toContain('`catalog` 명령으로 테스트할 endpoint의 `operationId`, `method`, `path`, `parameters`, `hasRequestBody`, `requestBodyContentTypes`를 확인합니다.');
    expect(readme).toContain('전체 catalog 파일은 `load-tests/openapi/pharma.catalog.json`에 있습니다.');
    expect(readme).toContain('기본 smoke 테스트는 `load-tests/scenarios/smoke.yaml`를 수정합니다.');
    expect(readme).toContain('npx --yes openapi-k6 validate -s smoke');
    expect(readme).toContain('npx --yes openapi-k6 test -s smoke');
    expect(readme).toContain('`npx --yes openapi-k6 validate`는 백엔드에 요청하지 않고 scenario YAML을 OpenAPI snapshot과 대조합니다.');
    expect(readme).toContain('필수 path/query/header/body 누락, `{{token}}` 같은 context template 참조, `condition`, `extract.from` 문법을 확인합니다.');
    expect(readme).toContain('`npx --yes openapi-k6 test`는 scenario YAML을 Node.js에서 1회 실행해 URL, status, condition, extract를 확인합니다.');
    expect(readme).toContain('k6 스크립트 생성 전 gate입니다.');
    expect(readme).toContain('색상은 터미널에서만 켜지며 `--no-color` 옵션이나 `NO_COLOR=1` 환경변수로 끌 수 있습니다.');
    expect(readme).toContain('`condition`은 분기 조건이 아니라 검증식입니다. k6 생성 시 `check`로 들어가며 다음 step 실행을 막는 용도로 쓰지 않습니다.');
    expect(readme).toContain('생성/갱신: `load-tests/generated/smoke.k6.js`');
    expect(readme).toContain('## 3. 비밀 값 사용');
    expect(readme).toContain('## 4. 자주 하는 수정');
    expect(readme).toContain('## 5. 제거 방법');
    expect(readme).toContain('Authorization: "Bearer {{token}}"');
    expect(readme).toContain('password: "{{env.LOGIN_PASSWORD}}"');
    expect(readme).toContain('여러 API를 이어야 할 때는 이전 step의 `extract`로 응답 값을 저장하고');
    expect(readme).toContain('다음 step의 `request.headers`, `request.query`, `request.pathParams`, `request.body`에서 `{{token}}`처럼 참조합니다.');
    expect(readme).toContain('응답 값을 다음 API에 연결하는 예시:');
    expect(readme).toContain('npx --yes openapi-k6 generate -s login-flow');
    expect(readme).toContain('`openapi`: `sync`가 읽을 OpenAPI URL 또는 파일 경로. 상대 경로는 `config.yaml` 위치 기준입니다.');
    expect(readme).toContain('`body`와 `multipart`는 같은 step에서 함께 쓰지 않습니다.');
    expect(readme).toContain('API base URL은 `npx --yes openapi-k6 generate` 실행 시점의 `config.yaml` `baseUrl` 값이 생성된 k6 스크립트에 기본값으로 들어갑니다.');
    expect(readme).toContain('`config.yaml`을 수정한 뒤에는 스크립트를 다시 생성해야 반영됩니다.');
    expect(readme).toContain('실행 시점에 `BASE_URL` 환경 변수를 넘기면 스크립트에 들어간 기본값보다 우선합니다.');
    expect(readme).toContain('시나리오에서 `{{env.NAME}}`을 사용한다면 `load-tests/.env.example`을 `load-tests/.env`로 복사한 뒤 비밀 값을 채웁니다.');
    expect(readme).toContain('cp load-tests/.env.example load-tests/.env');
    expect(readme).toContain('`npx --yes openapi-k6 test`, `npx --yes openapi-k6 run`, `run.sh`가 `load-tests/.env`를 읽습니다.');
    expect(readme).toContain('`load-tests/.gitignore`는 기본적으로 `scenarios/**`만 git 추적 대상에 남기고 scaffold/config/생성물은 제외합니다.');
    expect(readme).toContain('이미 git에 올라간 `load-tests/` 파일은 ignore 규칙만으로 빠지지 않으므로 필요하면 `git rm -r --cached load-tests`로 추적에서만 제거합니다.');
    expect(readme).toContain('rm -rf load-tests');
    expect(readme).toContain('필요한 scenario, snapshot, catalog가 있으면 먼저 백업합니다.');
    expect(readme).toContain('## AI Work Guide');
    expect(readme).toContain('This section is for AI agents. Use it as a compact checklist after reading the Korean quick start.');
    expect(readme).toContain('### Guardrails');
    expect(readme).toContain('Run commands from the backend project root and follow the quick start order above.');
    expect(readme).toContain('During ordinary backend test work, edit only `config.yaml`, `.env`, and `scenarios/*.yaml`.');
    expect(readme).toContain('If scaffold docs or helper scripts must change, update the generator template in openapi-k6-runner and rerun `npx --yes openapi-k6 update` intentionally.');
    expect(readme).toContain('Regenerate `load-tests/openapi/pharma.openapi.json` and `generated/*.k6.js` with `sync`/`generate`; do not edit them directly.');
    expect(readme).toContain('Keep human-facing documentation in Korean.');
    expect(readme).toContain('Do not write secrets in YAML. Use `{{env.NAME}}` and store real values only in `load-tests/.env`.');
    expect(readme).toContain('### Scenario Notes');
    expect(readme).toContain('Use `npx --yes openapi-k6 catalog --query login` or read `load-tests/openapi/pharma.catalog.json` to pick endpoints; `validate`, `test`, and `generate` read the OpenAPI snapshot, not the catalog.');
    expect(readme).toContain('Do not use `request.body` and `request.multipart` in the same step.');
    expect(readme).toContain('Config-relative paths resolve from the directory containing `config.yaml`.');
    expect(readme).toContain('`load-tests/run.sh`: k6 runner that auto-loads `load-tests/.env` values');
    expect(readme).toContain('### Files to inspect');
    expect(readme).toContain('## AI에게 작업 맡기기');
    expect(readme).toContain('이 백엔드 프로젝트에 openapi-k6 시나리오 테스트와 k6 부하 테스트 준비를 적용해줘.');
    expect(readme).toContain('먼저 load-tests/README.md를 읽어.');
    expect(readme).toContain('아래 명령은 백엔드 프로젝트 루트에서 실행해.');
    expect(readme).toContain('load-tests/config.yaml에 TODO가 남아 있으면 이 백엔드 프로젝트에 맞게 채워.');
    expect(readme).toContain('npx --yes openapi-k6 sync를 실행해서 OpenAPI snapshot과 catalog를 만들어.');
    expect(readme).toContain('npx --yes openapi-k6 catalog --query login 명령으로 테스트할 endpoint 후보를 확인해.');
    expect(readme).toContain('`login`은 원하는 검색어로 바꿔 실행합니다.');
    expect(readme).toContain('npx --yes openapi-k6 validate -s <name> 형식으로 YAML/OpenAPI 정합성을 먼저 확인해.');
    expect(readme).toContain('npx --yes openapi-k6 test -s <name> 형식으로 실제 API 흐름을 검증해.');
    expect(readme).toContain('scenario test가 통과하기 전에는 k6 script를 생성하거나 실행하지 마.');
    expect(readme).toContain('통과한 scenario만 npx --yes openapi-k6 run -s <name> --log 형식으로 짧게 실행해.');
    expect(readme).toContain('스크립트만 필요하면 npx --yes openapi-k6 generate -s <name> 형식으로 k6 script를 생성해.');
    expect(readme).toContain('장시간 부하 테스트는 내가 요청하기 전에는 실행하지 말고');
    expect(readme).not.toContain('### Prompt Examples');
    expect(readme).toContain('load-tests/README.md, load-tests/run.sh, load-tests/.env.example, load-tests/.gitignore는 scaffold 파일이므로 명시 요청이 없으면 수정하지 마.');
    expect(readme).not.toContain('### Scenario DSL Reference');
    expect(readme).not.toContain('Follow this order: fill remaining TODO values');
    expect(readme).not.toContain('사람이 직접 볼 핵심은 여기까지입니다.');
    expect(readme).toContain('파일 업로드 예시:');
    expect(readme).toContain('path: fixtures/product.png');
    expect(readme).toContain('Multipart file paths are relative to `load-tests/`.');
    expect(readme).toContain('Spring endpoints such as `@PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)` should be modeled with `request.multipart`.');
    expect(readme.indexOf('## AI에게 작업 맡기기')).toBeLessThan(readme.indexOf('## 사람이 직접 실행할 때'));
    expect(readme.indexOf('## 사람이 직접 실행할 때')).toBeLessThan(readme.indexOf('### 빠른 시작'));
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

  it('runs a scenario by validating, generating, and executing k6 with passthrough args', async () => {
    await writeRunFixtures();
    const binDir = path.join(workspace, 'bin');
    const argLogPath = path.join(workspace, 'k6-args.txt');
    await writeFakeK6(binDir, [
      'printf "%s\\n" "$@" > "$K6_ARG_LOG"',
      'echo fake-k6-output',
    ]);

    const stdout = createCapture();
    await runCli(
      ['run', '--scenario', 'smoke', '--', '--vus', '1', '--iterations', '1'],
      {
        cwd: workspace,
        stdout: stdout.stream,
        stderr: createSink(),
        env: {
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          K6_ARG_LOG: argLogPath,
        },
      },
    );

    const generated = await readFile(path.join(workspace, 'load-tests/generated/smoke.k6.js'), 'utf8');
    const args = await readFile(argLogPath, 'utf8');

    expect(stdout.output()).toContain(`Generated ${path.join(workspace, 'load-tests/generated/smoke.k6.js')}`);
    expect(stdout.output()).toContain('fake-k6-output');
    expect(generated).toContain('const BASE_URL = __ENV.BASE_URL || "https://app-api.test.local";');
    expect(generated).toContain('const url0 = joinUrl(BASE_URL, `/app-health`);');
    expect(args).toBe([
      'run',
      '--vus',
      '1',
      '--iterations',
      '1',
      path.join(workspace, 'load-tests/generated/smoke.k6.js'),
      '',
    ].join('\n'));
  });

  it('runs k6 with CLI log, trace, report, and dashboard flags', async () => {
    await writeRunFixtures();
    const binDir = path.join(workspace, 'bin');
    const envLogPath = path.join(workspace, 'k6-env.txt');
    await writeFakeK6(binDir, [
      '{',
      '  printf "OPENAPI_K6_TRACE=%s\\n" "${OPENAPI_K6_TRACE-}"',
      '  printf "K6_WEB_DASHBOARD=%s\\n" "${K6_WEB_DASHBOARD-}"',
      '  printf "K6_WEB_DASHBOARD_PERIOD=%s\\n" "${K6_WEB_DASHBOARD_PERIOD-}"',
      '  printf "K6_WEB_DASHBOARD_EXPORT=%s\\n" "${K6_WEB_DASHBOARD_EXPORT-}"',
      '  printf "K6_WEB_DASHBOARD_OPEN=%s\\n" "${K6_WEB_DASHBOARD_OPEN-}"',
      '} > "$K6_ENV_LOG"',
      'echo fake-k6-output',
    ]);

    const stdout = createCapture();
    await runCli(
      ['run', '-s', 'smoke', '--log', '--trace', '--report', '--open-dashboard'],
      {
        cwd: workspace,
        stdout: stdout.stream,
        stderr: createSink(),
        env: {
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          K6_ENV_LOG: envLogPath,
        },
      },
    );

    const log = await readFile(path.join(workspace, 'load-tests/logs/smoke.log'), 'utf8');
    const envLog = await readFile(envLogPath, 'utf8');

    expect(stdout.output()).toContain('Writing k6 HTML report to');
    expect(stdout.output()).toContain('Writing k6 output to');
    expect(log).toContain('fake-k6-output');
    expect(envLog).toContain('OPENAPI_K6_TRACE=1');
    expect(envLog).toContain('K6_WEB_DASHBOARD=true');
    expect(envLog).toContain('K6_WEB_DASHBOARD_PERIOD=1s');
    expect(envLog).toContain(`K6_WEB_DASHBOARD_EXPORT=${path.join(workspace, 'load-tests/logs/smoke-report.html')}`);
    expect(envLog).toContain('K6_WEB_DASHBOARD_OPEN=true');
  });

  it('does not execute k6 when run validation fails', async () => {
    await writeRunFixtures();
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: missingOperation',
        '',
      ].join('\n'),
      'utf8',
    );
    const binDir = path.join(workspace, 'bin');
    const argLogPath = path.join(workspace, 'k6-args.txt');
    await writeFakeK6(binDir, [
      'printf "%s\\n" "$@" > "$K6_ARG_LOG"',
    ]);

    await expect(
      runCli(
        ['run', '-s', 'smoke'],
        {
          cwd: workspace,
          stdout: createSink(),
          stderr: createSink(),
          env: {
            PATH: `${binDir}:${process.env.PATH ?? ''}`,
            K6_ARG_LOG: argLogPath,
          },
        },
      ),
    ).rejects.toThrow('Scenario validation failed:');

    await expect(readFile(argLogPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails clearly when CLI run cannot find k6', async () => {
    await writeRunFixtures();
    const binDir = path.join(workspace, 'empty-bin');
    await mkdir(binDir, { recursive: true });

    await expect(
      runCli(
        ['run', '-s', 'smoke'],
        {
          cwd: workspace,
          stdout: createSink(),
          stderr: createSink(),
          env: { PATH: binDir },
        },
      ),
    ).rejects.toThrow('k6 executable was not found. Install k6 and make sure it is available on PATH.');
  });

  it('returns a failed command result when k6 exits non-zero', async () => {
    await writeRunFixtures();
    const binDir = path.join(workspace, 'bin');
    await writeFakeK6(binDir, [
      'echo k6 failed >&2',
      'exit 7',
    ]);

    await expect(
      runCli(
        ['run', '-s', 'smoke'],
        {
          cwd: workspace,
          stdout: createSink(),
          stderr: createSink(),
          env: { PATH: `${binDir}:${process.env.PATH ?? ''}` },
        },
      ),
    ).rejects.toMatchObject({
      code: 'openapi-k6.k6.failed',
      exitCode: 7,
    });
  });

  it('runs with the selected config module', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('bos.openapi.yaml', '/bos-health', 'https://bos-openapi.test.local');
    await writeModuleOpenApi('vendor.openapi.yaml', '/vendor-health', 'https://vendor-openapi.test.local');
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
    const binDir = path.join(workspace, 'bin');
    await writeFakeK6(binDir, ['true']);

    await runCli(
      ['run', '--module', 'vendor', '--scenario', 'smoke', '--write', 'generated/vendor-script.js'],
      {
        cwd: workspace,
        stdout: createSink(),
        stderr: createSink(),
        env: { PATH: `${binDir}:${process.env.PATH ?? ''}` },
      },
    );

    const output = await readFile(path.join(workspace, 'generated/vendor-script.js'), 'utf8');

    expect(output).toContain('const BASE_URL = __ENV.BASE_URL || "https://vendor-api.test.local";');
    expect(output).toContain('const url0 = joinUrl(BASE_URL, `/vendor-health`);');
    expect(output).not.toContain('/bos-health');
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
      '# module을 여러 개 두면 npx --yes openapi-k6 sync/generate에서 --module <name>으로 선택할 수 있습니다.',
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

  it('prompts for the base URL and checks the default OpenAPI URL in interactive terminals', async () => {
    const input = createInput();
    const output = createCapture();
    const fetchCalls: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      fetchCalls.push(String(input));
      return createOpenApiResponse();
    };

    const run = runCli(
      ['init'],
      {
        cwd: workspace,
        stdin: input,
        stdout: output.stream,
        stderr: createSink(),
        interactive: true,
        fetch: fetchMock,
      },
    );

    await waitForOutput(output.output, 'API base URL [http://localhost:8080]:');
    input.write('\n');
    await run;
    input.end();

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(fetchCalls).toEqual(['http://localhost:8080/v3/api-docs']);
    expect(config).toContain('baseUrl: http://localhost:8080');
    expect(config).toContain('    openapi: http://localhost:8080/v3/api-docs');
    expect(output.output()).toContain('API base URL [http://localhost:8080]:');
    expect(output.output()).not.toContain('OpenAPI spec URL/file path');
    expect(output.output()).toContain('✓ http://localhost:8080/v3/api-docs  OpenAPI 3.0.3');
    expect(output.output()).toContain('✓ Created load-tests');
    expect(output.output()).toContain('Next');
    expect(output.output()).toContain('npx --yes openapi-k6 sync');
    expect(output.output()).toContain('./load-tests/run.sh smoke --log');
  });

  it('discovers a common OpenAPI path from the entered base URL', async () => {
    const input = createInput();
    const output = createCapture();
    const fetchCalls: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === 'http://localhost:8080/api-docs') {
        return createOpenApiResponse();
      }

      return new Response('not found', {
        status: 404,
        headers: {
          'content-type': 'text/plain',
        },
      });
    };

    const run = runCli(
      ['init'],
      {
        cwd: workspace,
        stdin: input,
        stdout: output.stream,
        stderr: createSink(),
        interactive: true,
        fetch: fetchMock,
      },
    );

    await waitForOutput(output.output, 'API base URL [http://localhost:8080]:');
    input.write('http://localhost:8080\n');
    await run;
    input.end();

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(fetchCalls).toContain('http://localhost:8080/v3/api-docs');
    expect(fetchCalls).toContain('http://localhost:8080/api-docs');
    expect(config).toContain('baseUrl: http://localhost:8080');
    expect(config).toContain('    openapi: http://localhost:8080/api-docs');
    expect(output.output()).toContain('✗ http://localhost:8080/v3/api-docs  HTTP 404');
    expect(output.output()).toContain('✓ http://localhost:8080/api-docs  OpenAPI 3.0.3');
    expect(output.output()).not.toContain('OpenAPI spec URL/file path');
  });

  it('asks for an explicit OpenAPI URL only when automatic discovery fails', async () => {
    const input = createInput();
    const output = createCapture();
    const fetchCalls: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url === 'http://localhost:8081/custom-openapi.json') {
        return createOpenApiResponse();
      }

      return new Response('not found', {
        status: 404,
        headers: {
          'content-type': 'text/plain',
        },
      });
    };

    const run = runCli(
      ['init'],
      {
        cwd: workspace,
        stdin: input,
        stdout: output.stream,
        stderr: createSink(),
        interactive: true,
        fetch: fetchMock,
      },
    );

    await waitForOutput(output.output, 'API base URL [http://localhost:8080]:');
    input.write('http://localhost:8081\n');
    await waitForOutput(output.output, 'OpenAPI spec URL/file path or "skip" [http://localhost:8081/v3/api-docs]:');
    input.write('http://localhost:8081/custom-openapi.json\n');
    await run;
    input.end();

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(fetchCalls).toContain('http://localhost:8081/v3/api-docs');
    expect(fetchCalls).toContain('http://localhost:8081/custom-openapi.json');
    expect(config).toContain('baseUrl: http://localhost:8081');
    expect(config).toContain('    openapi: http://localhost:8081/custom-openapi.json');
    expect(output.output()).toContain('! OpenAPI auto-discovery failed.');
  });

  it('lets interactive init skip the OpenAPI check after automatic discovery fails', async () => {
    const input = createInput();
    const output = createCapture();
    const fetchMock: typeof fetch = async () => new Response('not found', {
      status: 404,
      headers: {
        'content-type': 'text/plain',
      },
    });

    const run = runCli(
      ['init'],
      {
        cwd: workspace,
        stdin: input,
        stdout: output.stream,
        stderr: createSink(),
        interactive: true,
        fetch: fetchMock,
      },
    );

    await waitForOutput(output.output, 'API base URL [http://localhost:8080]:');
    input.write('http://localhost:8081\n');
    await waitForOutput(output.output, 'OpenAPI spec URL/file path or "skip" [http://localhost:8081/v3/api-docs]:');
    input.write('skip\n');
    await run;
    input.end();

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(config).toContain('baseUrl: http://localhost:8081');
    expect(config).toContain('    openapi: http://localhost:8081/v3/api-docs');
    expect(output.output()).toContain('Saved http://localhost:8081/v3/api-docs without checking.');
  });

  it('keeps non-interactive init behavior when --no-input is used', async () => {
    const output = createCapture();

    await runCli(
      ['init', '--no-input'],
      {
        cwd: workspace,
        stdout: output.stream,
        stderr: createSink(),
        interactive: true,
      },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(config).toContain('baseUrl: TODO');
    expect(config).toContain('    openapi: TODO');
    expect(output.output()).not.toContain('API base URL');
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
    expect(readme).toContain('npx --yes openapi-k6 sync --config perf-tests/config.yaml --module pharma');
    expect(readme).toContain('npx --yes openapi-k6 update --config perf-tests/config.yaml --module pharma');
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

    await writeFile(path.join(workspace, 'perf-tests/README.md'), 'stale readme\n', 'utf8');
    await runCli(
      ['update', '--config', 'perf-tests/config.yaml', '--module', 'pharma'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const updatedReadme = await readFile(path.join(workspace, 'perf-tests/README.md'), 'utf8');

    expect(updatedReadme).toContain('npx --yes openapi-k6 update --config perf-tests/config.yaml --module pharma');
    expect(updatedReadme).toContain('npx --yes openapi-k6 sync --config perf-tests/config.yaml --module pharma');
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

    expect(readme).toContain("npx --yes openapi-k6 sync --config 'perf tests/config.yaml' --module pharma");
    expect(readme).toContain("npx --yes openapi-k6 update --config 'perf tests/config.yaml' --module pharma");
    expect(readme).toContain("--config 'perf tests/config.yaml'");
    expect(readme).toContain("--scenario 'perf tests/scenarios/smoke.yaml'");
    expect(readme).toContain("--write 'perf tests/generated/smoke.k6.js'");
    expect(readme).toContain("'./perf tests/run.sh' smoke");
    expect(readme).toContain("'./perf tests/run.sh' smoke --log");
    expect(readme).toContain("cp 'perf tests/.env.example' 'perf tests/.env'");

    await writeFile(path.join(workspace, 'perf tests/README.md'), 'stale readme\n', 'utf8');
    await runCli(
      ['update', '--config', 'perf tests/config.yaml', '--module', 'pharma'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const updatedReadme = await readFile(path.join(workspace, 'perf tests/README.md'), 'utf8');

    expect(updatedReadme).toContain("npx --yes openapi-k6 update --config 'perf tests/config.yaml' --module pharma");
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
    ).rejects.toThrow([
      'already exists.',
      '',
      'Use this for existing workspaces:',
      '  npx --yes openapi-k6 update',
      '',
      'Use init --force only when intentionally resetting scaffold files.',
    ].join('\n'));

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
    expect(readme).toContain('`update`는 `config.yaml`, `.env`, `scenarios/`, snapshot/catalog 파일, `generated/`, `logs/`를 보존하고 README, runner, `.env.example`, `.gitignore` 같은 scaffold 파일만 최신화합니다.');
    expect(runScript).toContain('exec k6 run ${K6_ARGS[@]+"${K6_ARGS[@]}"} "$SCRIPT_PATH"');
    expect(scenario).toContain('path: /health');
    expect(env).toBe('LOGIN_PASSWORD=local-secret\n');
    expect(customScenario).toBe('name: custom\nsteps: []\n');
    expect(generated).toBe('export default function () {}\n');
    expect(snapshot).toBe('{}\n');
    expect(log).toBe('old log\n');
  });

  it('updates scaffold files without touching config, env, scenarios, or generated artifacts', async () => {
    await runCli(
      [
        'init',
        '--module',
        'pharma',
        '--base-url',
        'https://api.test.local',
        '--openapi',
        'https://api.test.local/v3/api-docs',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );
    await writeFile(path.join(workspace, 'load-tests/config.yaml'), 'baseUrl: https://kept.test.local\nmodules:\n  pharma:\n    openapi: https://kept.test.local/v3/api-docs\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/README.md'), 'stale readme\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/run.sh'), '#!/usr/bin/env bash\necho stale\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/.env.example'), 'OLD=\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/.gitignore'), '.env\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/.env'), 'LOGIN_PASSWORD=local-secret\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/scenarios/smoke.yaml'), 'name: kept\nsteps: []\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/generated/custom.k6.js'), 'export default function () {}\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/openapi/custom.openapi.json'), '{}\n', 'utf8');
    await mkdir(path.join(workspace, 'load-tests/logs'), { recursive: true });
    await writeFile(path.join(workspace, 'load-tests/logs/smoke.log'), 'old log\n', 'utf8');
    const output = createCapture();

    await runCli(
      ['update'],
      { cwd: workspace, stdout: output.stream, stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');
    const readme = await readFile(path.join(workspace, 'load-tests/README.md'), 'utf8');
    const runScript = await readFile(path.join(workspace, 'load-tests/run.sh'), 'utf8');
    const envExample = await readFile(path.join(workspace, 'load-tests/.env.example'), 'utf8');
    const gitignore = await readFile(path.join(workspace, 'load-tests/.gitignore'), 'utf8');
    const env = await readFile(path.join(workspace, 'load-tests/.env'), 'utf8');
    const scenario = await readFile(path.join(workspace, 'load-tests/scenarios/smoke.yaml'), 'utf8');
    const generated = await readFile(path.join(workspace, 'load-tests/generated/custom.k6.js'), 'utf8');
    const snapshot = await readFile(path.join(workspace, 'load-tests/openapi/custom.openapi.json'), 'utf8');
    const log = await readFile(path.join(workspace, 'load-tests/logs/smoke.log'), 'utf8');

    expect(output.output()).toContain('Updated load-tests scaffold metadata in load-tests');
    expect(output.output()).toContain('kept config  load-tests/config.yaml');
    expect(output.output()).toContain('kept scenarios, snapshots, generated scripts, logs, and .env unchanged');
    expect(config).toBe('baseUrl: https://kept.test.local\nmodules:\n  pharma:\n    openapi: https://kept.test.local/v3/api-docs\n');
    expect(readme).toContain('# load-tests');
    expect(readme).toContain('npx --yes openapi-k6 update');
    expect(runScript).toContain('exec k6 run ${K6_ARGS[@]+"${K6_ARGS[@]}"} "$SCRIPT_PATH"');
    expect(envExample).toContain('LOGIN_PASSWORD=');
    expect(gitignore).toBe('*\n!.gitignore\n!scenarios/\n!scenarios/**\n');
    expect(env).toBe('LOGIN_PASSWORD=local-secret\n');
    expect(scenario).toBe('name: kept\nsteps: []\n');
    expect(generated).toBe('export default function () {}\n');
    expect(snapshot).toBe('{}\n');
    expect(log).toBe('old log\n');
  });

  it('keeps an explicit module in default-directory update README commands', async () => {
    await runCli(
      [
        'init',
        '--module',
        'bos',
        '--base-url',
        'https://api.test.local',
        '--openapi',
        'https://api.test.local/v3/api-docs',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );
    await writeFile(
      path.join(workspace, 'load-tests/config.yaml'),
      [
        'defaultModule: bos',
        'modules:',
        '  bos:',
        '    openapi: https://bos.test.local/v3/api-docs',
        '    snapshot: openapi/bos.openapi.json',
        '    catalog: openapi/bos.catalog.json',
        '  vendor:',
        '    openapi: https://vendor.test.local/v3/api-docs',
        '    snapshot: snapshots/vendor.snapshot.json',
        '    catalog: catalogs/vendor.catalog.json',
        '',
      ].join('\n'),
      'utf8',
    );

    await runCli(
      ['update', '--module', 'vendor'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const readme = await readFile(path.join(workspace, 'load-tests/README.md'), 'utf8');

    expect(readme).toContain('npx --yes openapi-k6 sync --module vendor');
    expect(readme).toContain('npx --yes openapi-k6 test --module vendor -s <name>');
    expect(readme).toContain('npx --yes openapi-k6 test --module vendor -s smoke');
    expect(readme).toContain('npx --yes openapi-k6 generate \\\n  --module vendor \\\n  -s smoke');
    expect(readme).toContain('npx --yes openapi-k6 test --module vendor -s login-flow');
    expect(readme).toContain('npx --yes openapi-k6 generate --module vendor -s login-flow');
    expect(readme).toContain('npx --yes openapi-k6 update --module vendor');
    expect(readme).toContain('load-tests/snapshots/vendor.snapshot.json');
    expect(readme).toContain('load-tests/catalogs/vendor.catalog.json');
    expect(readme).toContain('snapshot: snapshots/vendor.snapshot.json');
    expect(readme).toContain('catalog: catalogs/vendor.catalog.json');
    expect(readme).toContain('├── snapshots/vendor.snapshot.json');
    expect(readme).toContain('├── catalogs/vendor.catalog.json');
    expect(readme).not.toContain('openapi/vendor.openapi.json');
    expect(readme).not.toContain('openapi/vendor.catalog.json');
    expect(readme).not.toContain('load-tests/openapi/vendor.openapi.json');
    expect(readme).not.toContain('load-tests/openapi/vendor.catalog.json');
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

  it('keeps --openapi precedence over config snapshots for generate and validate', async () => {
    await writeGenerateFixtures(workspace, 'https://override-openapi.test.local');
    await writeConfig([
      'baseUrl: https://config-base.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: TODO',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    await runCli(
      [
        'validate',
        '--config',
        'load-tests/config.yaml',
        '--openapi',
        'openapi.yaml',
        '--scenario',
        'scenario.yaml',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    await runCli(
      [
        'generate',
        '--config',
        'load-tests/config.yaml',
        '--openapi',
        'openapi.yaml',
        '--scenario',
        'scenario.yaml',
        '--write',
        'generated/script.js',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const output = await readFile(path.join(workspace, 'generated/script.js'), 'utf8');

    expect(output).toContain('const BASE_URL = __ENV.BASE_URL || "https://config-base.test.local";');
    expect(output).toContain('const url0 = joinUrl(BASE_URL, `/health`);');
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

  it('summarizes the configured catalog without dumping every operation', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    await writeCatalog('openapi/app.catalog.json', createCatalogOperations());
    const stdout = createCapture();

    await runCli(
      ['catalog'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const output = stdout.output();

    expect(output).toContain('Catalog: load-tests/openapi/app.catalog.json');
    expect(output).toContain('Module: app');
    expect(output).toContain('Operations: 4');
    expect(output).toContain('Tags:');
    expect(output).toContain('auth');
    expect(output).toContain('orders');
    expect(output).toContain('Use filters:');
    expect(output).toContain('openapi-k6 catalog --query login');
    expect(output).not.toContain('operationId: loginUser');
  });

  it('filters catalog operations for scenario authoring', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '  vendor:',
      '    snapshot: openapi/vendor.openapi.json',
      '    catalog: openapi/vendor.catalog.json',
      '',
    ]);
    await writeCatalog('openapi/app.catalog.json', createCatalogOperations());
    await writeCatalog('openapi/vendor.catalog.json', [
      {
        method: 'GET',
        path: '/vendors',
        operationId: 'searchVendors',
        tags: ['vendor'],
        summary: 'Search vendors',
        parameters: [
          { name: 'keyword', in: 'query', schema: { type: 'string' } },
        ],
        hasRequestBody: false,
      },
    ]);
    const queryOutput = createCapture();
    const methodTagOutput = createCapture();
    const moduleOutput = createCapture();

    await runCli(
      ['catalog', '--query', 'login'],
      { cwd: workspace, stdout: queryOutput.stream, stderr: createSink() },
    );
    await runCli(
      ['catalog', '--method', 'POST', '--tag', 'orders'],
      { cwd: workspace, stdout: methodTagOutput.stream, stderr: createSink() },
    );
    await runCli(
      ['catalog', '--module', 'vendor', '--query', 'vendor'],
      { cwd: workspace, stdout: moduleOutput.stream, stderr: createSink() },
    );

    expect(queryOutput.output()).toContain('Query: login');
    expect(queryOutput.output()).toContain('Operations: 1');
    expect(queryOutput.output()).toContain('POST   /auth/login');
    expect(queryOutput.output()).toContain('operationId: loginUser');
    expect(queryOutput.output()).toContain('body: yes (application/json)');
    expect(queryOutput.output()).not.toContain('createOrder');

    expect(methodTagOutput.output()).toContain('Method: POST');
    expect(methodTagOutput.output()).toContain('Tag: orders');
    expect(methodTagOutput.output()).toContain('Operations: 1');
    expect(methodTagOutput.output()).toContain('POST   /orders');
    expect(methodTagOutput.output()).toContain('operationId: createOrder');
    expect(methodTagOutput.output()).toContain('parameters: header Idempotency-Key');
    expect(methodTagOutput.output()).not.toContain('loginUser');

    expect(moduleOutput.output()).toContain('Module: vendor');
    expect(moduleOutput.output()).toContain('operationId: searchVendors');
    expect(moduleOutput.output()).toContain('parameters: query keyword');
    expect(moduleOutput.output()).not.toContain('createOrder');
  });

  it('prints filtered catalog operations as JSON', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    await writeCatalog('openapi/app.catalog.json', createCatalogOperations());
    const stdout = createCapture();

    await runCli(
      ['catalog', '--json', '--query', 'order'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const output = JSON.parse(stdout.output()) as {
      operationCount: number;
      filters: { query?: string };
      operations: Array<{ operationId?: string }>;
    };

    expect(output.operationCount).toBe(2);
    expect(output.filters.query).toBe('order');
    expect(output.operations.map((operation) => operation.operationId)).toEqual([
      'getOrder',
      'createOrder',
    ]);
  });

  it('adds modules and lists configured modules', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://app.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    const addOutput = createCapture();

    await runCli(
      [
        'module',
        'add',
        'auth',
        '--openapi',
        'https://auth.test.local/v3/api-docs',
        '--base-url',
        'https://auth-api.test.local',
        '--set-default',
      ],
      { cwd: workspace, stdout: addOutput.stream, stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(config).toContain('defaultModule: auth');
    expect(config).toContain('  auth:');
    expect(config).toContain('    # module 전용 API base URL입니다.');
    expect(config).toContain('    # 없으면 root baseUrl 또는 OpenAPI servers[0].url을 사용합니다.');
    expect(config).toContain('    baseUrl: https://auth-api.test.local');
    expect(config).toContain('    # sync가 읽을 OpenAPI URL 또는 파일 경로입니다.');
    expect(config).toContain('    openapi: https://auth.test.local/v3/api-docs');
    expect(config).toContain('    # sync가 저장하고 generate가 읽을 OpenAPI snapshot 경로입니다.');
    expect(config).toContain('    snapshot: openapi/auth.openapi.json');
    expect(config).toContain('    # scenario 작성자가 endpoint를 고를 때 참고할 catalog 경로입니다.');
    expect(config).toContain('    catalog: openapi/auth.catalog.json');
    expect(addOutput.output()).toContain('Module auth saved in load-tests/config.yaml');
    expect(addOutput.output()).toContain('default   yes');
    expect(addOutput.output()).toContain('npx --yes openapi-k6 sync --module auth');
    expect(addOutput.output()).toContain('npx --yes openapi-k6 catalog --module auth --all');
    expect(addOutput.output()).toContain('npx --yes openapi-k6 module list');
    expect(addOutput.output()).toContain('add api.module: auth to scenario steps that use this module');

    const listOutput = createCapture();
    await runCli(
      ['module', 'list'],
      { cwd: workspace, stdout: listOutput.stream, stderr: createSink() },
    );

    expect(listOutput.output()).toContain('Default: auth');
    expect(listOutput.output()).toContain('  - app');
    expect(listOutput.output()).toContain('  * auth');

    const jsonOutput = createCapture();
    await runCli(
      ['module', 'list', '--json'],
      { cwd: workspace, stdout: jsonOutput.stream, stderr: createSink() },
    );

    const output = JSON.parse(jsonOutput.output()) as {
      defaultModule: string;
      modules: Array<{ name: string; isDefault: boolean; snapshot?: string }>;
    };

    expect(output.defaultModule).toBe('auth');
    expect(output.modules).toContainEqual(expect.objectContaining({
      name: 'auth',
      isDefault: true,
      snapshot: 'openapi/auth.openapi.json',
    }));
  });

  it('discovers module add OpenAPI from base URL when --openapi is omitted', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://app.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    const requestedUrls: string[] = [];
    const stdout = createCapture();

    await runCli(
      ['module', 'add', 'auth', '--base-url', 'https://auth.test.local'],
      {
        cwd: workspace,
        stdout: stdout.stream,
        stderr: createSink(),
        fetch: async (input) => {
          const url = String(input);
          requestedUrls.push(url);

          if (url === 'https://auth.test.local/api-docs') {
            return createOpenApiResponse();
          }

          return new Response(JSON.stringify({ message: 'not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');
    const output = stdout.output();

    expect(requestedUrls).toEqual([
      'https://auth.test.local/v3/api-docs',
      'https://auth.test.local/api-docs',
    ]);
    expect(config).toContain('    baseUrl: https://auth.test.local');
    expect(config).toContain('    openapi: https://auth.test.local/api-docs');
    expect(output).toContain('OpenAPI discovery');
    expect(output).toContain('https://auth.test.local/v3/api-docs  HTTP 404');
    expect(output).toContain('https://auth.test.local/api-docs  OpenAPI 3.0.3');
    expect(output).toContain('Module auth saved in load-tests/config.yaml');
  });

  it('fails module add discovery clearly before saving config', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://app.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    const before = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    await expect(
      runCli(
        ['module', 'add', 'auth'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('--openapi is required unless --base-url is provided for OpenAPI auto-discovery.');

    await expect(
      runCli(
        ['module', 'add', 'auth', '--base-url', 'openapi.yaml'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('--base-url must be an http(s) URL to discover OpenAPI. Pass --openapi for file paths.');

    await expect(
      runCli(
        ['module', 'add', 'auth', '--base-url', 'https://auth.test.local'],
        {
          cwd: workspace,
          stdout: createSink(),
          stderr: createSink(),
          fetch: async () => new Response(JSON.stringify({ message: 'not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
        },
      ),
    ).rejects.toThrow('OpenAPI auto-discovery failed for module "auth": https://auth.test.local/swagger/v1/swagger.json: HTTP 404');

    const after = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(after).toBe(before);
  });

  it('updates duplicate modules only with --force and changes defaultModule explicitly', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://app.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '  bos:',
      '    openapi: https://old-bos.test.local/v3/api-docs',
      '    snapshot: openapi/old-bos.openapi.json',
      '    catalog: openapi/old-bos.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['module', 'add', 'bos', '--openapi', 'https://bos.test.local/v3/api-docs'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('module "bos" already exists. Use --force to update it.');

    await runCli(
      [
        'module',
        'add',
        'bos',
        '--openapi',
        'https://bos.test.local/v3/api-docs',
        '--base-url',
        'https://bos-api.test.local',
        '--snapshot',
        'openapi/bos.openapi.json',
        '--catalog',
        'openapi/bos.catalog.json',
        '--force',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );
    await runCli(
      ['module', 'set-default', 'bos'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(config).toContain('defaultModule: bos');
    expect(config).toContain('    baseUrl: https://bos-api.test.local');
    expect(config).toContain('    openapi: https://bos.test.local/v3/api-docs');
    expect(config).not.toContain('https://old-bos.test.local/v3/api-docs');

    await expect(
      runCli(
        ['module', 'set-default', 'missing'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('module "missing" was not found. Available modules: app, bos');
  });

  it('syncs a newly added module before saving config', async () => {
    await writeGenerateFixtures(workspace, 'https://auth-api.test.local');
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/auth.yaml'),
      [
        'name: auth',
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
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://app.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    const stdout = createCapture();

    await runCli(
      [
        'module',
        'add',
        'auth',
        '--openapi',
        'openapi.yaml',
        '--sync',
        '--set-default',
      ],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');
    const snapshot = await readFile(path.join(workspace, 'load-tests/openapi/auth.openapi.json'), 'utf8');
    const catalog = await readFile(path.join(workspace, 'load-tests/openapi/auth.catalog.json'), 'utf8');

    expect(config).toContain('defaultModule: auth');
    expect(config).toContain('    # sync가 읽을 OpenAPI URL 또는 파일 경로입니다.');
    expect(config).toContain('    openapi: ../openapi.yaml');
    expect(config).toContain('    # generate 입력은 catalog가 아니라 snapshot입니다.');
    expect(snapshot).toContain('"operationId": "getHealth"');
    expect(catalog).toContain('"operationId": "getHealth"');
    expect(stdout.output()).toContain('Synced load-tests/openapi/auth.openapi.json');
    expect(stdout.output()).toContain('Catalog load-tests/openapi/auth.catalog.json (1 operations)');
    expect(stdout.output()).toContain('npx --yes openapi-k6 catalog --module auth --all');
    expect(stdout.output()).toContain('npx --yes openapi-k6 module list');
    expect(stdout.output()).not.toContain('npx --yes openapi-k6 sync --module auth');

    await runCli(
      ['validate', '--scenario', 'auth'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );
    await runCli(
      ['generate', '--scenario', 'auth', '--write', 'generated/auth.js'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const generated = await readFile(path.join(workspace, 'generated/auth.js'), 'utf8');
    expect(generated).toContain('const url0 = joinUrl(BASE_URL, `/health`);');
  });

  it('uses custom config paths for module management commands', async () => {
    await mkdir(path.join(workspace, 'custom-load-tests'), { recursive: true });
    await writeFile(
      path.join(workspace, 'custom-load-tests/config.yaml'),
      [
        'defaultModule: app',
        'modules:',
        '  app:',
        '    openapi: https://app.test.local/v3/api-docs',
        '    snapshot: openapi/app.openapi.json',
        '    catalog: openapi/app.catalog.json',
        '',
      ].join('\n'),
      'utf8',
    );
    const addOutput = createCapture();

    await runCli(
      [
        'module',
        'add',
        'auth',
        '--config',
        'custom-load-tests/config.yaml',
        '--openapi',
        'openapi.yaml',
      ],
      { cwd: workspace, stdout: addOutput.stream, stderr: createSink() },
    );
    await runCli(
      ['module', 'set-default', 'auth', '--config', 'custom-load-tests/config.yaml'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'custom-load-tests/config.yaml'), 'utf8');

    expect(config).toContain('defaultModule: auth');
    expect(config).toContain('  auth:');
    expect(config).toContain('    openapi: ../openapi.yaml');
    expect(config).toContain('    snapshot: openapi/auth.openapi.json');
    expect(addOutput.output()).toContain('Module auth saved in custom-load-tests/config.yaml');
    expect(addOutput.output()).toContain('npx --yes openapi-k6 sync --config custom-load-tests/config.yaml --module auth');
    expect(addOutput.output()).toContain('npx --yes openapi-k6 catalog --config custom-load-tests/config.yaml --module auth --all');
    expect(addOutput.output()).toContain('npx --yes openapi-k6 module list --config custom-load-tests/config.yaml');

    const listOutput = createCapture();
    await runCli(
      ['module', 'list', '--config', 'custom-load-tests/config.yaml', '--json'],
      { cwd: workspace, stdout: listOutput.stream, stderr: createSink() },
    );

    const output = JSON.parse(listOutput.output()) as {
      configPath: string;
      defaultModule: string;
      modules: Array<{ name: string; openapi?: string }>;
    };

    expect(output.configPath).toBe(path.join(workspace, 'custom-load-tests/config.yaml'));
    expect(output.defaultModule).toBe('auth');
    expect(output.modules).toContainEqual(expect.objectContaining({
      name: 'auth',
      openapi: '../openapi.yaml',
    }));
  });

  it('does not save a module when module add --sync fails', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://app.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    const before = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    await expect(
      runCli(
        ['module', 'add', 'auth', '--openapi', 'missing-openapi.yaml', '--sync'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('missing-openapi.yaml');

    const after = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(after).toBe(before);
    await expect(
      stat(path.join(workspace, 'load-tests/openapi/auth.openapi.json')),
    ).rejects.toThrow();
  });

  it('explains that config is required for module management commands', async () => {
    await expect(
      runCli(
        ['module', 'list'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('load-tests/config.yaml was not found. Run openapi-k6 init or pass --config.');

    await expect(
      runCli(
        ['module', 'add', 'auth', '--openapi', 'openapi.yaml'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('load-tests/config.yaml was not found. Run openapi-k6 init or pass --config.');
  });

  it('removes non-default modules from config without deleting generated files', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://app.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '  vendor:',
      '    openapi: https://vendor.test.local/v3/api-docs',
      '    snapshot: openapi/vendor.openapi.json',
      '    catalog: openapi/vendor.catalog.json',
      '',
    ]);
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await writeFile(path.join(workspace, 'load-tests/openapi/vendor.openapi.json'), '{}', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/openapi/vendor.catalog.json'), '{}', 'utf8');
    const stdout = createCapture();

    await runCli(
      ['module', 'remove', 'vendor'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(stdout.output()).toContain('Module vendor removed from load-tests/config.yaml');
    expect(config).toContain('defaultModule: app');
    expect(config).not.toContain('  vendor:');
    await expect(stat(path.join(workspace, 'load-tests/openapi/vendor.openapi.json'))).resolves.toBeTruthy();
    await expect(stat(path.join(workspace, 'load-tests/openapi/vendor.catalog.json'))).resolves.toBeTruthy();
  });

  it('guards module remove for default, last, and referenced modules', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://app.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '  bos:',
      '    openapi: https://bos.test.local/v3/api-docs',
      '    snapshot: openapi/bos.openapi.json',
      '    catalog: openapi/bos.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['module', 'remove', 'app'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('module "app" is defaultModule. Use --force to remove it.');

    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://app.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['module', 'remove', 'app', '--force'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('cannot remove the last module "app".');

    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://app.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '  bos:',
      '    openapi: https://bos.test.local/v3/api-docs',
      '    snapshot: openapi/bos.openapi.json',
      '    catalog: openapi/bos.catalog.json',
      '',
    ]);
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/cross.yaml'),
      [
        'name: cross',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      module: bos',
        '      operationId: createOrder',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(
      runCli(
        ['module', 'remove', 'bos'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('module "bos" is referenced by scenarios.');

    const stdout = createCapture();

    await runCli(
      ['module', 'remove', 'bos', '--force'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'load-tests/config.yaml'), 'utf8');

    expect(stdout.output()).toContain('Forced removal; scenario references still exist:');
    expect(stdout.output()).toContain('load-tests/scenarios/cross.yaml step "create-order"');
    expect(config).not.toContain('  bos:');
  });

  it('explains how to create the catalog when the configured catalog file is missing', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://api.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['catalog', '--query', 'login'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow([
      `${path.join(workspace, 'load-tests/openapi/app.catalog.json')} was not found.`,
      '',
      'Run this first:',
      '  npx --yes openapi-k6 sync --module app',
      '',
      'Then retry:',
      '  npx --yes openapi-k6 catalog --module app --query login',
    ].join('\n'));
  });

  it('includes custom config and module options when explaining a missing catalog file', async () => {
    await mkdir(path.join(workspace, 'custom-load-tests'), { recursive: true });
    await writeFile(
      path.join(workspace, 'custom-load-tests/config.yaml'),
      [
        'defaultModule: bos',
        'modules:',
        '  bos:',
        '    openapi: https://api.test.local/v3/api-docs',
        '    snapshot: openapi/bos.openapi.json',
        '    catalog: openapi/bos.catalog.json',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(
      runCli(
        ['catalog', '--config', 'custom-load-tests/config.yaml', '--module', 'bos', '--method', 'POST', '--json'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow([
      `${path.join(workspace, 'custom-load-tests/openapi/bos.catalog.json')} was not found.`,
      '',
      'Run this first:',
      '  npx --yes openapi-k6 sync --config custom-load-tests/config.yaml --module bos',
      '',
      'Then retry:',
      '  npx --yes openapi-k6 catalog --config custom-load-tests/config.yaml --module bos --method POST --json',
    ].join('\n'));
  });

  it('explains that OpenAPI must be configured before creating a missing catalog file', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: TODO',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['catalog', '--query', 'login'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow([
      `${path.join(workspace, 'load-tests/openapi/app.catalog.json')} was not found.`,
      '',
      'Configure OpenAPI source first:',
      `  ${path.join(workspace, 'load-tests/config.yaml')}`,
      '',
      'Set:',
      '  modules.app.openapi',
      '',
      'Then run:',
      '  npx --yes openapi-k6 sync --module app',
      '',
      'Then retry:',
      '  npx --yes openapi-k6 catalog --module app --query login',
    ].join('\n'));
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
    ).rejects.toThrow([
      'modules.default.openapi is not configured.',
      '',
      'Edit:',
      `  ${path.join(workspace, 'load-tests/config.yaml')}`,
      '',
      'Set:',
      '  modules.default.openapi',
      '',
      'After editing:',
      '  rerun the command',
    ].join('\n'));
  });

  it('fails clearly when sync sees TODO snapshot or catalog config values', async () => {
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://api.test.local/v3/api-docs',
      '    snapshot: TODO',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['sync'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow([
      'modules.app.snapshot is not configured.',
      '',
      'Edit:',
      `  ${path.join(workspace, 'load-tests/config.yaml')}`,
      '',
      'Set:',
      '  modules.app.snapshot',
      '',
      'After editing:',
      '  rerun the command',
    ].join('\n'));

    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: https://api.test.local/v3/api-docs',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: TODO',
      '',
    ]);

    await expect(
      runCli(
        ['sync'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow([
      'modules.app.catalog is not configured.',
      '',
      'Edit:',
      `  ${path.join(workspace, 'load-tests/config.yaml')}`,
      '',
      'Set:',
      '  modules.app.catalog',
      '',
      'After editing:',
      '  rerun the command',
    ].join('\n'));
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

  it('validates a scenario by name using the configured OpenAPI snapshot', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: get-order',
        '    api:',
        '      operationId: getOrder',
        '    request:',
        '      pathParams:',
        '        orderId: order-1',
        '      query:',
        '        includeItems: true',
        '      headers:',
        '        x-tenant: main',
        '    condition: status < 300',
        '    extract:',
        '      itemId:',
        '        from: $.items[0].id',
        '  - id: create-order',
        '    api:',
        '      method: POST',
        '      path: /orders',
      '    request:',
      '      body:',
      '        id: "{{itemId}}"',
      '        items:',
      '          - id: "{{itemId}}"',
      '  - id: upload-file',
      '    api:',
      '      operationId: uploadFile',
      '    request:',
      '      multipart:',
      '        fields:',
      '          title: "{{itemId}}"',
      '        files:',
      '          attachment:',
      '            path: fixtures/order.txt',
      '',
    ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    const stdout = createCapture();
    await runCli(
      ['validate', '-s', 'smoke'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    expect(stdout.output()).toContain('Validated load-tests/scenarios/smoke.yaml');
    expect(stdout.output()).toContain('  openapi  load-tests/openapi/app.openapi.yaml');
    expect(stdout.output()).toContain('  module   app');
    expect(stdout.output()).toContain('  scenario smoke');
    expect(stdout.output()).toContain('  steps    3');
  });

  it('reports scenario validation issues before running API requests', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: get-order',
        '    api:',
        '      operationId: getOrder',
        '    request:',
        '      pathParams:',
        '        orderId: []',
        '      query:',
        '        includeItems: []',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '  - id: create-order-multipart',
        '    api:',
        '      operationId: createOrder',
        '    request:',
        '      multipart:',
        '        files:',
        '          attachment:',
        '            path: fixtures/order.txt',
        '  - id: upload-json',
        '    api:',
        '      operationId: uploadFile',
        '    request:',
        '      body:',
        '        filename: order.txt',
        '  - id: delete-order',
        '    api:',
        '      operationId: deleteOrder',
        '    request:',
        '      pathParams:',
        '        orderId: order-1',
        '      body:',
        '        reason: cleanup',
        '  - id: upload-on-delete',
        '    api:',
        '      operationId: deleteOrder',
        '    request:',
        '      pathParams:',
        '        orderId: order-2',
        '      multipart:',
        '        files:',
        '          attachment:',
        '            path: fixtures/delete.txt',
        '  - id: invalid-condition',
        '    api:',
        '      operationId: getOrder',
        '    request:',
        '      pathParams:',
        '        orderId: order-3',
        '      query:',
        '        includeItems: true',
        '      headers:',
        '        X-Tenant: main',
        '    condition: status <= 299',
        '  - id: invalid-extract',
        '    api:',
        '      operationId: getOrder',
        '    request:',
        '      pathParams:',
        '        orderId: order-4',
        '      query:',
        '        includeItems: true',
        '      headers:',
        '        X-Tenant: main',
        '    extract:',
        '      firstItem:',
        '        from: $.items[*].id',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['validate', '-s', 'smoke'],
        {
          cwd: workspace,
          stdout: createSink(),
          stderr: createSink(),
          fetch: async () => {
            throw new Error('validate must not call fetch');
          },
        },
      ),
    ).rejects.toThrow([
      'Scenario validation failed:',
      '  - step "get-order": missing request.pathParams.orderId for path /orders/{orderId}',
      '  - step "get-order": missing request.query.includeItems required by GET /orders/{orderId}',
      '  - step "get-order": missing request.headers.X-Tenant required by GET /orders/{orderId}',
      '  - step "create-order": request.body or request.multipart is required by POST /orders',
      '  - step "create-order-multipart": request.multipart requires OpenAPI requestBody content type multipart/form-data by POST /orders',
      '  - step "upload-json": request.body requires OpenAPI requestBody content type application/json or +json by POST /uploads',
      '  - step "delete-order": request.body is only supported for POST, PUT, or PATCH by DELETE /orders/{orderId}',
      '  - step "upload-on-delete": request.multipart is only supported for POST, PUT, or PATCH by DELETE /orders/{orderId}',
      '  - step "invalid-condition": unsupported condition "status <= 299"',
      '  - step "invalid-extract": extract.firstItem.from is invalid: Unsupported JSONPath "$.items[*].id"',
    ].join('\n'));
  });

  it('reports invalid or unavailable context template references during validation', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: get-order',
        '    api:',
        '      operationId: getOrder',
        '    request:',
        '      pathParams:',
        '        orderId: order-1',
        '      query:',
        '        includeItems: true',
        '      headers:',
        '        X-Tenant: main',
        '    extract:',
        '      itemId:',
        '        from: $.items[0].id',
        '  - id: typo-reference',
        '    api:',
        '      operationId: createOrder',
        '    request:',
        '      body:',
        '        id: "{{itmeId}}"',
        '        token: "{{env.API_TOKEN}}"',
        '  - id: same-step-reference',
        '    api:',
        '      operationId: getOrder',
        '    request:',
        '      pathParams:',
        '        orderId: "{{selfId}}"',
        '      query:',
        '        includeItems: true',
        '      headers:',
        '        X-Tenant: main',
        '    extract:',
        '      selfId:',
        '        from: $.id',
        '  - id: future-reference',
        '    api:',
        '      operationId: createOrder',
        '    request:',
        '      body:',
        '        id: "{{futureId}}"',
        '        items:',
        '          - id: "{{missingItemId}}"',
        '  - id: upload-metadata',
        '    api:',
        '      operationId: uploadFile',
        '    request:',
        '      multipart:',
        '        files:',
        '          attachment:',
        '            path: fixtures/order.txt',
        '            filename: "{{missingFilename}}"',
        '            contentType: "{{env.CONTENT_TYPE}}"',
        '  - id: invalid-template',
        '    api:',
        '      operationId: createOrder',
        '    request:',
        '      body:',
        '        id: "Bearer {{bad-name}}"',
        '  - id: future-source',
        '    api:',
        '      operationId: getOrder',
        '    request:',
        '      pathParams:',
        '        orderId: order-2',
        '      query:',
        '        includeItems: true',
        '      headers:',
        '        X-Tenant: main',
        '    extract:',
        '      futureId:',
        '        from: $.id',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['validate', '-s', 'smoke'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow([
      'Scenario validation failed:',
      '  - step "typo-reference": request.body.id references unknown context.itmeId',
      '  - step "same-step-reference": request.pathParams.orderId references unknown context.selfId',
      '  - step "future-reference": request.body.id references unknown context.futureId',
      '  - step "future-reference": request.body.items[0].id references unknown context.missingItemId',
      '  - step "upload-metadata": request.multipart.files.attachment.filename references unknown context.missingFilename',
      '  - step "invalid-template": request.body.id has invalid template: Invalid template string: Bearer {{bad-name}}',
    ].join('\n'));
  });

  it('warns about unused scenario path parameters during validation', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: get-order',
        '    api:',
        '      operationId: getOrder',
        '    request:',
      '      pathParams:',
      '        orderId: order-1',
      '        id: "{{unusedId}}"',
        '      query:',
        '        includeItems: true',
        '      headers:',
        '        X-Tenant: main',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);

    const stdout = createCapture();
    await runCli(
      ['validate', '-s', 'smoke'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    expect(stdout.output()).toContain('Warnings:');
    expect(stdout.output()).toContain('  - step "get-order": request.pathParams.id is not used by path /orders/{orderId}');
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

  it('updates running state with elapsed time for TTY streams', async () => {
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
    const stdout = createCapture({ isTTY: true });
    const runPromise = runCli(
      ['test', '-s', 'smoke'],
      {
        cwd: workspace,
        stdout: stdout.stream,
        stderr: createSink(),
        env: { NO_COLOR: '1' },
        fetch: async () => responsePromise,
      },
    );

    await waitForOutput(stdout.output, 'state: → running 0.0s');

    expect(stdout.output()).toContain('\r');
    expect(stdout.output()).not.toContain('summary:');

    resolveResponse(new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK' }));
    await runPromise;

    expect(stdout.output()).toContain('status: ✓ 200 OK');
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
    expect(stdout.output()).not.toContain('\u001b[91m404 Not Found');
    expect(stdout.output()).toContain('\u001b[36mGET\u001b[0m');
    expect(stdout.output()).toContain('\u001b[36m→ running\u001b[0m');
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
    ).rejects.toThrow([
      'modules.app.snapshot is not configured.',
      '',
      'Edit:',
      `  ${path.join(workspace, 'load-tests/config.yaml')}`,
      '',
      'Set:',
      '  modules.app.snapshot',
      '',
      'After editing:',
      '  rerun the command',
    ].join('\n'));
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

  it('validates and generates step-level api.module scenarios with isolated registries', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('auth.openapi.yaml', '/auth-health', 'https://auth-openapi.test.local');
    await writeModuleOpenApi('bos-api.openapi.yaml', '/bos-health', 'https://bos-openapi.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/cross.yaml'),
      [
        'name: cross',
        'steps:',
        '  - id: auth-health',
        '    api:',
        '      module: auth',
        '      operationId: getHealth',
        '  - id: bos-health',
        '    api:',
        '      module: bos-api',
        '      operationId: getHealth',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'modules:',
      '  auth:',
      '    baseUrl: https://auth-api.test.local',
      '    snapshot: openapi/auth.openapi.yaml',
      '    catalog: openapi/auth.catalog.json',
      '  bos-api:',
      '    baseUrl: https://bos-api.test.local',
      '    snapshot: openapi/bos-api.openapi.yaml',
      '    catalog: openapi/bos-api.catalog.json',
      '',
    ]);

    const stdout = createCapture();
    await runCli(
      ['validate', '--config', 'load-tests/config.yaml', '--scenario', 'cross'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    expect(stdout.output()).toContain('  modules  auth, bos-api');
    expect(stdout.output()).toContain('    auth  load-tests/openapi/auth.openapi.yaml');
    expect(stdout.output()).toContain('    bos-api  load-tests/openapi/bos-api.openapi.yaml');

    await runCli(
      [
        'generate',
        '--config',
        'load-tests/config.yaml',
        '--scenario',
        'cross',
        '--write',
        'generated/cross.js',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const output = await readFile(path.join(workspace, 'generated/cross.js'), 'utf8');

    expect(output).toContain('const BASE_URL_0 = __ENV.BASE_URL_AUTH || __ENV.BASE_URL || "https://auth-api.test.local";');
    expect(output).toContain('const BASE_URL_1 = __ENV.BASE_URL_BOS_API || __ENV.BASE_URL || "https://bos-api.test.local";');
    expect(output).toContain('const url0 = joinUrl(BASE_URL_0, `/auth-health`);');
    expect(output).toContain('const url1 = joinUrl(BASE_URL_1, `/bos-health`);');
  });

  it('tests step-level api.module scenarios with module-specific BASE_URL env overrides', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('auth.openapi.yaml', '/auth-health', 'https://auth-openapi.test.local');
    await writeModuleOpenApi('bos.openapi.yaml', '/bos-health', 'https://bos-openapi.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/cross.yaml'),
      [
        'name: cross',
        'steps:',
        '  - id: auth-health',
        '    api:',
        '      module: auth',
        '      operationId: getHealth',
        '  - id: bos-health',
        '    api:',
        '      module: bos',
        '      operationId: getHealth',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'modules:',
      '  auth:',
      '    baseUrl: https://auth-api.test.local',
      '    snapshot: openapi/auth.openapi.yaml',
      '    catalog: openapi/auth.catalog.json',
      '  bos:',
      '    baseUrl: https://bos-api.test.local',
      '    snapshot: openapi/bos.openapi.yaml',
      '    catalog: openapi/bos.catalog.json',
      '',
    ]);
    const urls: string[] = [];

    await runCli(
      ['test', '--config', 'load-tests/config.yaml', '--scenario', 'cross', '--no-color'],
      {
        cwd: workspace,
        stdout: createSink(),
        stderr: createSink(),
        env: {
          BASE_URL_BOS: 'https://bos-env.test.local',
        },
        fetch: async (input) => {
          urls.push(String(input));
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    );

    expect(urls).toEqual([
      'https://auth-api.test.local/auth-health',
      'https://bos-env.test.local/bos-health',
    ]);
  });

  it('fails clearly when step-level module base URL env names collide', async () => {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('bos-api.openapi.yaml', '/dash-health', 'https://dash-openapi.test.local');
    await writeModuleOpenApi('bos_api.openapi.yaml', '/underscore-health', 'https://underscore-openapi.test.local');
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/cross.yaml'),
      [
        'name: cross',
        'steps:',
        '  - id: dash-health',
        '    api:',
        '      module: bos-api',
        '      operationId: getHealth',
        '  - id: underscore-health',
        '    api:',
        '      module: bos_api',
        '      operationId: getHealth',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'modules:',
      '  bos-api:',
      '    baseUrl: https://dash-api.test.local',
      '    snapshot: openapi/bos-api.openapi.yaml',
      '    catalog: openapi/bos-api.catalog.json',
      '  bos_api:',
      '    baseUrl: https://underscore-api.test.local',
      '    snapshot: openapi/bos_api.openapi.yaml',
      '    catalog: openapi/bos_api.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['test', '--config', 'load-tests/config.yaml', '--scenario', 'cross', '--no-color'],
        { cwd: workspace, stdout: createSink(), stderr: createSink(), env: {} },
      ),
    ).rejects.toThrow('module base URL env name collision: modules "bos-api", "bos_api" all map to BASE_URL_BOS_API');
  });

  it('fails clearly when api.module is used without config', async () => {
    await writeGenerateFixtures(workspace);
    await writeFile(
      path.join(workspace, 'scenario.yaml'),
      [
        'name: module-without-config',
        'steps:',
        '  - id: health',
        '    api:',
        '      module: auth',
        '      operationId: getHealth',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(
      runCli(
        [
          'generate',
          '--openapi',
          'openapi.yaml',
          '--scenario',
          'scenario.yaml',
          '--write',
          'generated/script.js',
        ],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('step "health": api.module "auth" cannot be used with --openapi; use --config modules.<name>.snapshot');
  });

  it('fails clearly when step-level api.module is unknown or has no snapshot', async () => {
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'load-tests/scenarios/cross.yaml'),
      [
        'name: cross',
        'steps:',
        '  - id: auth-health',
        '    api:',
        '      module: auth',
        '      operationId: getHealth',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeConfig([
      'modules:',
      '  bos:',
      '    snapshot: openapi/bos.openapi.yaml',
      '    catalog: openapi/bos.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['validate', '--config', 'load-tests/config.yaml', '--scenario', 'cross'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('step "auth-health": api.module "auth" was not found. Available modules: bos');

    await writeConfig([
      'modules:',
      '  auth:',
      '    snapshot: TODO',
      '    catalog: openapi/auth.catalog.json',
      '',
    ]);

    await expect(
      runCli(
        ['validate', '--config', 'load-tests/config.yaml', '--scenario', 'cross'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('step "auth-health": modules.auth.snapshot is not configured.');
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

  async function writeCatalog(
    configRelativePath: string,
    operations: Array<Record<string, unknown>>,
  ): Promise<void> {
    const catalogPath = path.join(workspace, 'load-tests', configRelativePath);
    await mkdir(path.dirname(catalogPath), { recursive: true });
    await writeFile(
      catalogPath,
      JSON.stringify({
        generatedAt: '2026-05-08T00:00:00.000Z',
        source: '<test>',
        operations,
      }, null, 2) + '\n',
      'utf8',
    );
  }

  function createCatalogOperations(): Array<Record<string, unknown>> {
    return [
      {
        method: 'GET',
        path: '/orders/{orderId}',
        operationId: 'getOrder',
        tags: ['orders'],
        summary: 'Get order',
        parameters: [
          { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        hasRequestBody: false,
      },
      {
        method: 'POST',
        path: '/orders',
        operationId: 'createOrder',
        tags: ['orders'],
        summary: 'Create order',
        parameters: [
          { name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } },
        ],
        hasRequestBody: true,
        requestBodyContentTypes: ['application/json'],
      },
      {
        method: 'POST',
        path: '/auth/login',
        operationId: 'loginUser',
        tags: ['auth'],
        summary: 'Login user',
        parameters: [],
        hasRequestBody: true,
        requestBodyContentTypes: ['application/json'],
      },
      {
        method: 'POST',
        path: '/auth/logout',
        operationId: 'logoutUser',
        tags: ['auth'],
        summary: 'Logout user',
        parameters: [],
        hasRequestBody: false,
      },
    ];
  }

  async function writeRunFixtures(): Promise<void> {
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://app-openapi.test.local');
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
      'baseUrl: https://app-api.test.local',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
  }

  async function writeFakeK6(binDir: string, bodyLines: string[]): Promise<void> {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      path.join(binDir, 'k6'),
      [
        '#!/usr/bin/env bash',
        ...bodyLines,
        '',
      ].join('\n'),
      'utf8',
    );
    await chmod(path.join(binDir, 'k6'), 0o755);
  }

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
