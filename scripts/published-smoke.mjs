import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const defaultPackageSpec = 'openapi-k6@latest';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function main() {
  const packageSpec = readPackageSpec(process.argv);
  const workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-published-'));

  try {
    const smokeEnv = await createSmokeEnv(path.join(workspace, 'guard-bin'));
    const expectedVersion = await readPublishedVersion(packageSpec, workspace, smokeEnv);

    await runVersionSmoke(workspace, packageSpec, expectedVersion, smokeEnv);
    await runHelpSmoke(workspace, packageSpec, smokeEnv);
    await runInitSmoke(path.join(workspace, 'init-project'), packageSpec, smokeEnv);
    await runStandaloneScenarioSmoke(path.join(workspace, 'scenario-project'), packageSpec, smokeEnv);

    console.log(`Published package smoke passed for ${packageSpec} (${expectedVersion}).`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function readPackageSpec(argv) {
  const args = argv.slice(2);

  if (args[0] === '--') {
    return args[1] ?? defaultPackageSpec;
  }

  return args[0] ?? defaultPackageSpec;
}

async function readPublishedVersion(packageSpec, workspace, env) {
  const maxAttempts = 12;
  const retryDelayMs = 5000;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await runCommand(
        npmCommand,
        ['view', packageSpec, 'version'],
        workspace,
        `npm view ${packageSpec} version`,
        env,
      );
      const version = result.stdout.trim();

      if (version === '') {
        throw new Error(`npm view ${packageSpec} version returned an empty version`);
      }

      return version;
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw new Error([
    `failed to resolve published version for ${packageSpec} after ${maxAttempts} attempts`,
    '',
    lastError instanceof Error ? lastError.message : String(lastError),
  ].join('\n'));
}

async function runVersionSmoke(workspace, packageSpec, expectedVersion, env) {
  const version = await runCli(['--version'], workspace, packageSpec, env);

  if (version.stdout.trim() !== expectedVersion) {
    throw new Error(`expected openapi-k6 --version to print ${expectedVersion}, got ${version.stdout.trim()}`);
  }
}

async function runHelpSmoke(workspace, packageSpec, env) {
  const help = await runCli(['--help'], workspace, packageSpec, env);

  assertIncludes(help.stdout, 'init', 'help output should include init command');
  assertIncludes(help.stdout, 'validate', 'help output should include validate command');
  assertIncludes(help.stdout, 'generate', 'help output should include generate command');
  assertIncludes(help.stdout, 'run', 'help output should include run command');
}

async function runInitSmoke(projectDir, packageSpec, env) {
  await mkdir(projectDir, { recursive: true });

  await runCli(['init', '--no-input'], projectDir, packageSpec, env);
  await assertFileContains(path.join(projectDir, 'load-tests/config.yaml'), 'defaultModule: default');
  await assertFileContains(path.join(projectDir, 'load-tests/scenarios/smoke.yaml'), 'name: smoke');
  await assertFileContains(path.join(projectDir, 'load-tests/README.md'), 'openapi-k6');
  await assertFileContains(path.join(projectDir, 'load-tests/run.sh'), 'k6 run');
}

async function runStandaloneScenarioSmoke(projectDir, packageSpec, env) {
  await mkdir(path.join(projectDir, 'generated'), { recursive: true });
  await writeFile(path.join(projectDir, 'openapi.yaml'), createOpenApi(), 'utf8');
  await writeFile(path.join(projectDir, 'scenario.yaml'), createScenario(), 'utf8');

  const validate = await runCli(
    ['validate', '-s', 'scenario.yaml', '-o', 'openapi.yaml'],
    projectDir,
    packageSpec,
    env,
  );
  assertIncludes(validate.stdout, 'Validated scenario.yaml', 'standalone scenario validate should pass');

  await runCli(
    ['generate', '-s', 'scenario.yaml', '-o', 'openapi.yaml', '-w', 'generated/script.js'],
    projectDir,
    packageSpec,
    env,
  );
  await assertFileContains(path.join(projectDir, 'generated/script.js'), '/health');
  await assertFileContains(
    path.join(projectDir, 'generated/script.js'),
    'const BASE_URL = __ENV.BASE_URL || "https://published-smoke.test.local";',
  );
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

function runCli(args, cwd, packageSpec, env) {
  return runCommand(
    npmCommand,
    ['exec', '--yes', '--package', packageSpec, '--', 'openapi-k6', ...args],
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

function createOpenApi() {
  return [
    'openapi: 3.0.3',
    'info:',
    '  title: Published Smoke API',
    '  version: 1.0.0',
    'servers:',
    '  - url: https://published-smoke.test.local',
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
    '',
  ].join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

await main();
