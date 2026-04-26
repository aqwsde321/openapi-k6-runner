import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('fails when --openapi is missing', async () => {
    await expect(
      runCli(
        ['generate', '--scenario', 'scenario.yaml', '--write', 'generated/script.js'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
  });

  it('fails when --write is missing', async () => {
    await expect(
      runCli(
        ['generate', '--scenario', 'scenario.yaml', '--openapi', 'openapi.yaml'],
        { cwd: workspace, stdout: createSink(), stderr: createSink() },
      ),
    ).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
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
});
