import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ScenarioParseError,
  parseScenarioFile,
  parseScenarioSource,
} from '../src/parser/scenario.parser.js';

describe('scenario parser', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-scenario-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('parses a valid YAML scenario file', async () => {
    const scenarioPath = path.join(workspace, 'scenario.yaml');
    await writeFile(
      scenarioPath,
      [
        'name: login-and-order',
        'steps:',
        '  - id: login',
        '    api:',
        '      operationId: loginUser',
        '    request:',
        '      headers:',
        '        X-Trace-Id: trace-1',
        '      body:',
        '        username: tester',
        '    extract:',
        '      token:',
        '        from: $.token',
        '    condition: status == 200',
        '  - id: create-order',
        '    api:',
        '      method: POST',
        '      path: /orders',
        '',
      ].join('\n'),
      'utf8',
    );

    const scenario = await parseScenarioFile(scenarioPath);

    expect(scenario).toEqual({
      name: 'login-and-order',
      steps: [
        {
          id: 'login',
          api: { operationId: 'loginUser' },
          request: {
            headers: { 'X-Trace-Id': 'trace-1' },
            body: { username: 'tester' },
          },
          extract: { token: { from: '$.token' } },
          condition: 'status == 200',
        },
        {
          id: 'create-order',
          api: { method: 'POST', path: '/orders' },
        },
      ],
    });
  });

  it('parses a valid JSON scenario file', async () => {
    const scenarioPath = path.join(workspace, 'scenario.json');
    await writeFile(
      scenarioPath,
      JSON.stringify({
        name: 'get-user',
        steps: [
          {
            id: 'get-user',
            api: { method: 'GET', path: '/users/{id}' },
            request: {
              pathParams: { id: '{{userId}}' },
              query: { includePosts: true },
            },
          },
        ],
      }),
      'utf8',
    );

    const scenario = await parseScenarioFile(scenarioPath);

    expect(scenario.steps[0]).toEqual({
      id: 'get-user',
      api: { method: 'GET', path: '/users/{id}' },
      request: {
        pathParams: { id: '{{userId}}' },
        query: { includePosts: true },
      },
    });
  });

  it('fails when name is missing', () => {
    expect(() =>
      parseScenarioSource(
        [
          'steps:',
          '  - id: login',
          '    api:',
          '      operationId: loginUser',
          '',
        ].join('\n'),
      ),
    ).toThrowError(new ScenarioParseError('<inline>: name must be a string'));
  });

  it('fails when a step id is duplicated', () => {
    expect(() =>
      parseScenarioSource(
        [
          'name: duplicated',
          'steps:',
          '  - id: login',
          '    api:',
          '      operationId: loginUser',
          '  - id: login',
          '    api:',
          '      method: GET',
          '      path: /me',
          '',
        ].join('\n'),
      ),
    ).toThrowError('<inline>: steps[1]: duplicate step id "login"');
  });

  it('fails when api reference has neither operationId nor method and path', () => {
    expect(() =>
      parseScenarioSource(
        [
          'name: invalid-api',
          'steps:',
          '  - id: missing-api-reference',
          '    api:',
          '      method: GET',
          '',
        ].join('\n'),
      ),
    ).toThrowError(
      '<inline>: steps[0].api: api must include operationId or both method and path',
    );
  });

  it('fails when api is missing from a step', () => {
    expect(() =>
      parseScenarioSource(
        [
          'name: missing-api',
          'steps:',
          '  - id: login',
          '',
        ].join('\n'),
      ),
    ).toThrowError('<inline>: steps[0].api: api must be an object');
  });
});
