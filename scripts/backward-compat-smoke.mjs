import { spawn } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function main() {
  await assertBuiltCliExists();

  const workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-compat-'));
  let server;

  try {
    const smokeEnv = await createSmokeEnv(path.join(workspace, 'guard-bin'));
    const packagePath = await packPackage(path.join(workspace, 'package'), smokeEnv);
    server = await startFixtureServer();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    await runVersionSmoke(workspace, packagePath, smokeEnv);
    await runInitSmoke(path.join(workspace, 'init-project'), packagePath, smokeEnv);
    await runExistingProjectSmoke(path.join(workspace, 'existing-project'), baseUrl, packagePath, smokeEnv);

    console.log('Backward compatibility smoke passed.');
  } finally {
    if (server !== undefined) {
      await server.close();
    }

    await rm(workspace, { recursive: true, force: true });
  }
}

async function runVersionSmoke(workspace, packagePath, env) {
  const expectedVersion = await readPackageVersion();
  const version = await runCli(['--version'], workspace, packagePath, env);

  if (version.stdout.trim() !== expectedVersion) {
    throw new Error(`expected openapi-k6 --version to print ${expectedVersion}, got ${version.stdout.trim()}`);
  }
}

async function readPackageVersion() {
  const packageJson = JSON.parse(
    await readFile(path.join(repoRoot, 'package.json'), 'utf8'),
  );

  if (typeof packageJson.version !== 'string') {
    throw new Error('package.json version must be a string');
  }

  return packageJson.version;
}

async function createSmokeEnv(guardBinDir) {
  await writeAmbientCliGuard(guardBinDir);

  return {
    ...process.env,
    PATH: [guardBinDir, process.env.PATH ?? ''].filter((value) => value !== '').join(path.delimiter),
  };
}

async function writeAmbientCliGuard(guardBinDir) {
  await mkdir(guardBinDir, { recursive: true });

  if (process.platform === 'win32') {
    await writeFile(
      path.join(guardBinDir, 'openapi-k6.cmd'),
      [
        '@echo off',
        'echo ambient openapi-k6 guard invoked 1>&2',
        'exit /b 127',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  const guardPath = path.join(guardBinDir, 'openapi-k6');
  await writeFile(
    guardPath,
    [
      '#!/bin/sh',
      'echo "ambient openapi-k6 guard invoked" >&2',
      'exit 127',
      '',
    ].join('\n'),
    'utf8',
  );
  await chmod(guardPath, 0o755);
}

async function packPackage(packDir, env) {
  await mkdir(packDir, { recursive: true });
  await runCommand(npmCommand, ['pack', '--pack-destination', packDir], repoRoot, 'npm pack', env);

  const packageFiles = (await readdir(packDir)).filter((fileName) => fileName.endsWith('.tgz'));

  if (packageFiles.length !== 1) {
    throw new Error(`expected one packed tarball in ${packDir}, found ${packageFiles.length}`);
  }

  return path.join(packDir, packageFiles[0]);
}

async function assertBuiltCliExists() {
  try {
    await access(cliPath);
  } catch {
    throw new Error('dist/cli/index.js was not found. Run pnpm run build before this smoke test.');
  }
}

async function runInitSmoke(projectDir, packagePath, env) {
  await mkdir(projectDir, { recursive: true });

  await runCli(['init', '--no-input'], projectDir, packagePath, env);
  await assertFileContains(path.join(projectDir, 'openapi-k6/config.yaml'), 'defaultModule: default');
  await assertFileContains(path.join(projectDir, 'openapi-k6/scenarios/smoke.yaml'), 'name: smoke');
}

async function runExistingProjectSmoke(projectDir, baseUrl, packagePath, env) {
  const configArgs = ['--config', 'load-tests/config.yaml'];

  await mkdir(path.join(projectDir, 'load-tests/openapi'), { recursive: true });
  await mkdir(path.join(projectDir, 'load-tests/scenarios'), { recursive: true });

  await writeFile(path.join(projectDir, 'load-tests/config.yaml'), createConfig(baseUrl), 'utf8');
  await writeFile(path.join(projectDir, 'load-tests/openapi/default.openapi.yaml'), createOpenApi(baseUrl), 'utf8');
  await writeFile(path.join(projectDir, 'load-tests/scenarios/smoke.yaml'), createScenario(), 'utf8');

  const update = await runCli(['update', ...configArgs], projectDir, packagePath, env);
  assertIncludes(update.stdout, 'Updated openapi-k6 workspace metadata in load-tests', 'legacy workspace should update in place');

  await runCli(['sync', ...configArgs], projectDir, packagePath, env);
  await assertFileContains(path.join(projectDir, 'load-tests/openapi/default.openapi.json'), '"operationId": "getHealth"');
  await assertFileContains(path.join(projectDir, 'load-tests/openapi/catalog.json'), '"operationId": "getHealth"');

  const catalog = await runCli(['catalog', ...configArgs, '--query', 'health'], projectDir, packagePath, env);
  assertIncludes(catalog.stdout, 'operationId: getHealth', 'catalog output should include the health operation');

  const validate = await runCli(['validate', ...configArgs, '-s', 'smoke'], projectDir, packagePath, env);
  assertIncludes(validate.stdout, 'Validated load-tests/scenarios/smoke.yaml', 'scenario validate should pass');

  const test = await runCli(['test', ...configArgs, '-s', 'smoke', '--no-color'], projectDir, packagePath, env);
  assertIncludes(test.stdout, 'summary:', 'scenario test should print a summary');
  assertIncludes(test.stdout, 'PASS', 'scenario test should pass');

  await runCli(['generate', ...configArgs, '-s', 'smoke'], projectDir, packagePath, env);
  await assertFileContains(path.join(projectDir, 'load-tests/generated/smoke.k6.js'), '/health');

  await runCli(['update', ...configArgs], projectDir, packagePath, env);
  await assertFileContains(path.join(projectDir, 'load-tests/config.yaml'), `baseUrl: ${baseUrl}`);
  await assertFileContains(path.join(projectDir, 'load-tests/scenarios/smoke.yaml'), 'name: smoke');
  await assertFileContains(path.join(projectDir, 'load-tests/openapi/catalog.json'), '"operationId": "getHealth"');
  await assertFileContains(path.join(projectDir, 'load-tests/generated/smoke.k6.js'), '/health');
}

function runCli(args, cwd, packagePath, env) {
  return runCommand(
    npmCommand,
    ['exec', '--yes', '--package', packagePath, '--', 'openapi-k6', ...args],
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

function createConfig(baseUrl) {
  return [
    `baseUrl: ${baseUrl}`,
    'defaultModule: default',
    '',
    'modules:',
    '  default:',
    '    openapi: openapi/default.openapi.yaml',
    '    snapshot: openapi/default.openapi.json',
    '    catalog: openapi/catalog.json',
    '',
  ].join('\n');
}

function createOpenApi(baseUrl) {
  return [
    'openapi: 3.0.3',
    'info:',
    '  title: Compatibility Smoke API',
    '  version: 1.0.0',
    'servers:',
    `  - url: ${baseUrl}`,
    'paths:',
    '  /health:',
    '    get:',
    '      operationId: getHealth',
    '      tags:',
    '        - system',
    '      responses:',
    '        "200":',
    '          description: OK',
    '          content:',
    '            application/json:',
    '              schema:',
    '                type: object',
    '                properties:',
    '                  ok:',
    '                    type: boolean',
    '',
  ].join('\n');
}

function createScenario() {
  return [
    'name: smoke',
    '',
    'steps:',
    '  - id: health',
    '    api:',
    '      operationId: getHealth',
    '    condition: status == 200',
    '    extract:',
    '      ok:',
    '        from: $.ok',
    '',
  ].join('\n');
}

function startFixtureServer() {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
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

await main();
