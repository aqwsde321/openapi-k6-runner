import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runFile = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const appDir = path.join(projectRoot, 'dist/cli/ui/app');
const indexPath = path.join(appDir, 'index.html');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

await access(indexPath).catch(() => {
  throw new Error('React UI build was not found. Run pnpm build first.');
});

const html = await readFile(indexPath, 'utf8');
const assetPaths = [...html.matchAll(/(?:src|href)="(\/ui-assets\/[^"?]+)(?:\?[^" ]*)?"/g)]
  .map((match) => match[1]);

if (!assetPaths.some((assetPath) => assetPath.endsWith('.js')) ||
    !assetPaths.some((assetPath) => assetPath.endsWith('.css'))) {
  throw new Error('React UI index must reference hashed JavaScript and CSS assets.');
}

for (const assetPath of assetPaths) {
  await access(path.join(appDir, assetPath.slice('/ui-assets/'.length)));
}

const { stdout } = await runFile(npmCommand, ['pack', '--dry-run', '--json'], {
  cwd: projectRoot,
  maxBuffer: 10 * 1024 * 1024,
});
const packOutput = JSON.parse(stdout);
const packResults = Array.isArray(packOutput) ? packOutput : Object.values(packOutput);
const packedFiles = new Set(packResults.flatMap((result) => result.files.map((file) => file.path)));

for (const requiredPath of [
  'dist/cli/ui/app/index.html',
  ...assetPaths.map((assetPath) => `dist/cli/ui/app/${assetPath.slice('/ui-assets/'.length)}`),
]) {
  if (!packedFiles.has(requiredPath)) {
    throw new Error(`${requiredPath} is missing from the npm package.`);
  }
}

const workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-ui-assets-'));
let ui;

try {
  await writeFile(
    path.join(workspace, 'config.yaml'),
    'defaultModule: app\nmodules:\n  app:\n    baseUrl: http://127.0.0.1\n',
    'utf8',
  );
  const { runUiCommand } = await import(pathToFileURL(path.join(projectRoot, 'dist/cli/index.js')).href);
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  ui = await runUiCommand(
    { config: 'config.yaml', port: '0' },
    { cwd: workspace, stdout: sink, stderr: sink },
  );

  const indexResponse = await fetch(`${ui.url}/next/`);
  if (indexResponse.status !== 200 || !indexResponse.headers.get('content-type')?.startsWith('text/html')) {
    throw new Error('React UI index was not served with the HTML content type.');
  }

  for (const assetPath of assetPaths) {
    const response = await fetch(`${ui.url}${assetPath}`);
    const expectedType = assetPath.endsWith('.css') ? 'text/css' : 'text/javascript';

    if (response.status !== 200 || !response.headers.get('content-type')?.startsWith(expectedType)) {
      throw new Error(`${assetPath} was not served with ${expectedType}.`);
    }
  }
} finally {
  await ui?.close();
  await rm(workspace, { recursive: true, force: true });
}

console.log(`React UI asset smoke passed (${assetPaths.length} assets).`);
