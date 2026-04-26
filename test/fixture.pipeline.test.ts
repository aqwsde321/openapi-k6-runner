import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(testDir, 'fixtures');

function createSink(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

describe('target project fixture pipeline', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-fixture-pipeline-'));
    await mkdir(path.join(workspace, 'load-tests/scenarios'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/openapi'), { recursive: true });
    await mkdir(path.join(workspace, 'load-tests/generated'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('runs sync and generate with the target project fixture layout', async () => {
    await copyScenarioFixture('login-order-flow.yaml');
    await copyOpenApiFixture('store.openapi.yaml');
    await copyConfigFixture();

    await runCli(
      [
        'sync',
        '--config',
        'load-tests/config.yaml',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    await runCli(
      [
        'generate',
        '--config',
        'load-tests/config.yaml',
        '--scenario',
        'load-tests/scenarios/login-order-flow.yaml',
        '--write',
        'load-tests/generated/login-order-flow.k6.js',
      ],
      { cwd: workspace, stdout: createSink(), stderr: createSink() },
    );

    const generatedPath = path.join(workspace, 'load-tests/generated/login-order-flow.k6.js');
    const generated = await readFile(generatedPath, 'utf8');
    const expected = await readFile(
      path.join(fixturesRoot, 'expected/login-order-flow.k6.js'),
      'utf8',
    );
    const catalog = JSON.parse(
      await readFile(path.join(workspace, 'load-tests/openapi/catalog.json'), 'utf8'),
    ) as { operations: Array<Record<string, unknown>> };

    expect(generated).toBe(expected);
    expect(catalog.operations).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/auth/login',
        operationId: 'loginUser',
        tags: ['auth'],
        hasRequestBody: true,
      }),
      expect.objectContaining({
        method: 'POST',
        path: '/orders',
        operationId: 'createOrder',
        tags: ['orders'],
        hasRequestBody: true,
      }),
      expect.objectContaining({
        method: 'GET',
        path: '/orders/{orderId}',
        operationId: 'getOrder',
        tags: ['orders'],
        hasRequestBody: false,
      }),
    ]);
    expectValidJavaScript(generatedPath);
  });

  it('fails clearly when a fixture scenario references an operation missing from the snapshot', async () => {
    await copyScenarioFixture('login-order-flow.yaml');
    await writeFile(
      path.join(workspace, 'load-tests/openapi/dev.openapi.json'),
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Broken Fixture API', version: '1.0.0' },
        servers: [{ url: 'https://api.fixture.local' }],
        paths: {
          '/auth/login': {
            post: {
              operationId: 'loginUser',
              responses: { 200: { description: 'OK' } },
            },
          },
        },
      }),
      'utf8',
    );

    await expect(
      runCli(
        [
          'generate',
          '--scenario',
          'load-tests/scenarios/login-order-flow.yaml',
          '--openapi',
          'load-tests/openapi/dev.openapi.json',
          '--write',
          'load-tests/generated/login-order-flow.k6.js',
        ],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toThrow('step "create-order": operationId "createOrder" was not found');
  });

  async function copyScenarioFixture(fileName: string): Promise<void> {
    await cp(
      path.join(fixturesRoot, 'scenarios', fileName),
      path.join(workspace, 'load-tests/scenarios', fileName),
    );
  }

  async function copyOpenApiFixture(fileName: string): Promise<void> {
    await cp(
      path.join(fixturesRoot, 'openapi', fileName),
      path.join(workspace, 'load-tests/openapi', fileName),
    );
  }

  async function copyConfigFixture(): Promise<void> {
    await cp(
      path.join(fixturesRoot, 'config.yaml'),
      path.join(workspace, 'load-tests/config.yaml'),
    );
  }
});

function expectValidJavaScript(scriptPath: string): void {
  const result = spawnSync(process.execPath, ['--check', scriptPath], {
    encoding: 'utf8',
  });

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
}
