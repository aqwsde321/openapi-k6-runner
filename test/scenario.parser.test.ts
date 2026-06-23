import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
        'description: |',
        '  로그인 후 주문을 생성하는 흐름입니다.',
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
      description: '로그인 후 주문을 생성하는 흐름입니다.\n',
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

  it('rejects non-string scenario descriptions', () => {
    expect(() =>
      parseScenarioSource([
        'name: invalid-description',
        'description:',
        '  value: object',
        'steps:',
        '  - id: health',
        '    api:',
        '      operationId: getHealth',
        '',
      ].join('\n')),
    ).toThrowError('<inline>: description must be a string');
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

  it('expands included scenario steps from relative files', async () => {
    const scenarioPath = path.join(workspace, 'smoke.yaml');
    await mkdir(path.join(workspace, 'partials'), { recursive: true });
    await writeFile(
      path.join(workspace, 'partials/login.yaml'),
      [
        'steps:',
        '  - id: login',
        '    api:',
        '      operationId: loginUser',
        '    extract:',
        '      token:',
        '        from: $.token',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      scenarioPath,
      [
        'name: included-flow',
        'steps:',
        '  - include: ./partials/login.yaml',
        '  - id: get-me',
        '    api:',
        '      operationId: getMe',
        '    request:',
        '      headers:',
        '        Authorization: "Bearer {{token}}"',
        '',
      ].join('\n'),
      'utf8',
    );

    const scenario = await parseScenarioFile(scenarioPath);

    expect(scenario).toEqual({
      name: 'included-flow',
      steps: [
        {
          id: 'login',
          api: { operationId: 'loginUser' },
          extract: { token: { from: '$.token' } },
        },
        {
          id: 'get-me',
          api: { operationId: 'getMe' },
          request: {
            headers: { Authorization: 'Bearer {{token}}' },
          },
        },
      ],
    });
  });

  it('expands scenario-root use steps from another folder', async () => {
    const scenarioRootDir = path.join(workspace, 'scenarios');
    const scenarioPath = path.join(scenarioRootDir, 'order/create.yaml');
    await mkdir(path.join(scenarioRootDir, 'auth'), { recursive: true });
    await mkdir(path.dirname(scenarioPath), { recursive: true });
    await writeFile(
      path.join(scenarioRootDir, 'auth/login.yaml'),
      [
        'name: login',
        'steps:',
        '  - id: login',
        '    api:',
        '      operationId: loginUser',
        '    extract:',
        '      token:',
        '        from: $.token',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      scenarioPath,
      [
        'name: order-create',
        'steps:',
        '  - use: auth/login',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '    request:',
        '      headers:',
        '        Authorization: "Bearer {{token}}"',
        '',
      ].join('\n'),
      'utf8',
    );

    const scenario = await parseScenarioFile(scenarioPath, { scenarioRootDir });

    expect(scenario).toEqual({
      name: 'order-create',
      steps: [
        {
          id: 'login',
          api: { operationId: 'loginUser' },
          extract: { token: { from: '$.token' } },
        },
        {
          id: 'create-order',
          api: { operationId: 'createOrder' },
          request: {
            headers: { Authorization: 'Bearer {{token}}' },
          },
        },
      ],
    });
  });

  it('rejects dotted or extension-bearing scenario-root use keys', async () => {
    const scenarioRootDir = path.join(workspace, 'scenarios');
    const scenarioPath = path.join(scenarioRootDir, 'order/create.yaml');
    await mkdir(path.dirname(scenarioPath), { recursive: true });
    await writeFile(
      scenarioPath,
      [
        'name: dotted-use',
        'steps:',
        '  - use: auth/login.v2',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath, { scenarioRootDir }))
      .rejects.toThrowError('steps[0].use must be a scenario key without a file extension');

    await writeFile(
      scenarioPath,
      [
        'name: extension-use',
        'steps:',
        '  - use: auth/login.yaml',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath, { scenarioRootDir }))
      .rejects.toThrowError('steps[0].use must be a scenario key without a file extension');
  });

  it('fails when included and local steps duplicate an id', async () => {
    const scenarioPath = path.join(workspace, 'smoke.yaml');
    await writeFile(
      path.join(workspace, 'login.yaml'),
      [
        'steps:',
        '  - id: login',
        '    api:',
        '      operationId: loginUser',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      scenarioPath,
      [
        'name: duplicated-include',
        'steps:',
        '  - include: ./login.yaml',
        '  - id: login',
        '    api:',
        '      operationId: loginAgain',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath)).rejects.toThrowError('steps[1]: duplicate step id "login"');
  });

  it('rejects include cycles and include paths outside the entry scenario directory', async () => {
    const scenarioPath = path.join(workspace, 'smoke.yaml');
    await mkdir(path.join(workspace, 'partials'), { recursive: true });
    await writeFile(
      scenarioPath,
      [
        'name: cycle',
        'steps:',
        '  - include: ./partials/a.yaml',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(path.join(workspace, 'partials/a.yaml'), 'steps:\n  - include: ../smoke.yaml\n', 'utf8');

    await expect(parseScenarioFile(scenarioPath)).rejects.toThrowError('include cycle detected');

    await writeFile(
      scenarioPath,
      [
        'name: outside',
        'steps:',
        '  - include: ../outside.yaml',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath)).rejects.toThrowError('include must stay inside the entry scenario directory');
  });

  it('rejects use cycles and paths outside the scenario root directory', async () => {
    const scenarioRootDir = path.join(workspace, 'scenarios');
    const scenarioPath = path.join(scenarioRootDir, 'order/create.yaml');
    await mkdir(path.join(scenarioRootDir, 'auth'), { recursive: true });
    await mkdir(path.dirname(scenarioPath), { recursive: true });
    await writeFile(
      scenarioPath,
      [
        'name: cycle',
        'steps:',
        '  - use: auth/login',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(scenarioRootDir, 'auth/login.yaml'),
      [
        'steps:',
        '  - use: order/create',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath, { scenarioRootDir })).rejects.toThrowError('include cycle detected');

    await writeFile(
      scenarioPath,
      [
        'name: outside',
        'steps:',
        '  - use: ../auth/login',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath, { scenarioRootDir }))
      .rejects.toThrowError('steps[0].use must be a scenario key without empty, . or .. segments');

    await writeFile(
      scenarioPath,
      [
        'name: absolute',
        'steps:',
        `  - use: ${path.join(scenarioRootDir, 'auth/login')}`,
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath, { scenarioRootDir }))
      .rejects.toThrowError('steps[0].use must be relative to the scenario root directory');
  });

  it('fails clearly when an included file is missing', async () => {
    const scenarioPath = path.join(workspace, 'smoke.yaml');
    await writeFile(
      scenarioPath,
      [
        'name: missing-include',
        'steps:',
        '  - include: ./missing.yaml',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath)).rejects.toThrowError('missing.yaml: scenario file was not found');
  });

  it('requires a scenario root for use steps', async () => {
    const scenarioPath = path.join(workspace, 'smoke.yaml');
    await writeFile(
      scenarioPath,
      [
        'name: missing-root',
        'steps:',
        '  - use: auth/login',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath)).rejects.toThrowError('steps[0].use requires scenarioRootDir');
  });

  it('rejects include steps when parsing inline sources', () => {
    expect(() =>
      parseScenarioSource([
        'name: inline-include',
        'steps:',
        '  - include: ./login.yaml',
        '',
      ].join('\n')),
    ).toThrowError('<inline>: steps[0]: include steps require parseScenarioFile');
  });

  it('parses api.module on step API references', () => {
    const scenario = parseScenarioSource([
      'name: cross-module',
      'steps:',
      '  - id: login',
      '    api:',
      '      module: auth',
      '      operationId: loginUser',
      '',
    ].join('\n'));

    expect(scenario.steps[0]?.api).toEqual({
      module: 'auth',
      operationId: 'loginUser',
    });
  });

  it('parses top-level scenario vars', () => {
    const scenario = parseScenarioSource([
      'name: vars-flow',
      'vars:',
      '  sku: ABC-001',
      '  tenantId: tenant-main',
      '  quantity: 2',
      'steps:',
      '  - id: create-order',
      '    api:',
      '      operationId: createOrder',
      '    request:',
      '      body:',
      '        sku: "{{vars.sku}}"',
      '',
    ].join('\n'));

    expect(scenario.vars).toEqual({
      sku: 'ABC-001',
      tenantId: 'tenant-main',
      quantity: 2,
    });
  });

  it('loads scenario fixture vars before top-level vars', async () => {
    await mkdir(path.join(workspace, 'fixtures'), { recursive: true });
    await writeFile(
      path.join(workspace, 'fixtures/dev.yaml'),
      [
        'loginId: tester@example.com',
        'sku: FIXTURE-SKU',
        'tenantId: tenant-main',
        '',
      ].join('\n'),
      'utf8',
    );

    const scenarioPath = path.join(workspace, 'scenario.yaml');
    await writeFile(
      scenarioPath,
      [
        'name: fixture-vars-flow',
        'fixtures:',
        '  - ./fixtures/dev.yaml',
        'vars:',
        '  sku: INLINE-SKU',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '    request:',
        '      body:',
        '        loginId: "{{vars.loginId}}"',
        '        sku: "{{vars.sku}}"',
        '',
      ].join('\n'),
      'utf8',
    );

    const scenario = await parseScenarioFile(scenarioPath);

    expect(scenario.vars).toEqual({
      loginId: 'tester@example.com',
      sku: 'INLINE-SKU',
      tenantId: 'tenant-main',
    });
  });

  it('fails when inline source declares scenario fixtures', () => {
    expect(() =>
      parseScenarioSource([
        'name: inline-fixtures',
        'fixtures:',
        '  - ./fixtures/dev.yaml',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '',
      ].join('\n')),
    ).toThrowError('<inline>: fixtures require parseScenarioFile');
  });

  it('fails when scenario fixture path leaves the entry scenario directory', async () => {
    await writeFile(
      path.join(workspace, 'scenario.yaml'),
      [
        'name: outside-fixture',
        'fixtures:',
        '  - ../dev.yaml',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(path.join(workspace, 'scenario.yaml'))).rejects.toThrowError('fixtures[0] must stay inside the entry scenario directory');
  });

  it('fails when a scenario fixture file is missing', async () => {
    await writeFile(
      path.join(workspace, 'scenario.yaml'),
      [
        'name: missing-fixture',
        'fixtures:',
        '  - ./fixtures/dev.yaml',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(path.join(workspace, 'scenario.yaml'))).rejects.toThrowError('fixtures/dev.yaml: fixture file was not found');
  });

  it('fails when scenario fixture vars cannot be referenced by template syntax', async () => {
    await mkdir(path.join(workspace, 'fixtures'), { recursive: true });
    await writeFile(path.join(workspace, 'fixtures/dev.yaml'), 'order-id: order-1\n', 'utf8');
    await writeFile(
      path.join(workspace, 'scenario.yaml'),
      [
        'name: invalid-fixture-vars',
        'fixtures:',
        '  - ./fixtures/dev.yaml',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(path.join(workspace, 'scenario.yaml'))).rejects.toThrowError('fixture.order-id must match ^[A-Za-z_$][A-Za-z0-9_$]*$ for {{vars.NAME}} references');
  });

  it('fails when vars use reserved JavaScript prototype names', () => {
    expect(() =>
      parseScenarioSource([
        'name: reserved-vars',
        'vars:',
        '  __proto__: polluted',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '',
      ].join('\n')),
    ).toThrowError('<inline>: vars.__proto__ is reserved and cannot be referenced as {{vars.__proto__}}');
  });

  it('fails when vars cannot be referenced by template syntax', () => {
    expect(() =>
      parseScenarioSource([
        'name: invalid-vars',
        'vars:',
        '  order-id: order-1',
        'steps:',
        '  - id: create-order',
        '    api:',
        '      operationId: createOrder',
        '',
      ].join('\n')),
    ).toThrowError('<inline>: vars.order-id must match ^[A-Za-z_$][A-Za-z0-9_$]*$ for {{vars.NAME}} references');
  });

  it('fails when an included scenario file defines vars', async () => {
    const scenarioPath = path.join(workspace, 'smoke.yaml');
    await writeFile(
      path.join(workspace, 'login.yaml'),
      [
        'vars:',
        '  sku: ABC-001',
        'steps:',
        '  - id: login',
        '    api:',
        '      operationId: loginUser',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      scenarioPath,
      [
        'name: included-vars',
        'steps:',
        '  - include: ./login.yaml',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath)).rejects.toThrowError('included scenario files must not define vars');
  });

  it('fails when an included scenario file defines fixtures', async () => {
    const scenarioPath = path.join(workspace, 'smoke.yaml');
    await writeFile(
      path.join(workspace, 'login.yaml'),
      [
        'fixtures:',
        '  - ./fixtures/dev.yaml',
        'steps:',
        '  - id: login',
        '    api:',
        '      operationId: loginUser',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      scenarioPath,
      [
        'name: included-fixtures',
        'steps:',
        '  - include: ./login.yaml',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(parseScenarioFile(scenarioPath)).rejects.toThrowError('included scenario files must not define fixtures');
  });

  it('parses multipart request fields and files', () => {
    const scenario = parseScenarioSource([
      'name: upload-product-image',
      'steps:',
      '  - id: upload-image',
      '    api:',
      '      operationId: uploadProductImage',
      '    request:',
      '      headers:',
      '        Authorization: "Bearer {{token}}"',
      '      multipart:',
      '        fields:',
      '          title: Main image',
      '          sortOrder: 1',
      '        files:',
      '          image:',
      '            path: fixtures/product.png',
      '            filename: product.png',
      '            contentType: image/png',
      '',
    ].join('\n'));

    expect(scenario.steps[0]?.request).toEqual({
      headers: { Authorization: 'Bearer {{token}}' },
      multipart: {
        fields: {
          title: 'Main image',
          sortOrder: 1,
        },
        files: {
          image: {
            path: 'fixtures/product.png',
            filename: 'product.png',
            contentType: 'image/png',
          },
        },
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

  it('fails when api.module is invalid', () => {
    expect(() =>
      parseScenarioSource([
        'name: invalid-module',
        'steps:',
        '  - id: login',
        '    api:',
        '      module: "   "',
        '      operationId: loginUser',
        '',
      ].join('\n')),
    ).toThrowError('<inline>: steps[0].api.module must not be empty');

    expect(() =>
      parseScenarioSource([
        'name: invalid-module',
        'steps:',
        '  - id: login',
        '    api:',
        '      module: 123',
        '      operationId: loginUser',
        '',
      ].join('\n')),
    ).toThrowError('<inline>: steps[0].api.module must be a string');
  });

  it('omits blank optional api fields before resolver sees them', () => {
    const scenario = parseScenarioSource(
      [
        'name: blank-fields',
        'steps:',
        '  - id: get-users',
        '    api:',
        '      operationId: "   "',
        '      method: " GET "',
        '      path: " /users "',
        '',
      ].join('\n'),
    );

    expect(scenario.steps[0]?.api).toEqual({ method: 'GET', path: '/users' });
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

  it('fails when body and multipart are used together', () => {
    expect(() =>
      parseScenarioSource([
        'name: invalid-upload',
        'steps:',
        '  - id: upload',
        '    api:',
        '      method: POST',
        '      path: /upload',
        '    request:',
        '      body:',
        '        name: test',
        '      multipart:',
        '        files:',
        '          file:',
        '            path: fixtures/file.bin',
        '',
      ].join('\n')),
    ).toThrowError('<inline>: steps[0].request: request.body and request.multipart cannot be used together');
  });

  it('fails when multipart file spec is invalid', () => {
    expect(() =>
      parseScenarioSource([
        'name: invalid-upload',
        'steps:',
        '  - id: upload',
        '    api:',
        '      method: POST',
        '      path: /upload',
        '    request:',
        '      multipart:',
        '        files:',
        '          file:',
        '            filename: file.bin',
        '',
      ].join('\n')),
    ).toThrowError('<inline>: steps[0].request.multipart.files.file.path must be a string');

    expect(() =>
      parseScenarioSource([
        'name: invalid-upload',
        'steps:',
        '  - id: upload',
        '    api:',
        '      method: POST',
        '      path: /upload',
        '    request:',
        '      multipart:',
        '        files:',
        '          file:',
        '            path: ../secrets/file.bin',
        '',
      ].join('\n')),
    ).toThrowError('<inline>: steps[0].request.multipart.files.file.path must stay inside the workspace directory');
  });
});
