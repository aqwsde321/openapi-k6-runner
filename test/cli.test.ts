import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli, runUiCommand } from '../src/cli/index.js';
import { CURRENT_SCAFFOLD_VERSION } from '../src/scaffold/load-test.init.js';

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

function listenTestServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeTestServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
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
  await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
  await writeFile(
    path.join(workspace, 'openapi-k6/openapi/app.openapi.yaml'),
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
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_NO_WARNINGS: '1',
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  it('installs the bundled Codex skill into a custom target directory', async () => {
    const stdout = createCapture();
    const targetDir = path.join(workspace, 'codex-skills/openapi-k6-scenario');

    await runCli(
      ['install-skill', '--target-dir', targetDir, '--yes'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const skill = await readFile(path.join(targetDir, 'SKILL.md'), 'utf8');
    const metadata = await readFile(path.join(targetDir, 'agents/openai.yaml'), 'utf8');

    expect(skill).toContain('name: openapi-k6-scenario');
    expect(skill).toContain('confirming the process and planned API calls');
    expect(metadata).toContain('default_prompt: "Use $openapi-k6-scenario');
    expect(stdout.output()).toContain('Installed openapi-k6-scenario skill for Codex.');
  });

  it('does not replace an existing installed Codex skill without --force', async () => {
    const targetDir = path.join(workspace, 'codex-skills/openapi-k6-scenario');
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, 'SKILL.md'), 'custom local skill', 'utf8');

    const stdout = createCapture();

    await runCli(
      ['install-skill', '--target-dir', targetDir, '--yes'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    await expect(readFile(path.join(targetDir, 'SKILL.md'), 'utf8')).resolves.toBe('custom local skill');
    expect(stdout.output()).toContain('Skill already installed.');
    expect(stdout.output()).toContain('use --force to replace');
  });

  it('initializes a openapi-k6 scaffold in the target project', async () => {
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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');
    const envExample = await readFile(path.join(workspace, 'openapi-k6/.env.example'), 'utf8');
    const gitignore = await readFile(path.join(workspace, 'openapi-k6/.gitignore'), 'utf8');
    const runScriptPath = path.join(workspace, 'openapi-k6/run.sh');
    const runScript = await readFile(runScriptPath, 'utf8');
    const runScriptStat = await stat(runScriptPath);
    const runScriptSyntax = spawnSync('bash', ['-n', runScriptPath], { encoding: 'utf8' });
    const scenario = await readFile(path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'), 'utf8');
    const partialExample = await readFile(path.join(workspace, 'openapi-k6/scenarios/partials/login.yaml.example'), 'utf8');
    const dataFixtureExample = await readFile(path.join(workspace, 'openapi-k6/scenarios/fixtures/dev.yaml.example'), 'utf8');
    const readme = await readFile(path.join(workspace, 'openapi-k6/README.md'), 'utf8');
    const metadata = JSON.parse(
      await readFile(path.join(workspace, 'openapi-k6/.openapi-k6.json'), 'utf8'),
    ) as { tool: string; schemaVersion: number; scaffoldVersion: string; generatedAt: string };

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
    expect(gitignore).toBe('*\n!.gitignore\n!.openapi-k6.json\n!scenarios/\n!scenarios/**\n');
    expect(metadata).toMatchObject({
      tool: 'openapi-k6',
      schemaVersion: 1,
      scaffoldVersion: CURRENT_SCAFFOLD_VERSION,
    });
    expect(new Date(metadata.generatedAt).toString()).not.toBe('Invalid Date');
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
    expect(partialExample).toContain('Rename this file to login.yaml and include it from a scenario');
    expect(partialExample).toContain('username: "{{vars.loginId}}"');
    expect(partialExample).toContain('password: "{{env.LOGIN_PASSWORD}}"');
    expect(partialExample).toContain('token:');
    expect(dataFixtureExample).toContain('loginId: tester@example.com');
    expect(dataFixtureExample).toContain('sku: ABC-001');
    expect(readme).toContain('# openapi-k6');
    expect(readme).toContain('AI coding agent용 openapi-k6 작업 계약입니다.');
    expect(readme).toContain('OpenAPI sync -> catalog 확인 -> API 호출 계획 확인 -> Scenario YAML 작성 -> validate/test');
    expect(readme).toContain('## AI 작업 계약');
    expect(readme).toContain('## 프로젝트 값');
    expect(readme).toContain('## 명령');
    expect(readme).toContain('## Scenario 작성 규칙');
    expect(readme).toContain('## 재사용 규칙');
    expect(readme).toContain('## 파일 규칙');

    expect(readme).toContain('npx --yes openapi-k6 sync');
    expect(readme).toContain('npx --yes openapi-k6 catalog --query <검색어>');
    expect(readme).toContain('npx --yes openapi-k6 catalog --query <검색어> --ai');
    expect(readme).toContain('npx --yes openapi-k6 catalog --sync --query <검색어> --ai');
    expect(readme).toContain('npx --yes openapi-k6 validate -s <name>');
    expect(readme).toContain('npx --yes openapi-k6 test -s <name>');
    expect(readme).toContain('npx --yes openapi-k6 run -s <name> --log -- --vus 1 --iterations 1');
    expect(readme).toContain('npx --yes openapi-k6 generate -s <name>');
    expect(readme).toContain('npx --yes openapi-k6 ui');

    const commandSection = readme.slice(readme.indexOf('## 명령'), readme.indexOf('## Scenario 작성 규칙'));

    expect(commandSection).not.toContain('catalog --query login');
    expect(commandSection).not.toContain('-s smoke');

    expect(readme).toContain('openapi-k6/config.yaml');
    expect(readme).toContain('openapi-k6/scenarios/<name>.yaml');
    expect(readme).toContain('openapi-k6/openapi/pharma.openapi.json');
    expect(readme).toContain('openapi-k6/openapi/pharma.catalog.json');
    expect(readme).toContain('openapi-k6/generated/*.k6.js');

    expect(readme).toContain('./openapi-k6/run.sh <scenario-name>');
    expect(readme).toContain('./openapi-k6/run.sh <scenario-name> --vus 1 --iterations 1');
    expect(readme).toContain('./openapi-k6/run.sh <scenario-name> --log');
    expect(readme).toContain('로그 파일: `openapi-k6/logs/<scenario-name>.log`');

    expect(readme).toContain('매번 전체를 다시 읽지 말고, 같은 대화에서 최신 `init`, `update`, README 변경 이후 이미 읽었다면 필요한 섹션만 확인합니다.');
    expect(readme).toContain('Scenario YAML을 쓰기 전에 사용자에게 아래 계획을 확인받습니다.');
    expect(readme).toContain('업무 프로세스');
    expect(readme).toContain('API 호출 순서와 method/path 또는 operationId');
    expect(readme).toContain('기존 partial include 재사용 또는 새 partial 생성 여부');
    expect(readme).toContain('사용자가 `ㅇ`, `ok`, `ㄱ`처럼 긍정하면 `openapi-k6/scenarios/*.yaml`을 작성하거나 수정합니다.');
    expect(readme).toContain('`catalog --ai` 초안의 `<...>` placeholder가 남아 있으면 `validate`가 실패합니다.');
    expect(readme).toContain('값 우선순위는 `fixtures:` < `vars:` < CLI `--var-file` < CLI `--var`입니다.');
    expect(readme).toContain('include 파일에는 `steps:`만 두고 `vars:`나 `fixtures:`는 entry scenario에서 관리합니다.');
    expect(readme).toContain('여러 OpenAPI 서버를 한 scenario에서 섞을 때만 `api.module`을 사용합니다.');
    expect(readme).toContain('openapi-k6/README.md');
    expect(readme).toContain('openapi-k6/run.sh');
    expect(readme).toContain('openapi-k6/.env.example');
    expect(readme).toContain('openapi-k6/.gitignore');
    expect(readme).toContain('openapi-k6/.openapi-k6.json');
    expect(readme).toContain('cp openapi-k6/.env.example openapi-k6/.env');
    expect(readme).toContain('`update`는 `config.yaml`, `.env`, `scenarios/`, snapshot/catalog 파일, `generated/`, `logs/`를 보존하고 README, runner, `.env.example`, `.gitignore`, `.openapi-k6.json` 같은 scaffold 파일만 최신화합니다.');
    expect(readme).not.toContain('## AI Work Guide');
    expect(readme).not.toContain('This section is for AI agents.');
    expect(readme).not.toContain('### Scenario DSL Reference');
    expect(readme).not.toContain('## 고급 기능');
    expect(readme.split('\n').length).toBeLessThan(150);
  });

  it('initializes and syncs the OpenAPI snapshot/catalog with --sync', async () => {
    await writeGenerateFixtures(workspace);
    const stdout = createCapture();

    await runCli(
      [
        'init',
        '--no-input',
        '--base-url',
        'https://api.test.local',
        '--openapi',
        'openapi.yaml',
        '--sync',
      ],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const snapshot = JSON.parse(
      await readFile(path.join(workspace, 'openapi-k6/openapi/default.openapi.json'), 'utf8'),
    ) as Record<string, unknown>;
    const catalog = JSON.parse(
      await readFile(path.join(workspace, 'openapi-k6/openapi/default.catalog.json'), 'utf8'),
    ) as { operations: Array<Record<string, unknown>> };
    const output = stdout.output();

    expect(snapshot.openapi).toBe('3.0.3');
    expect(catalog.operations).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: '/health',
        operationId: 'getHealth',
      }),
    ]);
    expect(output).toContain('Created openapi-k6');
    expect(output).toContain('Synced openapi-k6/openapi/default.openapi.json');
    expect(output).toContain('Catalog openapi-k6/openapi/default.catalog.json (1 operations)');
    expect(output).toContain('npx --yes openapi-k6 catalog --query <검색어> --ai');
  });

  it('runs the generated run.sh with --log when no k6 options are provided', async () => {
    await runCli(
      ['init'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );
    await writeFile(
      path.join(workspace, 'openapi-k6/generated/smoke.k6.js'),
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
      path.join(workspace, 'openapi-k6/run.sh'),
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
    const log = await readFile(path.join(workspace, 'openapi-k6/logs/smoke.log'), 'utf8');
    const args = await readFile(argLogPath, 'utf8');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Writing k6 output to');
    expect(log).toContain('fake-k6-output');
    expect(args).toBe([
      'run',
      path.join(workspace, 'openapi-k6/generated/smoke.k6.js'),
      '',
    ].join('\n'));
  });

  it('prints generated run.sh usage with --help', async () => {
    await runCli(
      ['init'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const result = spawnSync(
      path.join(workspace, 'openapi-k6/run.sh'),
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
    expect(result.stdout).toContain('run.sh <scenario-name>');
    expect(result.stdout).toContain('run.sh <scenario-name> --log');
    expect(result.stdout).toContain('run.sh <scenario-name> --trace --log --report --duration 10s --vus 1');
    expect(result.stdout).toContain('The default scenario is smoke.');
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
      path.join(workspace, 'openapi-k6/generated/smoke.k6.js'),
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
      path.join(workspace, 'openapi-k6/run.sh'),
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
      path.join(workspace, 'openapi-k6/generated/smoke.k6.js'),
      '',
    ].join('\n'));
    expect(envLog).toContain('OPENAPI_K6_TRACE=1');
    expect(envLog).toContain('K6_WEB_DASHBOARD=true');
    expect(envLog).toContain('K6_WEB_DASHBOARD_PERIOD=1s');
    expect(envLog).toContain(`K6_WEB_DASHBOARD_EXPORT=${path.join(workspace, 'openapi-k6/logs/smoke-report.html')}`);
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

    const generated = await readFile(path.join(workspace, 'openapi-k6/generated/smoke.k6.js'), 'utf8');
    const args = await readFile(argLogPath, 'utf8');

    expect(stdout.output()).toContain(`Generated ${path.join(workspace, 'openapi-k6/generated/smoke.k6.js')}`);
    expect(stdout.output()).toContain('fake-k6-output');
    expect(generated).toContain('const BASE_URL = __ENV.BASE_URL || "https://app-api.test.local";');
    expect(generated).toContain('const url0 = joinUrl(BASE_URL, `/app-health`);');
    expect(args).toBe([
      'run',
      '--vus',
      '1',
      '--iterations',
      '1',
      path.join(workspace, 'openapi-k6/generated/smoke.k6.js'),
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

    const log = await readFile(path.join(workspace, 'openapi-k6/logs/smoke.log'), 'utf8');
    const envLog = await readFile(envLogPath, 'utf8');

    expect(stdout.output()).toContain('Writing k6 HTML report to');
    expect(stdout.output()).toContain('Writing k6 output to');
    expect(log).toContain('fake-k6-output');
    expect(envLog).toContain('OPENAPI_K6_TRACE=1');
    expect(envLog).toContain('K6_WEB_DASHBOARD=true');
    expect(envLog).toContain('K6_WEB_DASHBOARD_PERIOD=1s');
    expect(envLog).toContain(`K6_WEB_DASHBOARD_EXPORT=${path.join(workspace, 'openapi-k6/logs/smoke-report.html')}`);
    expect(envLog).toContain('K6_WEB_DASHBOARD_OPEN=true');
  });

  it('does not execute k6 when run validation fails', async () => {
    await writeRunFixtures();
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    ).rejects.toThrow([
      'Scenario validation failed:',
      '  - step "health": operationId "missingOperation" was not found',
      '',
      'Fix hints:',
      '  - Find the endpoint with openapi-k6 catalog --query <keyword> --ai, then update api.operationId or use api.method/api.path.',
    ].join('\n'));

    await expect(readFile(argLogPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves existing generated k6 output when run validation fails', async () => {
    await writeRunFixtures();
    await mkdir(path.join(workspace, 'openapi-k6/generated'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    const outputPath = path.join(workspace, 'openapi-k6/generated/smoke.k6.js');
    const existingOutput = 'export default function () { console.log("keep me"); }\n';
    await writeFile(outputPath, existingOutput, 'utf8');
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
    ).rejects.toThrow([
      'Scenario validation failed:',
      '  - step "health": operationId "missingOperation" was not found',
      '',
      'Fix hints:',
      '  - Find the endpoint with openapi-k6 catalog --query <keyword> --ai, then update api.operationId or use api.method/api.path.',
    ].join('\n'));

    await expect(readFile(outputPath, 'utf8')).resolves.toBe(existingOutput);
    await expect(readFile(argLogPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports run validation errors before scaffold metadata read errors', async () => {
    await writeRunFixtures();
    await mkdir(path.join(workspace, 'openapi-k6/generated'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/.openapi-k6.json'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    const outputPath = path.join(workspace, 'openapi-k6/generated/smoke.k6.js');
    const existingOutput = 'export default function () { console.log("keep me"); }\n';
    await writeFile(outputPath, existingOutput, 'utf8');
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
    ).rejects.toThrow([
      'Scenario validation failed:',
      '  - step "health": operationId "missingOperation" was not found',
      '',
      'Fix hints:',
      '  - Find the endpoint with openapi-k6 catalog --query <keyword> --ai, then update api.operationId or use api.method/api.path.',
    ].join('\n'));

    await expect(readFile(outputPath, 'utf8')).resolves.toBe(existingOutput);
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('bos.openapi.yaml', '/bos-health', 'https://bos-openapi.test.local');
    await writeModuleOpenApi('vendor.openapi.yaml', '/vendor-health', 'https://vendor-openapi.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');
    const envExample = await readFile(path.join(workspace, 'openapi-k6/.env.example'), 'utf8');
    const scenario = await readFile(path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'), 'utf8');

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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

    expect(fetchCalls).toEqual(['http://localhost:8080/v3/api-docs']);
    expect(config).toContain('baseUrl: http://localhost:8080');
    expect(config).toContain('    openapi: http://localhost:8080/v3/api-docs');
    expect(output.output()).toContain('API base URL [http://localhost:8080]:');
    expect(output.output()).not.toContain('OpenAPI spec URL/file path');
    expect(output.output()).toContain('✓ http://localhost:8080/v3/api-docs  OpenAPI 3.0.3');
    expect(output.output()).toContain('✓ Created openapi-k6');
    expect(output.output()).toContain('Next');
    expect(output.output()).toContain('npx --yes openapi-k6 sync');
    expect(output.output()).toContain('npx --yes openapi-k6 validate -s <scenario-name>');
    expect(output.output()).toContain('./openapi-k6/run.sh <scenario-name> --log');
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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

    expect(config).toContain('    openapi: ../openapi.yaml');

    await runCli(
      ['sync'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const snapshot = await readFile(
      path.join(workspace, 'openapi-k6/openapi/default.openapi.json'),
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
    expect(readme).toContain('npx --yes openapi-k6 ui --config perf-tests/config.yaml --module pharma');
    expect(readme).toContain('npx --yes openapi-k6 update --config perf-tests/config.yaml --module pharma');
    expect(readme).toContain('--config perf-tests/config.yaml');
    expect(readme).toContain("--scenario 'perf-tests/scenarios/<name>.yaml'");
    expect(readme).toContain("--write 'perf-tests/generated/<name>.k6.js'");
    expect(readme).toContain('./perf-tests/run.sh <scenario-name>');
    expect(readme).toContain('./perf-tests/run.sh <scenario-name> --vus 1 --iterations 1');
    expect(readme).toContain('./perf-tests/run.sh <scenario-name> --log');
    expect(readme).toContain('로그 파일: `perf-tests/logs/<scenario-name>.log`');
    expect(readme).toContain('cp perf-tests/.env.example perf-tests/.env');
    expect(readme).not.toContain('openapi-k6/');

    await writeFile(path.join(workspace, 'perf-tests/README.md'), 'stale readme\n', 'utf8');
    await runCli(
      ['update', '--config', 'perf-tests/config.yaml', '--module', 'pharma'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const updatedReadme = await readFile(path.join(workspace, 'perf-tests/README.md'), 'utf8');

    expect(updatedReadme).toContain('npx --yes openapi-k6 update --config perf-tests/config.yaml --module pharma');
    expect(updatedReadme).toContain('npx --yes openapi-k6 sync --config perf-tests/config.yaml --module pharma');
    expect(updatedReadme).toContain('npx --yes openapi-k6 ui --config perf-tests/config.yaml --module pharma');
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
    expect(readme).toContain("npx --yes openapi-k6 ui --config 'perf tests/config.yaml' --module pharma");
    expect(readme).toContain("npx --yes openapi-k6 update --config 'perf tests/config.yaml' --module pharma");
    expect(readme).toContain("--config 'perf tests/config.yaml'");
    expect(readme).toContain("--scenario 'perf tests/scenarios/<name>.yaml'");
    expect(readme).toContain("--write 'perf tests/generated/<name>.k6.js'");
    expect(readme).toContain("'./perf tests/run.sh' <scenario-name>");
    expect(readme).toContain("'./perf tests/run.sh' <scenario-name> --log");
    expect(readme).toContain("cp 'perf tests/.env.example' 'perf tests/.env'");

    await writeFile(path.join(workspace, 'perf tests/README.md'), 'stale readme\n', 'utf8');
    await runCli(
      ['update', '--config', 'perf tests/config.yaml', '--module', 'pharma'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const updatedReadme = await readFile(path.join(workspace, 'perf tests/README.md'), 'utf8');

    expect(updatedReadme).toContain("npx --yes openapi-k6 update --config 'perf tests/config.yaml' --module pharma");
    expect(updatedReadme).toContain("npx --yes openapi-k6 ui --config 'perf tests/config.yaml' --module pharma");
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
    await writeFile(path.join(workspace, 'openapi-k6/README.md'), 'stale readme\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/run.sh'), '#!/usr/bin/env bash\necho stale\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'), 'name: stale\nsteps: []\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/.env'), 'LOGIN_PASSWORD=local-secret\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/scenarios/custom.yaml'), 'name: custom\nsteps: []\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/generated/custom.k6.js'), 'export default function () {}\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/openapi/custom.openapi.json'), '{}\n', 'utf8');
    await mkdir(path.join(workspace, 'openapi-k6/logs'), { recursive: true });
    await writeFile(path.join(workspace, 'openapi-k6/logs/smoke.log'), 'old log\n', 'utf8');

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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');
    const readme = await readFile(path.join(workspace, 'openapi-k6/README.md'), 'utf8');
    const runScript = await readFile(path.join(workspace, 'openapi-k6/run.sh'), 'utf8');
    const scenario = await readFile(path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'), 'utf8');
    const env = await readFile(path.join(workspace, 'openapi-k6/.env'), 'utf8');
    const customScenario = await readFile(path.join(workspace, 'openapi-k6/scenarios/custom.yaml'), 'utf8');
    const generated = await readFile(path.join(workspace, 'openapi-k6/generated/custom.k6.js'), 'utf8');
    const snapshot = await readFile(path.join(workspace, 'openapi-k6/openapi/custom.openapi.json'), 'utf8');
    const log = await readFile(path.join(workspace, 'openapi-k6/logs/smoke.log'), 'utf8');

    expect(config).toContain('baseUrl: https://changed.test.local');
    expect(readme).toContain('# openapi-k6');
    expect(readme).toContain('`update`는 `config.yaml`, `.env`, `scenarios/`, snapshot/catalog 파일, `generated/`, `logs/`를 보존하고 README, runner, `.env.example`, `.gitignore`, `.openapi-k6.json` 같은 scaffold 파일만 최신화합니다.');
    expect(readme).toContain('오래된 scaffold에서 `validate`, `test`, `generate`, `run`을 실행하면 최신 README/runner를 받을 수 있도록 `Scaffold update available` notice와 `npx --yes openapi-k6 update` 명령이 표시됩니다.');
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
    await writeFile(path.join(workspace, 'openapi-k6/config.yaml'), 'baseUrl: https://kept.test.local\nmodules:\n  pharma:\n    openapi: https://kept.test.local/v3/api-docs\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/README.md'), 'stale readme\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/run.sh'), '#!/usr/bin/env bash\necho stale\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/.env.example'), 'OLD=\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/.gitignore'), '.env\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/.env'), 'LOGIN_PASSWORD=local-secret\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'), 'name: kept\nsteps: []\n', 'utf8');
    await rm(path.join(workspace, 'openapi-k6/scenarios/partials'), { recursive: true, force: true });
    await rm(path.join(workspace, 'openapi-k6/scenarios/fixtures'), { recursive: true, force: true });
    await writeFile(path.join(workspace, 'openapi-k6/generated/custom.k6.js'), 'export default function () {}\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/openapi/custom.openapi.json'), '{}\n', 'utf8');
    await mkdir(path.join(workspace, 'openapi-k6/logs'), { recursive: true });
    await writeFile(path.join(workspace, 'openapi-k6/logs/smoke.log'), 'old log\n', 'utf8');
    const output = createCapture();

    await runCli(
      ['update'],
      { cwd: workspace, stdout: output.stream, stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');
    const readme = await readFile(path.join(workspace, 'openapi-k6/README.md'), 'utf8');
    const runScript = await readFile(path.join(workspace, 'openapi-k6/run.sh'), 'utf8');
    const envExample = await readFile(path.join(workspace, 'openapi-k6/.env.example'), 'utf8');
    const gitignore = await readFile(path.join(workspace, 'openapi-k6/.gitignore'), 'utf8');
    const metadata = JSON.parse(
      await readFile(path.join(workspace, 'openapi-k6/.openapi-k6.json'), 'utf8'),
    ) as { scaffoldVersion: string };
    const env = await readFile(path.join(workspace, 'openapi-k6/.env'), 'utf8');
    const scenario = await readFile(path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'), 'utf8');
    const partialExample = await readFile(path.join(workspace, 'openapi-k6/scenarios/partials/login.yaml.example'), 'utf8');
    const dataFixtureExample = await readFile(path.join(workspace, 'openapi-k6/scenarios/fixtures/dev.yaml.example'), 'utf8');
    const generated = await readFile(path.join(workspace, 'openapi-k6/generated/custom.k6.js'), 'utf8');
    const snapshot = await readFile(path.join(workspace, 'openapi-k6/openapi/custom.openapi.json'), 'utf8');
    const log = await readFile(path.join(workspace, 'openapi-k6/logs/smoke.log'), 'utf8');

    expect(output.output()).toContain('Updated openapi-k6 workspace metadata in openapi-k6');
    expect(output.output()).toContain('kept config  openapi-k6/config.yaml');
    expect(output.output()).toContain('partial      openapi-k6/scenarios/partials/login.yaml.example');
    expect(output.output()).toContain('fixture      openapi-k6/scenarios/fixtures/dev.yaml.example');
    expect(output.output()).toContain('kept existing scenarios, snapshots, generated scripts, logs, and .env unchanged');
    expect(config).toBe('baseUrl: https://kept.test.local\nmodules:\n  pharma:\n    openapi: https://kept.test.local/v3/api-docs\n');
    expect(readme).toContain('# openapi-k6');
    expect(readme).toContain('npx --yes openapi-k6 update');
    expect(runScript).toContain('exec k6 run ${K6_ARGS[@]+"${K6_ARGS[@]}"} "$SCRIPT_PATH"');
    expect(envExample).toContain('LOGIN_PASSWORD=');
    expect(gitignore).toBe('*\n!.gitignore\n!.openapi-k6.json\n!scenarios/\n!scenarios/**\n');
    expect(metadata.scaffoldVersion).toBe(CURRENT_SCAFFOLD_VERSION);
    expect(env).toBe('LOGIN_PASSWORD=local-secret\n');
    expect(scenario).toBe('name: kept\nsteps: []\n');
    expect(partialExample).toContain('username: "{{vars.loginId}}"');
    expect(dataFixtureExample).toContain('sku: ABC-001');
    expect(generated).toBe('export default function () {}\n');
    expect(snapshot).toBe('{}\n');
    expect(log).toBe('old log\n');
  });

  it('migrates the legacy default load-tests workspace on update', async () => {
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await writeFile(
      path.join(workspace, 'load-tests/config.yaml'),
      [
        'baseUrl: https://legacy.test.local',
        'modules:',
        '  default:',
        '    openapi: https://legacy.test.local/v3/api-docs',
        '    snapshot: openapi/default.openapi.json',
        '    catalog: openapi/default.catalog.json',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(path.join(workspace, 'load-tests/scenarios/smoke.yaml'), 'name: kept\nsteps: []\n', 'utf8');
    await writeFile(path.join(workspace, 'load-tests/.env'), 'LOGIN_PASSWORD=legacy-secret\n', 'utf8');
    const output = createCapture();

    await runCli(
      ['update'],
      { cwd: workspace, stdout: output.stream, stderr: createSink() },
    );

    expect(output.output()).toContain('Moved load-tests to openapi-k6');
    expect(output.output()).toContain('Updated openapi-k6 workspace metadata in openapi-k6');
    await expect(stat(path.join(workspace, 'openapi-k6/config.yaml'))).resolves.toBeTruthy();
    await expect(stat(path.join(workspace, 'load-tests'))).rejects.toHaveProperty('code', 'ENOENT');

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');
    const readme = await readFile(path.join(workspace, 'openapi-k6/README.md'), 'utf8');
    const scenario = await readFile(path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'), 'utf8');
    const env = await readFile(path.join(workspace, 'openapi-k6/.env'), 'utf8');

    expect(config).toContain('baseUrl: https://legacy.test.local');
    expect(readme).toContain('# openapi-k6');
    expect(scenario).toBe('name: kept\nsteps: []\n');
    expect(env).toBe('LOGIN_PASSWORD=legacy-secret\n');
  });

  it('checks workspace health with doctor', async () => {
    await runCli(
      [
        'init',
        '--module',
        'app',
        '--base-url',
        'https://api.test.local',
        '--openapi',
        'https://api.test.local/v3/api-docs',
        '--no-input',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await writeFile(path.join(workspace, 'openapi-k6/openapi/app.openapi.json'), '{}\n', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/openapi/app.catalog.json'), '{}\n', 'utf8');

    const binDir = path.join(workspace, 'bin');
    await writeFakeK6(binDir, ['echo "k6 v0.49.0"']);

    const stdout = createCapture();
    await runCli(
      ['doctor'],
      {
        cwd: workspace,
        stdout: stdout.stream,
        stderr: createSink(),
        env: { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` },
      },
    );

    expect(stdout.output()).toContain('Doctor openapi-k6/config.yaml');
    expect(stdout.output()).toContain('config: openapi-k6/config.yaml loaded');
    expect(stdout.output()).toContain('modules.app.snapshot: openapi-k6/openapi/app.openapi.json');
    expect(stdout.output()).toContain('modules.app.catalog: openapi-k6/openapi/app.catalog.json');
    expect(stdout.output()).toContain('scaffold: openapi-k6/.openapi-k6.json is current');
    expect(stdout.output()).toContain('k6: k6 v0.49.0');
  });

  it('serves a local UI for listing scenarios and streaming validate output', async () => {
    await writeRunFixtures();
    await mkdir(path.join(workspace, 'openapi-k6/scenarios/partials'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/partials/login.yaml'),
      'steps:\n  - id: login\n    api:\n      operationId: getHealth\n',
      'utf8',
    );
    const reportedScenarios: string[] = [];

    const ui = await runUiCommand(
      { port: '0' },
      {
        cwd: workspace,
        stdout: createSink(),
        stderr: createSink(),
        env: {},
        fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200, statusText: 'OK' }),
        testReporter: {
          onScenarioEnd(result) {
            reportedScenarios.push(result.scenario);
          },
        },
      },
    );

    try {
      const html = await (await fetch(ui.url)).text();
      const scenarios = await (await fetch(`${ui.url}/api/scenarios`)).json() as {
        defaultModule?: string;
        moduleCount: number;
        scenarios: Array<{ id: string; name: string; path: string; stepCount?: number }>;
      };
      const detail = await (await fetch(`${ui.url}/api/scenario?scenario=smoke`)).json() as {
        name: string;
        steps: Array<{ id: string; operationId?: string }>;
      };
      const run = await (await fetch(`${ui.url}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'validate', scenario: 'smoke' }),
      })).json() as { runId: string };
      const events = await (await fetch(`${ui.url}/api/runs/${run.runId}/events`)).text();
      const testRun = await (await fetch(`${ui.url}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'test', scenario: 'smoke' }),
      })).json() as { runId: string };
      const testEvents = await (await fetch(`${ui.url}/api/runs/${testRun.runId}/events`)).text();

      expect(html).toContain('openapi-k6 UI');
      expect(html).toContain('ansi-green');
      expect(html).toContain('.scenario-item-head');
      expect(html).toContain('text-overflow: ellipsis');
      expect(scenarios.defaultModule).toBe('app');
      expect(scenarios.moduleCount).toBe(1);
      expect(scenarios.scenarios).toEqual([
        expect.objectContaining({ id: 'smoke', name: 'smoke', stepCount: 1 }),
      ]);
      expect(scenarios.scenarios.some((scenario) => scenario.path.includes('partials/login.yaml'))).toBe(false);
      expect(detail).toMatchObject({
        name: 'smoke',
        steps: [expect.objectContaining({ id: 'health', operationId: 'getHealth' })],
      });
      expect(events).toContain('$ openapi-k6 validate');
      expect(events).toContain('Validated openapi-k6/scenarios/smoke.yaml');
      expect(events).toContain('"status":"passed"');
      expect(testEvents).toContain('$ openapi-k6 test');
      expect(testEvents).not.toContain('--no-color');
      expect(testEvents).toContain('\\u001b[32m');
      expect(testEvents).toContain('<span class=\\"ansi-green\\">');
      expect(testEvents).toContain('"status":"passed"');
      expect(reportedScenarios).toEqual(['smoke']);
    } finally {
      await ui.close();
    }
  });

  it('checks configured module base URLs from the UI server', async () => {
    await writeRunFixtures();
    const targetServer = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    await listenTestServer(targetServer);
    const targetAddress = targetServer.address() as AddressInfo;
    const targetBaseUrl = `http://127.0.0.1:${targetAddress.port}`;
    await writeConfig([
      `baseUrl: ${targetBaseUrl}`,
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/app.openapi.yaml',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    const ui = await runUiCommand(
      { port: '0' },
      {
        cwd: workspace,
        stdout: createSink(),
        stderr: createSink(),
        env: { BASE_URL: undefined, BASE_URL_APP: undefined },
      },
    );

    try {
      const result = await (await fetch(`${ui.url}/api/check-servers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })).json() as {
        modules: Array<{
          name: string;
          baseUrl?: string;
          status: string;
          httpStatus?: number;
          source?: string;
          snapshot?: { path?: string; status: string; error?: string };
        }>;
      };

      expect(result.modules).toEqual([
        expect.objectContaining({
          name: 'app',
          baseUrl: targetBaseUrl,
          source: 'baseUrl',
          status: 'reachable',
          httpStatus: 404,
          snapshot: expect.objectContaining({
            path: 'openapi-k6/openapi/app.openapi.yaml',
            status: 'present',
          }),
        }),
      ]);
    } finally {
      await ui.close();
      await closeTestServer(targetServer);
    }
  });

  it('surfaces UI readiness problems with actionable validation hints', async () => {
    await writeRunFixtures();
    await writeConfig([
      'baseUrl: http://127.0.0.1:8080',
      'defaultModule: app',
      'modules:',
      '  app:',
      '    snapshot: openapi/missing.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    const ui = await runUiCommand(
      { port: '0' },
      {
        cwd: workspace,
        stdout: createSink(),
        stderr: createSink(),
        env: { BASE_URL: '/', BASE_URL_APP: undefined },
      },
    );

    try {
      const serverStatus = await (await fetch(`${ui.url}/api/check-servers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })).json() as {
        modules: Array<{ status: string; source?: string; error?: string; snapshot?: { status: string; error?: string } }>;
      };
      const run = await (await fetch(`${ui.url}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'validate', scenario: 'smoke' }),
      })).json() as { runId: string };
      const events = await (await fetch(`${ui.url}/api/runs/${run.runId}/events`)).text();

      expect(serverStatus.modules[0]).toEqual(expect.objectContaining({
        status: 'failed',
        source: 'BASE_URL',
        error: expect.stringContaining('Invalid URL'),
        snapshot: expect.objectContaining({
          status: 'missing',
          error: 'run openapi-k6 sync',
        }),
      }));
      expect(events).toContain('Error opening file');
      expect(events).toContain('Next: OpenAPI snapshot이 없습니다. 먼저 openapi-k6 sync를 실행하세요.');
      expect(events).toContain('"status":"failed"');
    } finally {
      await ui.close();
    }
  });

  it('reports doctor failures as JSON', async () => {
    await writeConfig([
      'defaultModule: bos-api',
      'modules:',
      '  bos-api:',
      '    snapshot: openapi/bos-api.openapi.json',
      '    catalog: openapi/bos-api.catalog.json',
      '  bos_api:',
      '    snapshot: TODO',
      '    catalog: openapi/bos_api.catalog.json',
      '',
    ]);

    const stdout = createCapture();
    await expect(
      runCli(
        ['doctor', '--json'],
        {
          cwd: workspace,
          stdout: stdout.stream,
          stderr: createSink(),
          env: { PATH: '' },
        },
      ),
    ).rejects.toThrow('Doctor checks failed');

    const output = JSON.parse(stdout.output()) as {
      passed: boolean;
      checks: Array<{ name: string; status: string; message: string }>;
    };

    expect(output.passed).toBe(false);
    expect(output.checks).toContainEqual(expect.objectContaining({
      name: 'module-env',
      status: 'fail',
      message: 'modules "bos-api", "bos_api" all map to BASE_URL_BOS_API',
    }));
    expect(output.checks).toContainEqual(expect.objectContaining({
      name: 'modules.bos-api.snapshot',
      status: 'fail',
      message: expect.stringContaining('openapi-k6/openapi/bos-api.openapi.json was not found'),
    }));
    expect(output.checks).toContainEqual(expect.objectContaining({
      name: 'modules.bos_api.snapshot',
      status: 'fail',
      message: 'modules.bos_api.snapshot is not configured',
    }));
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
      path.join(workspace, 'openapi-k6/config.yaml'),
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

    const readme = await readFile(path.join(workspace, 'openapi-k6/README.md'), 'utf8');

    expect(readme).toContain('npx --yes openapi-k6 sync --module vendor');
    expect(readme).toContain('npx --yes openapi-k6 test --module vendor -s <name>');
    expect(readme).not.toContain('npx --yes openapi-k6 test --module vendor -s smoke');
    expect(readme).toContain('npx --yes openapi-k6 generate --module vendor -s <name>');
    expect(readme).toContain('npx --yes openapi-k6 update --module vendor');
    expect(readme).toContain('openapi-k6/snapshots/vendor.snapshot.json');
    expect(readme).toContain('openapi-k6/catalogs/vendor.catalog.json');
    expect(readme).not.toContain('openapi/vendor.openapi.json');
    expect(readme).not.toContain('openapi/vendor.catalog.json');
    expect(readme).not.toContain('openapi-k6/openapi/vendor.openapi.json');
    expect(readme).not.toContain('openapi-k6/openapi/vendor.catalog.json');
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
    ).rejects.toThrow('openapi-k6/config.yaml was not found. Run openapi-k6 init or pass --config.');
  });

  it('uses a default generated output path when --write is omitted', async () => {
    await writeGenerateFixtures(workspace);

    await runCli(
      ['generate', '--scenario', 'scenario.yaml', '--openapi', 'openapi.yaml'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const output = await readFile(path.join(workspace, 'openapi-k6/generated/scenario.k6.js'), 'utf8');

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

  it('validates scenarios before writing generated k6 output', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
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

    await expect(
      runCli(
        ['generate', '-s', 'smoke'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow([
      'Scenario validation failed:',
      '  - step "create-order": request.body or request.multipart is required by POST /orders',
    ].join('\n'));

    await expect(stat(path.join(workspace, 'openapi-k6/generated/smoke.k6.js'))).rejects.toThrow();
  });

  it('preserves existing generated k6 output when generate validation fails', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/generated'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
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
    const outputPath = path.join(workspace, 'openapi-k6/generated/smoke.k6.js');
    const existingOutput = 'export default function () { console.log("keep me"); }\n';
    await writeFile(outputPath, existingOutput, 'utf8');

    await expect(
      runCli(
        ['generate', '-s', 'smoke'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow([
      'Scenario validation failed:',
      '  - step "create-order": request.body or request.multipart is required by POST /orders',
    ].join('\n'));

    await expect(readFile(outputPath, 'utf8')).resolves.toBe(existingOutput);
  });

  it('prints validation warnings when generating k6 output', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: get-order',
        '    api:',
        '      operationId: getOrder',
        '    request:',
        '      pathParams:',
        '        orderId: order-1',
        '        id: unused',
        '      query:',
        '        includeItems: true',
        '      headers:',
        '        X-Tenant: main',
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
      ['generate', '-s', 'smoke'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const output = stdout.output();
    expect(output).toContain('Warnings:');
    expect(output).toContain('  - step "get-order": request.pathParams.id is not used by path /orders/{orderId}');
    expect(output).toContain(`Generated ${path.join(workspace, 'openapi-k6/generated/smoke.k6.js')}`);
    await expect(stat(path.join(workspace, 'openapi-k6/generated/smoke.k6.js'))).resolves.toBeTruthy();
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
        'openapi-k6/config.yaml',
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
        'openapi-k6/config.yaml',
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
        'openapi-k6/openapi/dev.openapi.json',
        '--catalog',
        'openapi-k6/openapi/catalog.json',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const snapshot = JSON.parse(
      await readFile(path.join(workspace, 'openapi-k6/openapi/dev.openapi.json'), 'utf8'),
    ) as Record<string, unknown>;
    const catalog = JSON.parse(
      await readFile(path.join(workspace, 'openapi-k6/openapi/catalog.json'), 'utf8'),
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

  it('prints next steps after configured sync', async () => {
    await writeGenerateFixtures(workspace);
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: ../openapi.yaml',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    const stdout = createCapture();

    await runCli(
      ['sync'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const output = stdout.output();

    expect(output).toContain('Synced ');
    expect(output).toContain('Catalog ');
    expect(output).toContain('Next');
    expect(output).toContain('npx --yes openapi-k6 catalog --query <검색어> --ai --module app');
    expect(output).toContain('npx --yes openapi-k6 validate -s <scenario-name> --module app');
    expect(output).toContain('npx --yes openapi-k6 test -s <scenario-name> --module app');
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

    expect(output).toContain('Catalog: openapi-k6/openapi/app.catalog.json');
    expect(output).toContain('Module: app');
    expect(output).toContain('Operations: 4');
    expect(output).toContain('Tags:');
    expect(output).toContain('auth');
    expect(output).toContain('orders');
    expect(output).toContain('Use filters:');
    expect(output).toContain('openapi-k6 catalog --query <query>');
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

  it('prints AI-friendly catalog guidance with scenario step snippets', async () => {
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
      ['catalog', '--query', 'login', '--ai'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const output = stdout.output();

    expect(output).toContain('AI scenario authoring guide');
    expect(output).toContain('Catalog: openapi-k6/openapi/app.catalog.json');
    expect(output).toContain('Module: app');
    expect(output).toContain('Query: login');
    expect(output).toContain('Operations: 1');
    expect(output).toContain('Rules for AI agents:');
    expect(output).toContain('Map path/query/header parameters to request.pathParams/request.query/request.headers.');
    expect(output).toContain('Replace every <...> placeholder before validate/test.');
    expect(output).toContain('Operation 1: loginUser');
    expect(output).toContain('  method: POST');
    expect(output).toContain('  path: /auth/login');
    expect(output).toContain('  body: yes (application/json)');
    expect(output).toContain('  scenario mapping:');
    expect(output).toContain('    request.body: application/json; schema example');
    expect(output).toContain('      fields:');
    expect(output).toContain('        - loginId: string, required, placeholder <loginId>');
    expect(output).toContain('        - password: string, required, env {{env.PASSWORD}}');
    expect(output).toContain('    response extract candidates:');
    expect(output).toContain('      - accessToken <- $.accessToken (200 application/json)');
    expect(output).toContain('        yaml:');
    expect(output).toContain('          extract:');
    expect(output).toContain('            accessToken:');
    expect(output).toContain('              from: $.accessToken');
    expect(output).toContain('        likely next use:');
    expect(output).toContain('          request.headers.Authorization: "Bearer {{accessToken}}"');
    expect(output).toContain('Suggested scenario step:');
    expect(output).toContain('```yaml');
    expect(output).toContain('- id: login-user');
    expect(output).toContain('    module: app');
    expect(output).toContain('    operationId: loginUser');
    expect(output).toContain('    body:');
    expect(output).toContain('      loginId: "<loginId>"');
    expect(output).toContain('      password: "{{env.PASSWORD}}"');
    expect(output).toContain('  condition: status < 300');
    expect(output).toContain('  # extract candidates:');
    expect(output).toContain('  #   accessToken:');
    expect(output).toContain('  #     from: $.accessToken');
    expect(output).toContain('Keep secrets in openapi-k6/.env');
    expect(output).not.toContain('createOrder');
  });

  it('tells AI agents to narrow the search when catalog --ai has multiple matches', async () => {
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
      ['catalog', '--query', 'order', '--ai'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const output = stdout.output();

    expect(output).toContain('Operations: 2');
    expect(output).toContain('Multiple operations matched.');
    expect(output).toContain('Do not pick one arbitrarily.');
    expect(output).toContain('Narrow with a more specific --query, --tag, --method, or operationId keyword.');
    expect(output).toContain('ask which operation to use before writing scenario YAML.');
    expect(output).toContain('Operation 1: getOrder');
    expect(output).toContain('Operation 2: createOrder');
    expect(output).toContain('    request.pathParams:');
    expect(output).toContain('      - orderId (required)');
    expect(output).toContain('    request.headers:');
    expect(output).toContain('      - Idempotency-Key (optional)');
    expect(output).toContain('    request.body: application/json; schema example');
    expect(output).toContain('        - sku: string, required, placeholder <sku>');
    expect(output).toContain('        - quantity: integer, required');
    expect(output).toContain('      - orderId <- $.orderId (201 application/json)');
    expect(output).toContain('          request.pathParams.orderId: "{{orderId}}"');
  });

  it('syncs before printing AI-friendly catalog guidance when --sync is used', async () => {
    await writeGenerateFixtures(workspace);
    await writeConfig([
      'defaultModule: app',
      'modules:',
      '  app:',
      '    openapi: ../openapi.yaml',
      '    snapshot: openapi/app.openapi.json',
      '    catalog: openapi/app.catalog.json',
      '',
    ]);
    await writeCatalog('openapi/app.catalog.json', [
      {
        method: 'GET',
        path: '/stale',
        operationId: 'staleEndpoint',
        tags: ['stale'],
        parameters: [],
        hasRequestBody: false,
      },
    ]);
    const stdout = createCapture();

    await runCli(
      ['catalog', '--sync', '--query', 'health', '--ai'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const output = stdout.output();
    const catalog = JSON.parse(
      await readFile(path.join(workspace, 'openapi-k6/openapi/app.catalog.json'), 'utf8'),
    ) as { operations: Array<Record<string, unknown>> };

    expect(output).toContain('Synced openapi-k6/openapi/app.openapi.json');
    expect(output).toContain('Catalog openapi-k6/openapi/app.catalog.json (1 operations)');
    expect(output).toContain('AI scenario authoring guide');
    expect(output).toContain('Query: health');
    expect(output).toContain('operationId: getHealth');
    expect(output).not.toContain('staleEndpoint');
    expect(catalog.operations).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: '/health',
        operationId: 'getHealth',
      }),
    ]);
  });

  it('prints catalog scenario snippets with request placeholders', async () => {
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
      ['catalog', '--method', 'POST', '--tag', 'orders', '--snippet'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const output = stdout.output();

    expect(output).toContain('# Catalog: openapi-k6/openapi/app.catalog.json');
    expect(output).toContain('# Module: app');
    expect(output).toContain('# POST /orders');
    expect(output).toContain('- id: create-order');
    expect(output).toContain('    module: app');
    expect(output).toContain('    operationId: createOrder');
    expect(output).toContain('  request:');
    expect(output).toContain('    headers:');
    expect(output).toContain('      "Idempotency-Key": "<Idempotency-Key>" # optional');
    expect(output).toContain('    body:');
    expect(output).toContain('      sku: "<sku>"');
    expect(output).toContain('      quantity: 0');
    expect(output).toContain('  condition: status < 300');
    expect(output).toContain('  # extract candidates:');
    expect(output).toContain('  #   orderId:');
    expect(output).toContain('  #     from: $.orderId');
    expect(output).not.toContain('loginUser');
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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

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
    expect(addOutput.output()).toContain('Module auth saved in openapi-k6/config.yaml');
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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');
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
    expect(output).toContain('Module auth saved in openapi-k6/config.yaml');
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
    const before = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

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

    const after = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

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
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/auth.yaml'),
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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');
    const snapshot = await readFile(path.join(workspace, 'openapi-k6/openapi/auth.openapi.json'), 'utf8');
    const catalog = await readFile(path.join(workspace, 'openapi-k6/openapi/auth.catalog.json'), 'utf8');

    expect(config).toContain('defaultModule: auth');
    expect(config).toContain('    # sync가 읽을 OpenAPI URL 또는 파일 경로입니다.');
    expect(config).toContain('    openapi: ../openapi.yaml');
    expect(config).toContain('    # generate 입력은 catalog가 아니라 snapshot입니다.');
    expect(snapshot).toContain('"operationId": "getHealth"');
    expect(catalog).toContain('"operationId": "getHealth"');
    expect(stdout.output()).toContain('Synced openapi-k6/openapi/auth.openapi.json');
    expect(stdout.output()).toContain('Catalog openapi-k6/openapi/auth.catalog.json (1 operations)');
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
    const before = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

    await expect(
      runCli(
        ['module', 'add', 'auth', '--openapi', 'missing-openapi.yaml', '--sync'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('missing-openapi.yaml');

    const after = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

    expect(after).toBe(before);
    await expect(
      stat(path.join(workspace, 'openapi-k6/openapi/auth.openapi.json')),
    ).rejects.toThrow();
  });

  it('explains that config is required for module management commands', async () => {
    await expect(
      runCli(
        ['module', 'list'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('openapi-k6/config.yaml was not found. Run openapi-k6 init or pass --config.');

    await expect(
      runCli(
        ['module', 'add', 'auth', '--openapi', 'openapi.yaml'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('openapi-k6/config.yaml was not found. Run openapi-k6 init or pass --config.');
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await writeFile(path.join(workspace, 'openapi-k6/openapi/vendor.openapi.json'), '{}', 'utf8');
    await writeFile(path.join(workspace, 'openapi-k6/openapi/vendor.catalog.json'), '{}', 'utf8');
    const stdout = createCapture();

    await runCli(
      ['module', 'remove', 'vendor'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

    expect(stdout.output()).toContain('Module vendor removed from openapi-k6/config.yaml');
    expect(config).toContain('defaultModule: app');
    expect(config).not.toContain('  vendor:');
    await expect(stat(path.join(workspace, 'openapi-k6/openapi/vendor.openapi.json'))).resolves.toBeTruthy();
    await expect(stat(path.join(workspace, 'openapi-k6/openapi/vendor.catalog.json'))).resolves.toBeTruthy();
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
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/cross.yaml'),
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

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');

    expect(stdout.output()).toContain('Forced removal; scenario references still exist:');
    expect(stdout.output()).toContain('openapi-k6/scenarios/cross.yaml step "create-order"');
    expect(config).not.toContain('  bos:');
  });

  it('reports implicit default module references when removing the default module', async () => {
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
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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

    const stdout = createCapture();
    await runCli(
      ['module', 'remove', 'app', '--force'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    expect(stdout.output()).toContain('Module app removed from openapi-k6/config.yaml');
    expect(stdout.output()).toContain('default   bos');
    expect(stdout.output()).toContain('Forced removal; scenario references still exist:');
    expect(stdout.output()).toContain('openapi-k6/scenarios/smoke.yaml step "health"');
  });

  it('ignores scenario partial and fixture helper files when removing modules', async () => {
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
    await mkdir(path.join(workspace, 'openapi-k6/scenarios/partials'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios/fixtures'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/partials/login.yaml'),
      [
        'steps:',
        '  - id: login',
        '    api:',
        '      operationId: loginUser',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/fixtures/dev.yaml'),
      [
        'loginId: tester@example.com',
        '',
      ].join('\n'),
      'utf8',
    );

    await runCli(
      ['module', 'remove', 'bos'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const config = await readFile(path.join(workspace, 'openapi-k6/config.yaml'), 'utf8');
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
      `${path.join(workspace, 'openapi-k6/openapi/app.catalog.json')} was not found.`,
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
      `${path.join(workspace, 'openapi-k6/openapi/app.catalog.json')} was not found.`,
      '',
      'Configure OpenAPI source first:',
      `  ${path.join(workspace, 'openapi-k6/config.yaml')}`,
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
      `  ${path.join(workspace, 'openapi-k6/config.yaml')}`,
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
      `  ${path.join(workspace, 'openapi-k6/config.yaml')}`,
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
      `  ${path.join(workspace, 'openapi-k6/config.yaml')}`,
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/openapi/app.openapi.yaml'),
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
        'openapi-k6/config.yaml',
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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

    const output = await readFile(path.join(workspace, 'openapi-k6/generated/smoke.k6.js'), 'utf8');

    expect(output).toContain('const BASE_URL = __ENV.BASE_URL || "https://config-base.test.local";');
    expect(output).toContain('const url0 = joinUrl(BASE_URL, `/app-health`);');
  });

  it('validates a scenario by name using the configured OpenAPI snapshot', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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

    expect(stdout.output()).toContain('Validated openapi-k6/scenarios/smoke.yaml');
    expect(stdout.output()).toContain('  openapi  openapi-k6/openapi/app.openapi.yaml');
    expect(stdout.output()).toContain('  module   app');
    expect(stdout.output()).toContain('  scenario smoke');
    expect(stdout.output()).toContain('  steps    3');
    expect(stdout.output()).not.toContain('Warnings:');
    expect(stdout.output()).toContain('Scaffold update available:');
    expect(stdout.output()).toContain('openapi-k6/.openapi-k6.json was not found.');
    expect(stdout.output()).toContain('  command  npx --yes openapi-k6 update');
    expect(stdout.output()).toContain('  keeps    config, scenarios, .env, snapshots, generated scripts, and logs unchanged');
  });

  it('validates and generates scenarios with included reusable steps', async () => {
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios/partials'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/openapi/app.openapi.yaml'),
      [
        'openapi: 3.0.3',
        'info:',
        '  title: App API',
        '  version: 1.0.0',
        'servers:',
        '  - url: https://openapi-fallback.test.local',
        'paths:',
        '  /login:',
        '    post:',
        '      operationId: loginUser',
        '      requestBody:',
        '        required: true',
        '        content:',
        '          application/json:',
        '            schema:',
        '              type: object',
        '      responses:',
        '        "200":',
        '          description: OK',
        '  /me:',
        '    get:',
        '      operationId: getMe',
        '      parameters:',
        '        - name: Authorization',
        '          in: header',
        '          required: true',
        '          schema:',
        '            type: string',
        '      responses:',
        '        "200":',
        '          description: OK',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/partials/login.yaml'),
      [
        'steps:',
        '  - id: login',
        '    api:',
        '      operationId: loginUser',
        '    request:',
        '      body:',
        '        username: "{{vars.loginId}}"',
        '    extract:',
        '      token:',
        '        from: $.token',
        '',
      ].join('\n'),
      'utf8',
    );
    await mkdir(path.join(workspace, 'openapi-k6/scenarios/fixtures'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/fixtures/dev.yaml'),
      [
        'loginId: tester@example.com',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'fixtures:',
        '  - ./fixtures/dev.yaml',
        'steps:',
        '  - include: ./partials/login.yaml',
        '  - id: get-me',
        '    api:',
        '      operationId: getMe',
        '    request:',
        '      headers:',
        '        Authorization: "Bearer {{token}}"',
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

    expect(stdout.output()).toContain('  steps    2');

    await runCli(
      ['generate', '-s', 'smoke'],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const output = await readFile(path.join(workspace, 'openapi-k6/generated/smoke.k6.js'), 'utf8');

    expect(output).toContain('group("login POST /login", () => {');
    expect(output).toContain('group("get-me GET /me", () => {');
    expect(output).toContain('const VARS = {"loginId":"tester@example.com"};');
    expect(output).toContain('"username": VARS.loginId');
    expect(output).toContain('"Authorization": `Bearer ${context.token}`');
  });

  it('applies CLI var files and inline vars across validate, generate, test, and run', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios/fixtures'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/fixtures/stage.yaml'),
      [
        'sku: FILE-SKU',
        'tenantId: tenant-stage',
        'quantity: 2',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'vars:',
        '  sku: SCENARIO-SKU',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '    request:',
        '      body:',
        '        sku: "{{vars.sku}}"',
        '        tenantId: "{{vars.tenantId}}"',
        '        quantity: "{{vars.quantity}}"',
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

    const overrideArgs = [
      '--var-file',
      'openapi-k6/scenarios/fixtures/stage.yaml',
      '--var',
      'sku=CLI-SKU',
      '--var',
      'quantity=3',
    ];

    await runCli(
      ['validate', '-s', 'smoke', ...overrideArgs],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    await runCli(
      ['generate', '-s', 'smoke', ...overrideArgs],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const generated = await readFile(path.join(workspace, 'openapi-k6/generated/smoke.k6.js'), 'utf8');

    expect(generated).toContain('const VARS = {"sku":"CLI-SKU","tenantId":"tenant-stage","quantity":3};');
    expect(generated).toContain('"sku": VARS.sku');
    expect(generated).toContain('"tenantId": VARS.tenantId');
    expect(generated).toContain('"quantity": VARS.quantity');

    let requestBody: unknown;
    await runCli(
      ['test', '-s', 'smoke', ...overrideArgs, '--no-color'],
      {
        cwd: workspace,
        stdout: createSink(),
        stderr: createSink(),
        env: {},
        fetch: async (_input, init) => {
          requestBody = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ id: 'order-1' }), {
            status: 201,
            statusText: 'Created',
          });
        },
      },
    );

    expect(requestBody).toEqual({
      sku: 'CLI-SKU',
      tenantId: 'tenant-stage',
      quantity: 3,
    });

    const binDir = path.join(workspace, 'bin');
    await writeFakeK6(binDir, ['echo fake-k6-output']);
    await runCli(
      ['run', '-s', 'smoke', ...overrideArgs],
      {
        cwd: workspace,
        stdout: createSink(),
        stderr: createSink(),
        env: {
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
        },
      },
    );

    const runGenerated = await readFile(path.join(workspace, 'openapi-k6/generated/smoke.k6.js'), 'utf8');

    expect(runGenerated).toContain('const VARS = {"sku":"CLI-SKU","tenantId":"tenant-stage","quantity":3};');
  });

  it('fails clearly for invalid CLI scenario var overrides', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '    request:',
        '      body:',
        '        sku: "{{vars.sku}}"',
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

    await expect(
      runCli(
        ['validate', '-s', 'smoke', '--var', 'bad-name=SKU-1'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('--var must match ^[A-Za-z_$][A-Za-z0-9_$]*$ for {{vars.NAME}} references');

    await expect(
      runCli(
        ['validate', '-s', 'smoke', '--var-file', 'openapi-k6/scenarios/fixtures/missing.yaml'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('var file was not found');
  });

  it('reports scenario validation issues before running API requests', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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

  it('validates a scenario before test calls the API', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: get-order',
        '    api:',
        '      operationId: getOrder',
        '    request:',
        '      pathParams:',
        '        orderId: []',
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
    let fetchCalled = false;

    await expect(
      runCli(
        ['test', '-s', 'smoke'],
        {
          cwd: workspace,
          stdout: createSink(),
          stderr: createSink(),
          env: {},
          fetch: async () => {
            fetchCalled = true;
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          },
        },
      ),
    ).rejects.toThrow([
      'Scenario validation failed:',
      '  - step "get-order": missing request.pathParams.orderId for path /orders/{orderId}',
      '  - step "get-order": missing request.query.includeItems required by GET /orders/{orderId}',
      '  - step "get-order": missing request.headers.X-Tenant required by GET /orders/{orderId}',
    ].join('\n'));

    expect(fetchCalled).toBe(false);
  });

  it('reports missing required request body fields with fix hints', async () => {
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/openapi/app.openapi.yaml'),
      [
        'openapi: 3.0.3',
        'info:',
        '  title: App API',
        '  version: 1.0.0',
        'paths:',
        '  /orders:',
        '    post:',
        '      operationId: createOrder',
        '      requestBody:',
        '        required: true',
        '        content:',
        '          application/json:',
        '            schema:',
        '              type: object',
        '              required:',
        '                - sku',
        '                - quantity',
        '              properties:',
        '                sku:',
        '                  type: string',
        '                quantity:',
        '                  type: integer',
        '      responses:',
        '        "201":',
        '          description: Created',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '    request:',
        '      body:',
        '        sku: ABC-001',
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
      '  - step "create-order": missing request.body.quantity required by POST /orders',
      '',
      'Fix hints:',
      '  - Add the missing required request.body fields; inspect body fields with openapi-k6 catalog --query <keyword> --ai.',
    ].join('\n'));
  });

  it('reports invalid or unavailable context template references during validation', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'vars:',
        '  knownSku: ABC-001',
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
        '        sku: "{{vars.knownSku}}"',
        '        missingSku: "{{vars.missingSku}}"',
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
      '  - step "typo-reference": request.body.missingSku references unknown vars.missingSku',
      '  - step "same-step-reference": request.pathParams.orderId references unknown context.selfId',
      '  - step "future-reference": request.body.id references unknown context.futureId',
      '  - step "future-reference": request.body.items[0].id references unknown context.missingItemId',
      '  - step "upload-metadata": request.multipart.files.attachment.filename references unknown context.missingFilename',
      '  - step "invalid-template": request.body.id has invalid template: Invalid template string: Bearer {{bad-name}}',
    ].join('\n'));
  });

  it('fails validation when AI placeholder values remain in the scenario', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
      [
        'name: smoke',
        'vars:',
        "  loginId: '<loginId>'",
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '    request:',
        '      body:',
        "        sku: '<sku>'",
        '        password: "{{env.PASSWORD}}"',
        '        nested:',
        "          itemId: '<itemId>'",
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
      '  - scenario: vars.loginId still contains placeholder "<loginId>"',
      '  - step "create-order": request.body.sku still contains placeholder "<sku>"',
      '  - step "create-order": request.body.nested.itemId still contains placeholder "<itemId>"',
      '',
      'Fix hints:',
      '  - Replace every <...> placeholder with a real value, {{env.NAME}}, {{vars.NAME}}, or an earlier extract before validate/test.',
    ].join('\n'));
  });

  it('warns about unused scenario path parameters during validation', async () => {
    await writeValidationOpenApi(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
      `  ${path.join(workspace, 'openapi-k6/config.yaml')}`,
      '',
      'Set:',
      '  modules.app.snapshot',
      '',
      'After editing:',
      '  rerun the command',
    ].join('\n'));
  });

  it('returns a failing command when scenario test conditions fail', async () => {
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://openapi-fallback.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
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
        'openapi-k6/config.yaml',
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('auth.openapi.yaml', '/auth-health', 'https://auth-openapi.test.local');
    await writeModuleOpenApi('bos-api.openapi.yaml', '/bos-health', 'https://bos-openapi.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/cross.yaml'),
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
      ['validate', '--config', 'openapi-k6/config.yaml', '--scenario', 'cross'],
      { cwd: workspace, stdout: stdout.stream, stderr: createSink() },
    );

    expect(stdout.output()).toContain('  modules  auth, bos-api');
    expect(stdout.output()).toContain('    auth  openapi-k6/openapi/auth.openapi.yaml');
    expect(stdout.output()).toContain('    bos-api  openapi-k6/openapi/bos-api.openapi.yaml');

    await runCli(
      [
        'generate',
        '--config',
        'openapi-k6/config.yaml',
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('auth.openapi.yaml', '/auth-health', 'https://auth-openapi.test.local');
    await writeModuleOpenApi('bos.openapi.yaml', '/bos-health', 'https://bos-openapi.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/cross.yaml'),
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
      ['test', '--config', 'openapi-k6/config.yaml', '--scenario', 'cross', '--no-color'],
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('bos-api.openapi.yaml', '/dash-health', 'https://dash-openapi.test.local');
    await writeModuleOpenApi('bos_api.openapi.yaml', '/underscore-health', 'https://underscore-openapi.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/cross.yaml'),
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
        ['test', '--config', 'openapi-k6/config.yaml', '--scenario', 'cross', '--no-color'],
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
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/cross.yaml'),
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
        ['validate', '--config', 'openapi-k6/config.yaml', '--scenario', 'cross'],
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
        ['validate', '--config', 'openapi-k6/config.yaml', '--scenario', 'cross'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('step "auth-health": modules.auth.snapshot is not configured.');
  });

  it('fails clearly when config module is unknown', async () => {
    await writeGenerateFixtures(workspace);
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
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
          'openapi-k6/config.yaml',
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
    const catalogPath = path.join(workspace, 'openapi-k6', configRelativePath);
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
        requestBodyHint: {
          contentType: 'application/json',
          source: 'schema',
          example: {
            sku: '<sku>',
            quantity: 0,
          },
          fields: [
            {
              path: 'sku',
              type: 'string',
              required: true,
              placeholder: '<sku>',
            },
            {
              path: 'quantity',
              type: 'integer',
              required: true,
            },
          ],
        },
        responseExtractCandidates: [
          {
            name: 'orderId',
            from: '$.orderId',
            status: '201',
            contentType: 'application/json',
          },
        ],
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
        requestBodyHint: {
          contentType: 'application/json',
          source: 'schema',
          example: {
            loginId: '<loginId>',
            password: '{{env.PASSWORD}}',
          },
          fields: [
            {
              path: 'loginId',
              type: 'string',
              required: true,
              placeholder: '<loginId>',
            },
            {
              path: 'password',
              type: 'string',
              required: true,
              env: '{{env.PASSWORD}}',
            },
          ],
        },
        responseExtractCandidates: [
          {
            name: 'accessToken',
            from: '$.accessToken',
            status: '200',
            contentType: 'application/json',
          },
        ],
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
    await mkdir(path.join(workspace, 'openapi-k6/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'openapi-k6/scenarios'), { recursive: true });
    await writeModuleOpenApi('app.openapi.yaml', '/app-health', 'https://app-openapi.test.local');
    await writeFile(
      path.join(workspace, 'openapi-k6/scenarios/smoke.yaml'),
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
    await mkdir(path.join(workspace, 'openapi-k6'), { recursive: true });
    await writeFile(path.join(workspace, 'openapi-k6/config.yaml'), lines.join('\n'), 'utf8');
  }

  async function writeModuleOpenApi(
    fileName: string,
    endpointPath: string,
    serverUrl: string,
  ): Promise<void> {
    await writeFile(
      path.join(workspace, 'openapi-k6/openapi', fileName),
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
