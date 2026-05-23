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
  let server;

  try {
    server = await startFixtureBackend();
    const origin = `http://127.0.0.1:${server.port}`;
    const projectDir = path.join(workspace, 'backend-project');
    const k6ArgsLogPath = path.join(workspace, 'k6-args.txt');
    const k6EnvLogPath = path.join(workspace, 'k6-env.txt');
    const env = await createSmokeEnv(path.join(workspace, 'bin'), {
      k6ArgsLogPath,
      k6EnvLogPath,
    });

    await runMultiModuleFlow(projectDir, origin, env, {
      k6ArgsLogPath,
      k6EnvLogPath,
    });

    console.log(`Local backend E2E smoke passed for ${origin}.`);
  } finally {
    if (server !== undefined) {
      await server.close();
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

async function runMultiModuleFlow(projectDir, origin, env, options) {
  const seedBaseUrl = `${origin}/seed`;
  const authBaseUrl = `${origin}/auth`;
  const bosBaseUrl = `${origin}/bos`;

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

  const bosAdd = await runCli([
    'module',
    'add',
    'bos',
    '--base-url',
    bosBaseUrl,
    '--sync',
  ], projectDir, env);
  assertIncludes(bosAdd.stdout, `${bosBaseUrl}/v3/api-docs  OpenAPI 3.0.3`, 'bos module add should discover the default OpenAPI path');

  await writeFile(
    path.join(projectDir, 'load-tests/.env'),
    [
      'SMOKE_SKU=fixture-sku',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(projectDir, 'load-tests/scenarios/cross-module.yaml'),
    createCrossModuleScenario(),
    'utf8',
  );

  await assertFileContains(path.join(projectDir, 'load-tests/config.yaml'), `openapi: ${authBaseUrl}/api-docs`);
  await assertFileContains(path.join(projectDir, 'load-tests/config.yaml'), `openapi: ${bosBaseUrl}/v3/api-docs`);
  await assertFileContains(path.join(projectDir, 'load-tests/openapi/auth.openapi.json'), '"operationId": "login"');
  await assertFileContains(path.join(projectDir, 'load-tests/openapi/bos.openapi.json'), '"operationId": "createOrder"');

  const moduleList = await runCli(['module', 'list', '--json'], projectDir, env);
  assertModuleList(moduleList.stdout, ['seed', 'auth', 'bos'], 'auth');

  const validate = await runCli(['validate', '-s', 'cross-module'], projectDir, env);
  assertIncludes(validate.stdout, 'Validated load-tests/scenarios/cross-module.yaml', 'cross-module validate should pass');

  const test = await runCli(['test', '-s', 'cross-module', '--no-color'], projectDir, env);
  assertIncludes(test.stdout, 'summary:', 'cross-module scenario test should print a summary');
  assertIncludes(test.stdout, 'PASS', 'cross-module scenario test should pass');

  await runCli(['generate', '-s', 'cross-module'], projectDir, env);
  const generatedScript = path.join(projectDir, 'load-tests/generated/cross-module.k6.js');
  await assertFileContains(generatedScript, `__ENV.BASE_URL_AUTH || __ENV.BASE_URL || ${JSON.stringify(authBaseUrl)}`);
  await assertFileContains(generatedScript, `__ENV.BASE_URL_BOS || __ENV.BASE_URL || ${JSON.stringify(bosBaseUrl)}`);
  await assertFileContains(generatedScript, '`/login`');
  await assertFileContains(generatedScript, '`/orders`');

  const run = await runCli([
    'run',
    '-s',
    'cross-module',
    '--write',
    'load-tests/generated/cross-module-run.k6.js',
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

  await assertFileContains(path.join(projectDir, 'load-tests/logs/cross-module.log'), 'fake k6 run ok');
  await assertFileContains(path.join(projectDir, 'load-tests/logs/cross-module-report.html'), 'fake k6 report');
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

function runCommand(command, args, cwd, label, env) {
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

function assertK6Args(rawArgs) {
  const args = rawArgs.trim().split('\n');

  for (const expected of ['run', '--vus', '1', '--iterations', '1']) {
    if (!args.includes(expected)) {
      throw new Error(`expected fake k6 args to include ${expected}; got ${JSON.stringify(args)}`);
    }
  }

  const scriptPath = args.at(-1);
  if (scriptPath === undefined || !scriptPath.endsWith('load-tests/generated/cross-module-run.k6.js')) {
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

function startFixtureBackend() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.local');

    if (request.method === 'GET' && url.pathname === '/seed/v3/api-docs') {
      sendJson(response, 200, createSeedOpenApi('/seed'));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/auth/v3/api-docs') {
      sendJson(response, 404, { error: 'not found' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/auth/api-docs') {
      sendJson(response, 200, createAuthOpenApi('/auth'));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/bos/v3/api-docs') {
      sendJson(response, 200, createBosOpenApi('/bos'));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/auth/login') {
      const body = await readJsonRequest(request);

      if (body.username !== 'smoke') {
        sendJson(response, 400, { error: 'invalid username' });
        return;
      }

      sendJson(response, 200, { token: 'smoke-token' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/bos/orders') {
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

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address === null || typeof address === 'string') {
        reject(new Error('failed to bind fixture server'));
        return;
      }

      resolve({
        port: address.port,
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
