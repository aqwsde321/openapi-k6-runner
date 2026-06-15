import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');

async function main() {
  await assertBuiltCliExists();

  const workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-ui-sample-'));
  let backend;
  let ui;

  try {
    backend = await startSampleBackend();
    await writeSampleWorkspace(workspace, backend.origin);
    ui = await startUi(workspace);
    printSampleInstructions({
      workspace,
      backendUrl: backend.origin,
      uiUrl: ui.url,
    });
    await waitForStopSignal();
  } finally {
    if (ui !== undefined) {
      await ui.close();
    }

    if (backend !== undefined) {
      await backend.close();
    }
  }
}

async function assertBuiltCliExists() {
  try {
    await access(cliPath);
  } catch {
    throw new Error('dist/cli/index.js was not found. Run pnpm run build before pnpm run sample:ui.');
  }
}

async function writeSampleWorkspace(workspace, baseUrl) {
  const workspaceDir = path.join(workspace, 'openapi-k6');

  await mkdir(path.join(workspaceDir, 'openapi'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'scenarios/auth'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'scenarios/order/partials'), { recursive: true });

  await writeFile(path.join(workspaceDir, 'config.yaml'), createConfig(baseUrl), 'utf8');
  await writeFile(path.join(workspaceDir, '.openapi-k6.json'), await createScaffoldMetadata(), 'utf8');
  await writeFile(path.join(workspaceDir, 'openapi/app.openapi.yaml'), createOpenApi(baseUrl), 'utf8');
  await writeFile(path.join(workspaceDir, 'scenarios/smoke.yaml'), createSmokeScenario(), 'utf8');
  await writeFile(path.join(workspaceDir, 'scenarios/auth/login.yaml'), createLoginScenario(), 'utf8');
  await writeFile(path.join(workspaceDir, 'scenarios/order/use-login.yaml'), createUseLoginScenario(), 'utf8');
  await writeFile(path.join(workspaceDir, 'scenarios/order/include-health.yaml'), createIncludeHealthScenario(), 'utf8');
  await writeFile(path.join(workspaceDir, 'scenarios/order/partials/health.yaml'), createHealthPartial(), 'utf8');
}

async function createScaffoldMetadata() {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  return JSON.stringify({
    tool: 'openapi-k6',
    schemaVersion: 1,
    scaffoldVersion: packageJson.version,
    generatedAt: new Date().toISOString(),
  }, null, 2) + '\n';
}

function createConfig(baseUrl) {
  return [
    `baseUrl: ${baseUrl}`,
    'defaultModule: app',
    'modules:',
    '  app:',
    '    snapshot: openapi/app.openapi.yaml',
    '',
  ].join('\n');
}

function createOpenApi(baseUrl) {
  return [
    'openapi: 3.0.3',
    'info:',
    '  title: openapi-k6 UI Sample API',
    '  version: 1.0.0',
    'servers:',
    `  - url: ${baseUrl}`,
    'paths:',
    '  /health:',
    '    get:',
    '      operationId: getHealth',
    '      responses:',
    '        "200":',
    '          description: OK',
    '          content:',
    '            application/json:',
    '              schema:',
    '                type: object',
    '  /login:',
    '    post:',
    '      operationId: login',
    '      requestBody:',
    '        required: true',
    '        content:',
    '          application/json:',
    '            schema:',
    '              type: object',
    '              required:',
    '                - username',
    '              properties:',
    '                username:',
    '                  type: string',
    '      responses:',
    '        "200":',
    '          description: OK',
    '          content:',
    '            application/json:',
    '              schema:',
    '                type: object',
    '                properties:',
    '                  token:',
    '                    type: string',
    '  /orders:',
    '    post:',
    '      operationId: createOrder',
    '      parameters:',
    '        - name: Authorization',
    '          in: header',
    '          required: true',
    '          schema:',
    '            type: string',
    '      requestBody:',
    '        required: true',
    '        content:',
    '          application/json:',
    '            schema:',
    '              type: object',
    '              required:',
    '                - sku',
    '              properties:',
    '                sku:',
    '                  type: string',
    '      responses:',
    '        "201":',
    '          description: Created',
    '          content:',
    '            application/json:',
    '              schema:',
    '                type: object',
    '                properties:',
    '                  id:',
    '                    type: string',
    '',
  ].join('\n');
}

function createSmokeScenario() {
  return [
    'name: smoke',
    'steps:',
    '  - id: health',
    '    api:',
    '      operationId: getHealth',
    '    condition: status == 200',
    '',
  ].join('\n');
}

function createLoginScenario() {
  return [
    'name: login',
    'steps:',
    '  - id: login',
    '    api:',
    '      operationId: login',
    '    request:',
    '      body:',
    '        username: smoke',
    '    extract:',
    '      token:',
    '        from: $.token',
    '    condition: status == 201',
    '',
  ].join('\n');
}

function createUseLoginScenario() {
  return [
    'name: use-login',
    'steps:',
    '  - use: auth/login',
    '  - id: create-order',
    '    api:',
    '      operationId: createOrder',
    '    request:',
    '      headers:',
    '        Authorization: "Bearer {{token}}"',
    '      body:',
    '        sku: SKU-001',
    '    condition: status == 201',
    '',
  ].join('\n');
}

function createIncludeHealthScenario() {
  return [
    'name: include-health',
    'steps:',
    '  - include: ./partials/health.yaml',
    '  - id: direct-health',
    '    api:',
    '      operationId: getHealth',
    '    condition: status == 200',
    '',
  ].join('\n');
}

function createHealthPartial() {
  return [
    'steps:',
    '  - id: included-health',
    '    api:',
    '      operationId: getHealth',
    '    condition: status == 200',
    '',
  ].join('\n');
}

async function startUi(workspace) {
  const { runUiCommand } = await import(pathToFileURL(cliPath).href);

  return runUiCommand({
    config: 'openapi-k6/config.yaml',
  }, {
    cwd: workspace,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

function waitForStopSignal() {
  return new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
}

async function startSampleBackend() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/login') {
        const body = await readJsonRequest(request);

        if (body.username !== 'smoke') {
          sendJson(response, 400, { error: 'invalid username' });
          return;
        }

        sendJson(response, 200, { token: 'sample-token' });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/orders') {
        const body = await readJsonRequest(request);

        if (request.headers.authorization !== 'Bearer sample-token') {
          sendJson(response, 401, { error: 'missing token' });
          return;
        }

        if (body.sku !== 'SKU-001') {
          sendJson(response, 400, { error: 'invalid sku' });
          return;
        }

        sendJson(response, 201, { id: 'order-001', sku: body.sku });
        return;
      }

      sendJson(response, 404, { error: 'not found' });
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
        reject(new Error('failed to bind sample backend'));
        return;
      }

      resolve({
        origin: `http://127.0.0.1:${address.port}`,
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

function printSampleInstructions({ workspace, backendUrl, uiUrl }) {
  console.log('');
  console.log('UI sample workspace is ready.');
  console.log(`  UI:        ${uiUrl}`);
  console.log(`  Backend:   ${backendUrl}`);
  console.log(`  Workspace: ${path.join(workspace, 'openapi-k6')}`);
  console.log('');
  console.log('Try these scenarios in the UI:');
  console.log('  smoke                 passes with direct source');
  console.log('  order/include-health  passes and shows include ./partials/health.yaml');
  console.log('  order/use-login       fails login on purpose and shows use auth/login in Latest result');
  console.log('');
  console.log('Press Ctrl+C to stop the UI. The workspace is left on disk for inspection.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
