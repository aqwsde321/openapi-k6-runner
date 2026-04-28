import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    expect(output).toContain('const res0 = http.get(url0);');
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
      '# Copy this file to .env and fill local secret values.',
      '# k6 does not auto-load .env files. Export these variables before running k6.',
      '',
      '# Add or rename variables to match {{env.NAME}} templates in scenario YAML.',
      'LOGIN_ID=',
      'LOGIN_PASSWORD=',
      '',
    ].join('\n'));
    expect(gitignore).toBe('.env\n');
    expect(scenario).toContain('path: /__dev/error-codes');
    expect(readme).toContain('openapi-k6 sync');
    expect(readme).toContain('openapi-k6 generate \\');
    expect(readme).toContain('  -s smoke');
    expect(readme).toContain('## 0. openapi-k6 명령 준비');
    expect(readme).toContain('사람이 꼭 이해해야 하는 내용은 이 README 앞부분에 있습니다.');
    expect(readme).toContain('## 사람이 꼭 알아야 하는 것');
    expect(readme).toContain('직접 수정하는 파일은 `config.yaml`, `.env`, `scenarios/*.yaml`입니다.');
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
    expect(readme).toContain('pnpm run build:watch');
    expect(readme).toContain('개발 중 수동 빌드가 번거로우면 generator 저장소의 별도 터미널에서 watch 빌드를 켜둡니다.');
    expect(readme).toContain('이 폴더는 백엔드 프로젝트 안에서 OpenAPI snapshot, scenario YAML, 생성된 k6 스크립트를 관리합니다.');
    expect(readme).toContain('## 1. 최소 설정');
    expect(readme).toContain('## 2. 기본 실행 흐름');
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
    expect(readme).toContain('비밀 값을 채우고 실행 전에 export합니다.');
    expect(readme).toContain('source load-tests/.env');
    expect(readme).toContain('Read `openapi/*.catalog.json` and inspect `operationId`, `method`, `path`, `parameters`, and `hasRequestBody`');
    expect(readme).toContain('rm -rf load-tests');
    expect(readme).toContain('필요한 scenario, snapshot, catalog가 있으면 먼저 백업합니다.');
    expect(readme).toContain('## AI Work Guide');
    expect(readme).toContain('This section is for AI agents. Human users only need the Korean sections above unless they want implementation details.');
    expect(readme).toContain('### Workflow');
    expect(readme).toContain('Update or create `scenarios/*.yaml`.');
    expect(readme).toContain('Do not edit `generated/*.k6.js` directly. Edit scenario YAML and regenerate.');
    expect(readme).toContain('Keep human-facing documentation in Korean.');
    expect(readme).toContain('Do not write secrets such as passwords directly in YAML. Use `{{env.NAME}}`.');
    expect(readme).toContain('Store real secret values in `.env` and do not commit it.');
    expect(readme).toContain('Resolve config-relative paths from the directory containing `config.yaml`.');
    expect(readme).toContain('### Files to inspect');
    expect(readme).toContain('### Prompt Examples');
    expect(readme).toContain('Basic smoke test:');
    expect(readme).toContain('Read load-tests/README.md first and follow it.');
    expect(readme).toContain('Create load-tests/scenarios/basic-read.yaml.');
    expect(readme).toContain('Find the login API and a user-profile/read API.');
    expect(readme.indexOf('## AI Work Guide')).toBeGreaterThan(readme.indexOf('## 5. 제거 방법'));
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
    expect(readme).toContain('k6 run perf-tests/generated/smoke.k6.js');
    expect(readme).toContain('BASE_URL=https://api.example.com k6 run perf-tests/generated/smoke.k6.js');
    expect(readme).toContain('source perf-tests/.env');
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
    expect(readme).toContain("k6 run 'perf tests/generated/smoke.k6.js'");
    expect(readme).toContain("source 'perf tests/.env'");
  });

  it('does not overwrite scaffold files unless --force is provided', async () => {
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

    expect(config).toContain('baseUrl: https://changed.test.local');
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

    expect(output).toContain('const res0 = http.get(url0);');
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
