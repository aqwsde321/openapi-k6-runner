import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateK6Script, K6GenerationError } from '../src/compiler/k6.generator.js';
import type { ASTScenario } from '../src/core/types.js';
import { compileValueExpression, TemplateCompileError } from '../src/core/template.js';
import { compileJsonPathSegments, JsonPathCompileError } from '../src/utils/jsonpath.js';

describe('k6 generator', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-generator-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('generates a syntactically valid k6 script snapshot', async () => {
    const script = generateK6Script(
      {
        name: 'health',
        steps: [
          {
            id: 'health',
            method: 'GET',
            path: '/health',
            pathParameters: [],
            request: {},
            condition: 'status == 200',
          },
        ],
      },
      { baseUrl: 'https://api.test.local' },
    );

    expect(script).toMatchInlineSnapshot(`
      "import http from 'k6/http';
      import { check } from 'k6';

      const BASE_URL = __ENV.BASE_URL || "https://api.test.local";

      function joinUrl(baseUrl, endpointPath) {
        return \`\${baseUrl.replace(/\\/+$/, '')}/\${endpointPath.replace(/^\\/+/, '')}\`;
      }

      export default function () {
        const context = {};

        const url0 = joinUrl(BASE_URL, \`/health\`);
        const res0 = http.get(url0);
        check(res0, {
          "health status == 200": (res) => res.status === 200,
        });
      }
      "
    `);
    await expectValidJavaScript(workspace, script);
  });

  it('generates supported HTTP methods, body, headers, pathParams, and query', async () => {
    const script = generateK6Script(createWorkflowAst(), {
      baseUrl: 'https://api.test.local',
    });

    expect(script).toContain('let url0 = joinUrl(BASE_URL, `/users/${encodeURIComponent(String(context.userId))}`);');
    expect(script).toContain('url0 = appendQuery(url0, { "includePosts": true, "trace": context.traceId });');
    expect(script).toContain('const params0 = { headers: { "Authorization": `Bearer ${context.token}` } };');
    expect(script).toContain('const res0 = http.get(url0, params0);');
    expect(script).toContain('const body1 = JSON.stringify({ "name": "tester" });');
    expect(script).toContain('const params1 = { headers: { "Content-Type": "application/json" } };');
    expect(script).toContain('const res1 = http.post(url1, body1, params1);');
    expect(script).toContain('const res2 = http.put(url2, body2, params2);');
    expect(script).toContain('const res3 = http.patch(url3, body3, params3);');
    expect(script).toContain('const res4 = http.del(url4);');
    await expectValidJavaScript(workspace, script);
  });

  it('compiles template values recursively without replacing missing values with empty strings', () => {
    expect(compileValueExpression('{{token}}')).toBe('context.token');
    expect(compileValueExpression('{{env.API_TOKEN}}')).toBe('__ENV.API_TOKEN');
    expect(compileValueExpression('Bearer {{token}}')).toBe('`Bearer ${context.token}`');
    expect(compileValueExpression('Bearer {{env.API_TOKEN}}')).toBe('`Bearer ${__ENV.API_TOKEN}`');
    expect(compileValueExpression({
      headers: ['X-Trace-{{traceId}}'],
      body: { userId: '{{userId}}', password: '{{env.USER_PASSWORD}}' },
    })).toBe('{ "headers": [`X-Trace-${context.traceId}`], "body": { "userId": context.userId, "password": __ENV.USER_PASSWORD } }');
    expect(() => compileValueExpression('Bearer {{bad-name}}')).toThrowError(TemplateCompileError);
    expect(() => compileValueExpression('{{env.bad-name}}')).toThrowError(TemplateCompileError);
  });

  it('generates k6 runtime environment references from env templates', async () => {
    const script = generateK6Script(
      {
        name: 'env-login',
        steps: [
          {
            id: 'login',
            method: 'POST',
            path: '/login',
            pathParameters: [],
            request: {
              headers: { 'X-Client': '{{env.CLIENT_ID}}' },
              body: {
                loginId: '{{env.LOGIN_ID}}',
                password: '{{env.LOGIN_PASSWORD}}',
              },
            },
          },
        ],
      },
      { baseUrl: 'https://api.test.local' },
    );

    expect(script).toContain('const body0 = JSON.stringify({ "loginId": __ENV.LOGIN_ID, "password": __ENV.LOGIN_PASSWORD });');
    expect(script).toContain('const params0 = { headers: { "Content-Type": "application/json", "X-Client": __ENV.CLIENT_ID } };');
    await expectValidJavaScript(workspace, script);
  });

  it('compiles MVP JSONPath expressions and rejects unsupported expressions', () => {
    expect(compileJsonPathSegments('$.token')).toEqual(['token']);
    expect(compileJsonPathSegments('$.data.id')).toEqual(['data', 'id']);
    expect(compileJsonPathSegments('$.items[0].id')).toEqual(['items', 0, 'id']);
    expect(() => compileJsonPathSegments('$.items[*].id')).toThrowError(JsonPathCompileError);
  });

  it('generates extract and condition code immediately after a step', () => {
    const script = generateK6Script(
      {
        name: 'login',
        steps: [
          {
            id: 'login',
            method: 'POST',
            path: '/login',
            pathParameters: [],
            request: { body: { username: 'tester' } },
            extract: {
              token: { from: '$.token' },
              firstItemId: { from: '$.items[0].id' },
              'order-id': { from: '$.data.id' },
            },
            condition: 'status < 300',
          },
        ],
      },
      { baseUrl: 'https://api.test.local' },
    );

    expect(script).toContain('const res0Json = res0.json();');
    expect(script).toContain('context.token = readJsonPath(res0Json, ["token"]);');
    expect(script).toContain('context.firstItemId = readJsonPath(res0Json, ["items",0,"id"]);');
    expect(script).toContain('context["order-id"] = readJsonPath(res0Json, ["data","id"]);');
    expect(script).toContain('"login status < 300": (res) => res.status < 300,');
  });

  it('fails for unsupported condition expressions and missing baseUrl', () => {
    expect(() =>
      generateK6Script(
        {
          name: 'invalid-condition',
          steps: [
            {
              id: 'invalid',
              method: 'GET',
              path: '/invalid',
              pathParameters: [],
              request: {},
              condition: 'body.ok == true',
            },
          ],
        },
        { baseUrl: 'https://api.test.local' },
      ),
    ).toThrowError(new K6GenerationError('step "invalid": unsupported condition "body.ok == true"'));

    expect(() =>
      generateK6Script({ name: 'missing-base-url', steps: [] }),
    ).toThrowError(new K6GenerationError('BASE_URL is required to generate a k6 script'));
  });
});

function createWorkflowAst(): ASTScenario {
  return {
    name: 'method-coverage',
    steps: [
      {
        id: 'get-user',
        method: 'GET',
        path: '/users/{userId}',
        pathParameters: [{ name: 'userId', in: 'path' }],
        request: {
          pathParams: { userId: '{{userId}}' },
          query: { includePosts: true, trace: '{{traceId}}' },
          headers: { Authorization: 'Bearer {{token}}' },
        },
      },
      {
        id: 'create-user',
        method: 'POST',
        path: '/users',
        pathParameters: [],
        request: {
          body: { name: 'tester' },
        },
      },
      {
        id: 'replace-user',
        method: 'PUT',
        path: '/users/{userId}',
        pathParameters: [{ name: 'userId', in: 'path' }],
        request: {
          pathParams: { userId: '{{userId}}' },
          body: { name: 'updated' },
        },
      },
      {
        id: 'update-user',
        method: 'PATCH',
        path: '/users/{userId}',
        pathParameters: [{ name: 'userId', in: 'path' }],
        request: {
          pathParams: { userId: '{{userId}}' },
          body: { active: false },
        },
      },
      {
        id: 'delete-user',
        method: 'DELETE',
        path: '/users/{userId}',
        pathParameters: [{ name: 'userId', in: 'path' }],
        request: {
          pathParams: { userId: '{{userId}}' },
        },
      },
    ],
  };
}

async function expectValidJavaScript(workspace: string, source: string): Promise<void> {
  const scriptPath = path.join(workspace, 'generated.js');
  await writeFile(scriptPath, source, 'utf8');

  const result = spawnSync(process.execPath, ['--check', scriptPath], {
    encoding: 'utf8',
  });

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
}
