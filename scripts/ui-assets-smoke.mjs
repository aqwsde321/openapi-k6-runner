import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runFile = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const localIndexPath = path.join(projectRoot, 'dist/cli/ui/app/index.html');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

await access(localIndexPath).catch(() => {
  throw new Error('React UI build was not found. Run pnpm build first.');
});

const workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-ui-assets-'));
const packDir = path.join(workspace, 'pack');
const installDir = path.join(workspace, 'install');
const fixtureDir = path.join(workspace, 'fixture');
const npmEnv = { ...process.env, npm_config_cache: path.join(workspace, 'npm-cache') };
let ui;

try {
  await Promise.all([
    mkdir(packDir, { recursive: true }),
    mkdir(installDir, { recursive: true }),
    mkdir(path.join(fixtureDir, 'openapi'), { recursive: true }),
    mkdir(path.join(fixtureDir, 'scenarios'), { recursive: true }),
  ]);

  const { stdout } = await runFile(
    npmCommand,
    ['pack', '--json', '--pack-destination', packDir],
    { cwd: projectRoot, env: npmEnv, maxBuffer: 10 * 1024 * 1024 },
  );
  const packResults = JSON.parse(stdout);
  const packResult = Array.isArray(packResults) ? packResults[0] : Object.values(packResults)[0];

  if (packResult === undefined || typeof packResult.filename !== 'string' || !Array.isArray(packResult.files)) {
    throw new Error('npm pack did not return a package filename and files manifest.');
  }

  const localHtml = await readFile(localIndexPath, 'utf8');
  const assetPaths = readAssetPaths(localHtml);
  const packedFiles = new Set(packResult.files.map((file) => file.path));

  for (const requiredPath of [
    'dist/cli/ui/app/index.html',
    ...assetPaths.map(toPackageAssetPath),
  ]) {
    if (!packedFiles.has(requiredPath)) {
      throw new Error(`${requiredPath} is missing from the npm package.`);
    }
  }

  if (packedFiles.has('dist/cli/ui/html.js')) {
    throw new Error('Legacy UI implementation remains in the npm package.');
  }

  const tarballPath = path.join(packDir, packResult.filename);
  await access(tarballPath);
  await writeFile(path.join(installDir, 'package.json'), '{"private":true}\n', 'utf8');
  await runFile(
    npmCommand,
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath],
    { cwd: installDir, env: npmEnv, maxBuffer: 10 * 1024 * 1024 },
  );

  const installedRoot = path.join(installDir, 'node_modules/openapi-k6');
  const installedAppDir = path.join(installedRoot, 'dist/cli/ui/app');
  const installedIndexPath = path.join(installedAppDir, 'index.html');
  const installedHtml = await readFile(installedIndexPath, 'utf8');
  const installedAssetPaths = readAssetPaths(installedHtml);

  for (const assetPath of installedAssetPaths) {
    const source = await readFile(path.join(installedAppDir, assetPath.slice('/ui-assets/'.length)), 'utf8');

    if (assetPath.endsWith('.js') && /\bReact\.createElement\b/.test(source)) {
      throw new Error('React UI bundle contains an unbound classic JSX runtime reference.');
    }
  }

  await writeFixture(fixtureDir);
  const { runUiCommand } = await import(
    pathToFileURL(path.join(installedRoot, 'dist/cli/index.js')).href
  );
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  ui = await runUiCommand(
    { config: 'config.yaml', port: '0' },
    { cwd: fixtureDir, stdout: sink, stderr: sink },
  );

  const indexResponse = await fetch(`${ui.url}/`);
  if (indexResponse.status !== 200 || !indexResponse.headers.get('content-type')?.startsWith('text/html')) {
    throw new Error('Installed React UI index was not served with the HTML content type.');
  }
  if (await indexResponse.text() !== installedHtml) {
    throw new Error('Served React UI index differs from the installed package.');
  }

  for (const removedPath of ['/next', '/next/', '/legacy', '/legacy/']) {
    if ((await fetch(`${ui.url}${removedPath}`)).status !== 404) {
      throw new Error(`${removedPath} must not serve a removed UI route.`);
    }
  }

  for (const assetPath of installedAssetPaths) {
    const response = await fetch(`${ui.url}${assetPath}`);
    const expectedType = assetPath.endsWith('.css') ? 'text/css' : 'text/javascript';

    if (response.status !== 200 || !response.headers.get('content-type')?.startsWith(expectedType)) {
      throw new Error(`${assetPath} was not served with ${expectedType}.`);
    }
  }

  const scenariosResponse = await fetch(`${ui.url}/api/scenarios`);
  const scenarios = await scenariosResponse.json();
  if (scenariosResponse.status !== 200 || !scenarios.scenarios?.some((scenario) => scenario.id === 'smoke')) {
    throw new Error('Installed UI did not discover the smoke scenario.');
  }

  const runResponse = await fetch(`${ui.url}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'validate', scenario: 'smoke' }),
  });
  const run = await runResponse.json();
  if (runResponse.status !== 200 || typeof run.runId !== 'string') {
    throw new Error('Installed UI did not start the validate run.');
  }

  const eventsResponse = await fetch(`${ui.url}/api/runs/${run.runId}/events`, {
    headers: { accept: 'text/event-stream' },
    signal: AbortSignal.timeout(30_000),
  });
  const events = await eventsResponse.text();
  if (eventsResponse.status !== 200 || !events.includes('event: done\n') ||
      !events.includes('data: {"status":"passed","exitCode":0}')) {
    throw new Error('Installed UI validate SSE did not finish with passed status.');
  }

  console.log(`Packed React UI smoke passed (${installedAssetPaths.length} assets).`);
} finally {
  await ui?.close();
  await rm(workspace, { recursive: true, force: true });
}

function readAssetPaths(html) {
  const assetPaths = [...html.matchAll(/(?:src|href)="(\/ui-assets\/[^"?]+)(?:\?[^" ]*)?"/g)]
    .map((match) => match[1]);
  const hashedAsset = /-[A-Za-z0-9_-]{6,}\.(?:js|css)$/;

  if (!assetPaths.some((assetPath) => assetPath.endsWith('.js') && hashedAsset.test(assetPath)) ||
      !assetPaths.some((assetPath) => assetPath.endsWith('.css') && hashedAsset.test(assetPath))) {
    throw new Error('React UI index must reference hashed JavaScript and CSS assets.');
  }

  return assetPaths;
}

function toPackageAssetPath(assetPath) {
  return `dist/cli/ui/app/${assetPath.slice('/ui-assets/'.length)}`;
}

async function writeFixture(directory) {
  await Promise.all([
    writeFile(
      path.join(directory, 'config.yaml'),
      [
        'defaultModule: app',
        'modules:',
        '  app:',
        '    snapshot: openapi/app.openapi.yaml',
        '',
      ].join('\n'),
      'utf8',
    ),
    writeFile(
      path.join(directory, 'openapi/app.openapi.yaml'),
      [
        'openapi: 3.0.3',
        'info:',
        '  title: Packaged UI smoke',
        '  version: 1.0.0',
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
    ),
    writeFile(
      path.join(directory, 'scenarios/smoke.yaml'),
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
    ),
  ]);
}
