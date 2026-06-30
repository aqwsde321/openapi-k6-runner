import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SuiteParseError,
  parseSuiteFile,
  parseSuiteSource,
} from '../src/parser/suite.parser.js';

describe('suite parser', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-suite-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('parses a valid YAML suite file', async () => {
    await mkdir(path.join(workspace, 'suites'), { recursive: true });
    const suitePath = path.join(workspace, 'suites/smoke.yaml');
    await writeFile(
      suitePath,
      [
        'name: smoke',
        'scenarios:',
        '  - auth/login',
        '  - post/create',
        '',
      ].join('\n'),
      'utf8',
    );

    const suite = await parseSuiteFile(suitePath);

    expect(suite).toEqual({
      name: 'smoke',
      scenarios: ['auth/login', 'post/create'],
    });
  });

  it('rejects invalid scenario keys', () => {
    expect(() =>
      parseSuiteSource([
        'name: invalid-suite',
        'scenarios:',
        '  - auth/login.yaml',
        '',
      ].join('\n')),
    ).toThrow(SuiteParseError);

    expect(() =>
      parseSuiteSource([
        'name: invalid-suite',
        'scenarios:',
        '  - ../auth/login',
        '',
      ].join('\n')),
    ).toThrow('scenarios[0] must be a scenario key without empty, . or .. segments');
  });

  it('rejects duplicate scenario keys', () => {
    expect(() =>
      parseSuiteSource([
        'name: duplicate-suite',
        'scenarios:',
        '  - auth/login',
        '  - auth/login',
        '',
      ].join('\n')),
    ).toThrow('scenarios must not contain duplicate scenario key "auth/login"');
  });
});
