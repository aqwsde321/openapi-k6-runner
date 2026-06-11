import { spawn } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');

async function main() {
  await assertBuiltCliExists();

  const workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-e2e-'));
  let fixture;

  try {
    fixture = await startFixtureBackends();
    const projectDir = path.join(workspace, 'backend-project');
    const k6ArgsLogPath = path.join(workspace, 'k6-args.txt');
    const k6EnvLogPath = path.join(workspace, 'k6-env.txt');
    const env = await createSmokeEnv(path.join(workspace, 'bin'), {
      k6ArgsLogPath,
      k6EnvLogPath,
    });

    await runMultiModuleFlow(projectDir, fixture, env, {
      k6ArgsLogPath,
      k6EnvLogPath,
    });

    console.log([
      'Local backend E2E smoke passed for',
      `seed=${fixture.seedBaseUrl},`,
      `auth=${fixture.authBaseUrl},`,
      `bos=${fixture.bosBaseUrl}.`,
    ].join(' '));
  } finally {
    if (fixture !== undefined) {
      await fixture.close();
    }

    await rm(workspace, { recursive: true, force: true });
  }
}

async function assertBuiltCliExists() {
  try {
    await access(cliPath);
  } catch {
    throw new Error('dist/cli/index.js was not found. Run pnpm run build before this smoke test.');
  }
}

async function createSmokeEnv(binDir, options) {
  await writeFakeK6(binDir);
  const env = { ...process.env };

  for (const name of [
    'BASE_URL',
    'BASE_URL_AUTH',
    'BASE_URL_BOS',
    'BASE_URL_SEED',
    'OPENAPI_K6_TRACE',
    'K6_WEB_DASHBOARD',
    'K6_WEB_DASHBOARD_OPEN',
    'K6_WEB_DASHBOARD_EXPORT',
    'K6_WEB_DASHBOARD_PERIOD',
    'SMOKE_SKU',
  ]) {
    delete env[name];
  }

  return {
    ...env,
    OPENAPI_K6_SMOKE_K6_ARGS_LOG: options.k6ArgsLogPath,
    OPENAPI_K6_SMOKE_K6_ENV_LOG: options.k6EnvLogPath,
    PATH: [binDir, env.PATH ?? ''].filter((value) => value !== '').join(path.delimiter),
  };
}

async function writeFakeK6(binDir) {
  await mkdir(binDir, { recursive: true });

  const fakeK6ScriptPath = path.join(binDir, 'fake-k6.mjs');
  await writeFile(
    fakeK6ScriptPath,
    [
      "import { mkdir, writeFile } from 'node:fs/promises';",
      "import path from 'node:path';",
      '',
      'const args = process.argv.slice(2);',
      'await writeFile(process.env.OPENAPI_K6_SMOKE_K6_ARGS_LOG, `${args.join(\'\\n\')}\\n`, \'utf8\');',
      'await writeFile(',
      '  process.env.OPENAPI_K6_SMOKE_K6_ENV_LOG,',
      '  [',
      "    `OPENAPI_K6_TRACE=${process.env.OPENAPI_K6_TRACE ?? ''}`,",
      "    `K6_WEB_DASHBOARD=${process.env.K6_WEB_DASHBOARD ?? ''}`,",
      "    `K6_WEB_DASHBOARD_OPEN=${process.env.K6_WEB_DASHBOARD_OPEN ?? ''}`,",
      "    `K6_WEB_DASHBOARD_EXPORT=${process.env.K6_WEB_DASHBOARD_EXPORT ?? ''}`,",
      "    `SMOKE_SKU=${process.env.SMOKE_SKU ?? ''}`,",
      "    '',",
      "  ].join('\\n'),",
      "  'utf8',",
      ');',
      '',
      'if (process.env.K6_WEB_DASHBOARD_EXPORT) {',
      '  await mkdir(path.dirname(process.env.K6_WEB_DASHBOARD_EXPORT), { recursive: true });',
      "  await writeFile(process.env.K6_WEB_DASHBOARD_EXPORT, '<html><body>fake k6 report</body></html>\\n', 'utf8');",
      '}',
      '',
      "console.log('fake k6 run ok');",
      '',
    ].join('\n'),
    'utf8',
  );

  if (process.platform === 'win32') {
    await writeFile(
      path.join(binDir, 'k6.cmd'),
      [
        '@echo off',
        `"${process.execPath}" "${fakeK6ScriptPath}" %*`,
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  const k6Path = path.join(binDir, 'k6');
  await writeFile(
    k6Path,
    [
      '#!/bin/sh',
      `exec ${shellQuote(process.execPath)} ${shellQuote(fakeK6ScriptPath)} "$@"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await chmod(k6Path, 0o755);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runMultiModuleFlow(projectDir, fixture, env, options) {
  const {
    seedBaseUrl,
    authBaseUrl,
    bosBaseUrl,
  } = fixture;

  assertDistinctOrigins({
    seed: seedBaseUrl,
    auth: authBaseUrl,
    bos: bosBaseUrl,
  });

  await mkdir(projectDir, { recursive: true });
  await runCli([
    'init',
    '--no-input',
    '--module',
    'seed',
    '--base-url',
    seedBaseUrl,
    '--openapi',
    `${seedBaseUrl}/v3/api-docs`,
  ], projectDir, env);

  const authAdd = await runCli([
    'module',
    'add',
    'auth',
    '--base-url',
    authBaseUrl,
    '--sync',
    '--set-default',
  ], projectDir, env);
  assertIncludes(authAdd.stdout, `${authBaseUrl}/v3/api-docs  HTTP 404`, 'auth module add should try the default OpenAPI path first');
  assertIncludes(authAdd.stdout, `${authBaseUrl}/api-docs  OpenAPI 3.0.3`, 'auth module add should discover the fallback OpenAPI path');
  assertRequestLog(fixture.requests.auth, 'GET /v3/api-docs', 'auth OpenAPI discovery should try the default path');
  assertRequestLog(fixture.requests.auth, 'GET /api-docs', 'auth OpenAPI discovery should try the fallback path');

  const bosAdd = await runCli([
    'module',
    'add',
    'bos',
    '--base-url',
    bosBaseUrl,
    '--sync',
  ], projectDir, env);
  assertIncludes(bosAdd.stdout, `${bosBaseUrl}/v3/api-docs  OpenAPI 3.0.3`, 'bos module add should discover the default OpenAPI path');
  assertRequestLog(fixture.requests.bos, 'GET /v3/api-docs', 'bos OpenAPI discovery should try the default path');

  await writeFile(
    path.join(projectDir, 'openapi-k6/.env'),
    [
      'SMOKE_SKU=fixture-sku',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(projectDir, 'openapi-k6/scenarios/cross-module.yaml'),
    createCrossModuleScenario(),
    'utf8',
  );
  await writeFile(
    path.join(projectDir, 'openapi-k6/scenarios/validation-errors.yaml'),
    createValidationErrorsScenario(),
    'utf8',
  );

  await assertFileContains(path.join(projectDir, 'openapi-k6/config.yaml'), `openapi: ${authBaseUrl}/api-docs`);
  await assertFileContains(path.join(projectDir, 'openapi-k6/config.yaml'), `openapi: ${bosBaseUrl}/v3/api-docs`);
  await assertFileContains(path.join(projectDir, 'openapi-k6/openapi/auth.openapi.json'), '"operationId": "login"');
  await assertFileContains(path.join(projectDir, 'openapi-k6/openapi/bos.openapi.json'), '"operationId": "createOrder"');

  const authCatalogAi = await runCli(['catalog', '--module', 'auth', '--query', 'login', '--ai'], projectDir, env);
  assertIncludes(authCatalogAi.stdout, 'response extract candidates:', 'auth catalog --ai should show extract candidates');
  assertIncludes(authCatalogAi.stdout, 'token <- $.token (200 application/json)', 'auth catalog --ai should show token extract path');
  assertIncludes(authCatalogAi.stdout, 'yaml:', 'auth catalog --ai should show extract yaml');
  assertIncludes(authCatalogAi.stdout, 'request.headers.Authorization: "Bearer {{token}}"', 'auth catalog --ai should show token next-use hint');

  const bosCatalogAi = await runCli(['catalog', '--module', 'bos', '--query', 'createOrder', '--ai'], projectDir, env);
  assertIncludes(bosCatalogAi.stdout, 'id <- $.id (201 application/json)', 'bos catalog --ai should show id extract path');
  assertIncludes(bosCatalogAi.stdout, 'request.pathParams.id: "{{id}}"', 'bos catalog --ai should show id next-use hint');

  const invalidValidate = await runFailingCli(['validate', '-s', 'validation-errors'], projectDir, env);
  assertIncludes(invalidValidate.stderr, 'Scenario validation failed:', 'invalid validate should print validation failure');
  assertIncludes(invalidValidate.stderr, 'step "login": missing request.body.username required by POST /login', 'invalid validate should show missing required body field');
  assertIncludes(invalidValidate.stderr, 'step "missing-operation": operationId "createMissingOrder" was not found', 'invalid validate should show missing operationId');
  assertIncludes(invalidValidate.stderr, 'Fix hints:', 'invalid validate should print fix hints');
  assertIncludes(invalidValidate.stderr, 'Add the missing required request.body fields; inspect body fields with openapi-k6 catalog --query <keyword> --ai.', 'invalid validate should hint catalog body fields');
  assertIncludes(invalidValidate.stderr, 'Find the endpoint with openapi-k6 catalog --query <keyword> --ai, then update api.operationId or use api.method/api.path.', 'invalid validate should hint catalog operation lookup');

  const moduleList = await runCli(['module', 'list', '--json'], projectDir, env);
  assertModuleList(moduleList.stdout, ['seed', 'auth', 'bos'], 'auth');

  const validate = await runCli(['validate', '-s', 'cross-module'], projectDir, env);
  assertIncludes(validate.stdout, 'Validated openapi-k6/scenarios/cross-module.yaml', 'cross-module validate should pass');

  const test = await runCli(['test', '-s', 'cross-module', '--no-color'], projectDir, env);
  assertIncludes(test.stdout, 'summary:', 'cross-module scenario test should print a summary');
  assertIncludes(test.stdout, 'PASS', 'cross-module scenario test should pass');
  assertRequestLog(fixture.requests.auth, 'POST /login', 'cross-module test should call the auth server');
  assertRequestLog(fixture.requests.bos, 'POST /orders', 'cross-module test should call the bos server');

  await runCli(['generate', '-s', 'cross-module'], projectDir, env);
  const generatedScript = path.join(projectDir, 'openapi-k6/generated/cross-module.k6.js');
  await assertFileContains(generatedScript, `__ENV.BASE_URL_AUTH || __ENV.BASE_URL || ${JSON.stringify(authBaseUrl)}`);
  await assertFileContains(generatedScript, `__ENV.BASE_URL_BOS || __ENV.BASE_URL || ${JSON.stringify(bosBaseUrl)}`);
  await assertFileContains(generatedScript, '`/login`');
  await assertFileContains(generatedScript, '`/orders`');

  const run = await runCli([
    'run',
    '-s',
    'cross-module',
    '--write',
    'openapi-k6/generated/cross-module-run.k6.js',
    '--log',
    '--trace',
    '--report',
    '--open-dashboard',
    '--',
    '--vus',
    '1',
    '--iterations',
    '1',
  ], projectDir, env);
  assertIncludes(run.stdout, 'Generated ', 'run should generate a k6 script before invoking k6');
  assertIncludes(run.stdout, 'fake k6 run ok', 'run should stream fake k6 output');

  await assertFileContains(path.join(projectDir, 'openapi-k6/logs/cross-module.log'), 'fake k6 run ok');
  await assertFileContains(path.join(projectDir, 'openapi-k6/logs/cross-module-report.html'), 'fake k6 report');
  await assertFileContains(options.k6EnvLogPath, 'OPENAPI_K6_TRACE=1');
  await assertFileContains(options.k6EnvLogPath, 'K6_WEB_DASHBOARD=true');
  await assertFileContains(options.k6EnvLogPath, 'K6_WEB_DASHBOARD_OPEN=true');
  await assertFileContains(options.k6EnvLogPath, 'SMOKE_SKU=fixture-sku');
  assertK6Args(await readFile(options.k6ArgsLogPath, 'utf8'));
}

function runCli(args, cwd, env) {
  return runCommand(
    process.execPath,
    [cliPath, ...args],
    cwd,
    `openapi-k6 ${args.join(' ')}`,
    env,
  );
}

function runFailingCli(args, cwd, env) {
  return runCommand(
    process.execPath,
    [cliPath, ...args],
    cwd,
    `openapi-k6 ${args.join(' ')}`,
    env,
    { expectFailure: true },
  );
}

function runCommand(command, args, cwd, label, env, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...env,
        NO_COLOR: '1',
        TERM: 'dumb',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (options.expectFailure === true) {
        if (code !== 0) {
          resolve({ stdout, stderr, code });
          return;
        }

        reject(new Error([
          `${label} unexpectedly succeeded`,
          '',
          'stdout:',
          stdout.trimEnd(),
          '',
          'stderr:',
          stderr.trimEnd(),
        ].join('\n')));
        return;
      }

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error([
        `${label} failed with exit code ${code}`,
        '',
        'stdout:',
        stdout.trimEnd(),
        '',
        'stderr:',
        stderr.trimEnd(),
      ].join('\n')));
    });
  });
}

async function assertFileContains(filePath, expected) {
  const contents = await readFile(filePath, 'utf8');
  assertIncludes(contents, expected, `${filePath} should contain ${expected}`);
}

function assertIncludes(value, expected, message) {
  if (!value.includes(expected)) {
    throw new Error(`${message}\nExpected to include: ${expected}\nReceived:\n${value}`);
  }
}

function assertModuleList(stdout, expectedNames, expectedDefault) {
  const parsed = JSON.parse(stdout);
  const modules = new Map(parsed.modules.map((moduleConfig) => [moduleConfig.name, moduleConfig]));

  if (parsed.defaultModule !== expectedDefault) {
    throw new Error(`expected defaultModule ${expectedDefault}, got ${parsed.defaultModule}`);
  }

  for (const name of expectedNames) {
    if (!modules.has(name)) {
      throw new Error(`expected module list to include ${name}`);
    }
  }
}

function assertDistinctOrigins(namedUrls) {
  const origins = Object.entries(namedUrls).map(([name, url]) => [name, new URL(url).origin]);
  const uniqueOrigins = new Set(origins.map(([, origin]) => origin));

  if (uniqueOrigins.size !== origins.length) {
    throw new Error(`expected fixture modules to use distinct server origins; got ${JSON.stringify(Object.fromEntries(origins))}`);
  }
}

function assertRequestLog(requests, expected, message) {
  if (!requests.includes(expected)) {
    throw new Error(`${message}\nExpected request: ${expected}\nReceived requests:\n${requests.join('\n')}`);
  }
}

function assertK6Args(rawArgs) {
  const args = rawArgs.trim().split('\n');

  for (const expected of ['run', '--vus', '1', '--iterations', '1']) {
    if (!args.includes(expected)) {
      throw new Error(`expected fake k6 args to include ${expected}; got ${JSON.stringify(args)}`);
    }
  }

  const scriptPath = args.at(-1);
  if (scriptPath === undefined || !scriptPath.endsWith('openapi-k6/generated/cross-module-run.k6.js')) {
    throw new Error(`expected fake k6 to receive the generated script path last; got ${JSON.stringify(args)}`);
  }
}

function createCrossModuleScenario() {
  return [
    'name: cross-module',
    '',
    'steps:',
    '  - id: login',
    '    api:',
    '      module: auth',
    '      operationId: login',
    '    request:',
    '      body:',
    '        username: smoke',
    '    condition: status == 200',
    '    extract:',
    '      token:',
    '        from: $.token',
    '',
    '  - id: create-order',
    '    api:',
    '      module: bos',
    '      operationId: createOrder',
    '    request:',
    '      headers:',
    '        Authorization: "Bearer {{token}}"',
    '      body:',
    '        sku: "{{env.SMOKE_SKU}}"',
    '    condition: status == 201',
    '    extract:',
    '      orderId:',
    '        from: $.id',
    '',
  ].join('\n');
}

function createValidationErrorsScenario() {
  return [
    'name: validation-errors',
    '',
    'steps:',
    '  - id: login',
    '    api:',
    '      module: auth',
    '      operationId: login',
    '    request:',
    '      body: {}',
    '',
    '  - id: missing-operation',
    '    api:',
    '      module: bos',
    '      operationId: createMissingOrder',
    '',
  ].join('\n');
}

async function startFixtureBackends() {
  const seed = await startFixtureServer(async ({ request, response, url, origin }) => {
    if (request.method === 'GET' && url.pathname === '/v3/api-docs') {
      sendJson(response, 200, createSeedOpenApi(origin));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  });
  const auth = await startFixtureServer(async ({ request, response, url, origin }) => {
    if (request.method === 'GET' && url.pathname === '/v3/api-docs') {
      sendJson(response, 404, { error: 'not found' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api-docs') {
      sendJson(response, 200, createAuthOpenApi(origin));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/login') {
      const body = await readJsonRequest(request);

      if (body.username !== 'smoke') {
        sendJson(response, 400, { error: 'invalid username' });
        return;
      }

      sendJson(response, 200, { token: 'smoke-token' });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  });
  const bos = await startFixtureServer(async ({ request, response, url, origin }) => {
    if (request.method === 'GET' && url.pathname === '/v3/api-docs') {
      sendJson(response, 200, createBosOpenApi(origin));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/orders') {
      const authorization = request.headers.authorization;
      const body = await readJsonRequest(request);

      if (authorization !== 'Bearer smoke-token') {
        sendJson(response, 401, { error: 'missing token' });
        return;
      }

      if (body.sku !== 'fixture-sku') {
        sendJson(response, 400, { error: 'invalid sku' });
        return;
      }

      sendJson(response, 201, { id: 'order-123', sku: body.sku });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  });

  return {
    seedBaseUrl: seed.origin,
    authBaseUrl: auth.origin,
    bosBaseUrl: bos.origin,
    requests: {
      seed: seed.requests,
      auth: auth.requests,
      bos: bos.requests,
    },
    close: async () => {
      await Promise.all([
        seed.close(),
        auth.close(),
        bos.close(),
      ]);
    },
  };
}

function startFixtureServer(handler) {
  const requests = [];
  let origin = 'http://fixture.local';
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', origin);
    requests.push(`${request.method} ${url.pathname}`);

    try {
      await handler({ request, response, url, origin });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address === null || typeof address === 'string') {
        reject(new Error('failed to bind fixture server'));
        return;
      }

      origin = `http://127.0.0.1:${address.port}`;
      resolve({
        origin,
        requests,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error);
              return;
            }

            closeResolve();
          });
        }),
      });
    });
  });
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function readJsonRequest(request) {
  return new Promise((resolve, reject) => {
    let raw = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('error', reject);
    request.on('end', () => {
      try {
        resolve(raw === '' ? {} : JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function createSeedOpenApi(serverPath) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Seed Fixture API',
      version: '1.0.0',
    },
    servers: [{ url: serverPath }],
    paths: {
      '/health': {
        get: {
          operationId: 'getSeedHealth',
          responses: {
            200: {
              description: 'OK',
            },
          },
        },
      },
    },
  };
}

function createAuthOpenApi(serverPath) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Auth Fixture API',
      version: '1.0.0',
    },
    servers: [{ url: serverPath }],
    paths: {
      '/login': {
        post: {
          operationId: 'login',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    username: { type: 'string' },
                  },
                  required: ['username'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function createBosOpenApi(serverPath) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'BOS Fixture API',
      version: '1.0.0',
    },
    servers: [{ url: serverPath }],
    paths: {
      '/orders': {
        post: {
          operationId: 'createOrder',
          parameters: [
            {
              name: 'Authorization',
              in: 'header',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sku: { type: 'string' },
                  },
                  required: ['sku'],
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      sku: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

await main();
