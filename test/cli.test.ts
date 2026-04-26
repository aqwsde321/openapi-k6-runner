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

describe('openapi-k6 CLI', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-cli-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('creates a placeholder output file when required options are provided', async () => {
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
    expect(output).toContain(`// scenario: ${path.join(workspace, 'scenario.yaml')}`);
    expect(output).toContain(`// openapi: ${path.join(workspace, 'openapi.yaml')}`);
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

  it('includes BASE_URL from .env in the placeholder output', async () => {
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
});
