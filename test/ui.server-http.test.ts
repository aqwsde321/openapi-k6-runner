import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runUiServerCommand, type UiResult } from '../src/cli/ui/server.js';

function createSink(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

describe('React UI asset server', () => {
  let workspace: string;
  let appDir: string;
  let ui: UiResult | undefined;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-ui-assets-'));
    appDir = path.join(workspace, 'app');
    await mkdir(path.join(appDir, 'assets'), { recursive: true });
    await writeFile(
      path.join(workspace, 'config.yaml'),
      'defaultModule: app\nmodules:\n  app:\n    baseUrl: http://127.0.0.1\n',
      'utf8',
    );
    await writeFile(path.join(appDir, 'index.html'), '<!doctype html><title>React preview</title>', 'utf8');
    await writeFile(path.join(appDir, 'assets/app.js'), 'console.log("preview");\n', 'utf8');
    await writeFile(path.join(appDir, 'assets/app.css'), 'body {}\n', 'utf8');
    await writeFile(path.join(appDir, 'assets/unknown.txt'), 'not public\n', 'utf8');
    await writeFile(path.join(workspace, 'outside.txt'), 'outside sentinel\n', 'utf8');

    ui = await runUiServerCommand(
      { config: 'config.yaml', port: '0' },
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
      { runCli: async () => {}, uiAppDir: appDir },
    );
  });

  afterEach(async () => {
    await ui?.close();
    await rm(workspace, { recursive: true, force: true });
  });

  it('serves the preview and only approved built assets', async () => {
    for (const pathname of ['/', '/index.html', '/next', '/next/', '/next/index.html']) {
      const response = await fetch(`${ui?.url}${pathname}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(await response.text()).toContain('React preview');
    }

    const javascript = await fetch(`${ui?.url}/ui-assets/assets/app.js`);
    expect(javascript.status).toBe(200);
    expect(javascript.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(javascript.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(javascript.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await javascript.text()).toContain('preview');

    const stylesheet = await fetch(`${ui?.url}/ui-assets/assets/app.css`);
    expect(stylesheet.status).toBe(200);
    expect(stylesheet.headers.get('content-type')).toBe('text/css; charset=utf-8');

    for (const pathname of [
      '/ui-assets/missing.js',
      '/ui-assets/.env',
      '/ui-assets/%2Eenv',
      '/ui-assets/assets/.secret.js',
      '/ui-assets/assets/unknown.txt',
      '/ui-assets/..%2Foutside.txt',
      '/ui-assets/..%5Coutside.txt',
    ]) {
      const response = await fetch(`${ui?.url}${pathname}`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('outside sentinel');
    }

    for (const pathname of ['/legacy', '/legacy/', '/legacy/index.html']) {
      const legacy = await fetch(`${ui?.url}${pathname}`);
      expect(legacy.status).toBe(200);
      expect(await legacy.text()).toContain('openapi-k6 UI');
    }

    for (const pathname of ['/', '/next/', '/legacy/']) {
      const post = await fetch(`${ui?.url}${pathname}`, { method: 'POST' });
      expect(post.status).toBe(404);
    }

    const missingRun = await fetch(`${ui?.url}/api/runs/missing/events`);
    expect(missingRun.status).toBe(404);

    const missingRunStream = await fetch(`${ui?.url}/api/runs/missing/events`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(missingRunStream.status).toBe(200);
    expect(missingRunStream.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(await missingRunStream.text()).toContain(
      'data: {"status":"failed","exitCode":1,"error":"UI 서버가 재시작되어 진행 중이던 실행을 이어갈 수 없습니다."}',
    );
  });
});
