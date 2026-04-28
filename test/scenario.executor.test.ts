import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ASTScenario } from '../src/core/types.js';
import { executeAstScenario, formatScenarioExecutionReport } from '../src/executor/scenario.executor.js';

describe('scenario executor', () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()));
  });

  it('executes JSON requests, templates, extracts, path params, and query strings', async () => {
    const requests: Array<{ method: string; path: string; headers: Record<string, string>; body: string }> = [];

    const result = await executeAstScenario(loginOrderAst(), {
      baseUrl: 'https://api.test.local',
      env: {
        LOGIN_ID: 'tester@example.com',
        LOGIN_PASSWORD: 'local-secret',
      },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? 'GET';
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const body = typeof init?.body === 'string' ? init.body : '';
        requests.push({
          method,
          path: `${url.pathname}${url.search}`,
          headers,
          body,
        });

        if (method === 'POST' && url.pathname === '/auth/login') {
          return jsonResponse({ token: 'server-token' }, 200, 'OK');
        }

        if (method === 'POST' && url.pathname === '/orders') {
          return jsonResponse({ data: { id: 'order/1' } }, 201, 'Created');
        }

        if (method === 'GET' && url.pathname === '/orders/order%2F1' && url.search === '?includeItems=true') {
          return jsonResponse({ ok: true }, 200, 'OK');
        }

        return jsonResponse({ message: 'not found' }, 404, 'Not Found');
      },
    });
    const report = formatScenarioExecutionReport(result);

    expect(result.passed).toBe(true);
    expect(requests[0].body).toBe(JSON.stringify({
      username: 'tester@example.com',
      password: 'local-secret',
    }));
    expect(requests[1].headers.authorization).toBe('Bearer server-token');
    expect(requests[2].path).toBe('/orders/order%2F1?includeItems=true');
    expect(report).toContain('Result: PASS');
    expect(report).not.toContain('local-secret');
  });

  it('marks condition failures and includes the response body in the report', async () => {
    const result = await executeAstScenario({
      name: 'failing-health',
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
    }, {
      baseUrl: 'https://api.test.local',
      env: {},
      fetch: async () => jsonResponse({ message: 'boom' }, 500, 'Internal Server Error'),
    });
    const report = formatScenarioExecutionReport(result);

    expect(result.passed).toBe(false);
    expect(result.steps[0].condition).toEqual({ expression: 'status == 200', passed: false });
    expect(report).toContain('condition: status == 200 fail');
    expect(report).toContain('response body:');
    expect(report).toContain('"message":"boom"');
    expect(report).toContain('Result: FAIL');
  });

  it('records missing context template values as step failures', async () => {
    const result = await executeAstScenario({
      name: 'missing-context',
      steps: [
        {
          id: 'get-order',
          method: 'GET',
          path: '/orders/{orderId}',
          pathParameters: [],
          request: {
            pathParams: {
              orderId: '{{orderId}}',
            },
          },
        },
      ],
    }, { baseUrl: 'https://api.test.local', env: {} });

    expect(result.passed).toBe(false);
    expect(result.steps[0].error).toBe('Missing context.orderId for template "{{orderId}}"');
  });

  it('executes multipart upload requests with load-tests-relative fixture files', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-executor-'));
    cleanupTasks.push(() => rm(workspace, { recursive: true, force: true }));
    await mkdir(path.join(workspace, 'load-tests/fixtures'), { recursive: true });
    await writeFile(path.join(workspace, 'load-tests/fixtures/product.png'), 'fake-image', 'utf8');

    const requests: Array<{ form: FormData; url: string; method: string }> = [];

    const result = await executeAstScenario({
      name: 'upload-product-image',
      steps: [
        {
          id: 'upload-image',
          method: 'POST',
          path: '/products/{productId}/image',
          pathParameters: [],
          request: {
            pathParams: {
              productId: 'product-001',
            },
            multipart: {
              fields: {
                title: '{{env.IMAGE_TITLE}}',
              },
              files: {
                image: {
                  path: 'fixtures/product.png',
                  filename: 'product.png',
                  contentType: 'image/png',
                },
              },
            },
          },
          condition: 'status == 200',
        },
      ],
    }, {
      baseUrl: 'https://api.test.local',
      fileRootDir: path.join(workspace, 'load-tests'),
      env: {
        IMAGE_TITLE: 'Main image',
      },
      fetch: async (input, init) => {
        requests.push({
          form: init?.body as FormData,
          url: String(input),
          method: init?.method ?? 'GET',
        });
        return jsonResponse({ uploaded: true }, 200, 'OK');
      },
    });

    expect(result.passed).toBe(true);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe('https://api.test.local/products/product-001/image');
    expect(requests[0].form.get('title')).toBe('Main image');
    const image = requests[0].form.get('image');
    expect(image).toBeInstanceOf(File);
    expect((image as File).name).toBe('product.png');
    expect((image as File).type).toBe('image/png');
    expect(await (image as File).text()).toBe('fake-image');
  });
});

function loginOrderAst(): ASTScenario {
  return {
    name: 'login-order-flow',
    steps: [
      {
        id: 'login',
        method: 'POST',
        path: '/auth/login',
        pathParameters: [],
        request: {
          body: {
            username: '{{env.LOGIN_ID}}',
            password: '{{env.LOGIN_PASSWORD}}',
          },
        },
        extract: {
          token: { from: '$.token' },
        },
        condition: 'status == 200',
      },
      {
        id: 'create-order',
        method: 'POST',
        path: '/orders',
        pathParameters: [],
        request: {
          headers: {
            Authorization: 'Bearer {{token}}',
          },
          body: {
            sku: 'SKU-001',
            quantity: 1,
          },
        },
        extract: {
          orderId: { from: '$.data.id' },
        },
        condition: 'status == 201',
      },
      {
        id: 'get-order',
        method: 'GET',
        path: '/orders/{orderId}',
        pathParameters: [],
        request: {
          headers: {
            Authorization: 'Bearer {{token}}',
          },
          pathParams: {
            orderId: '{{orderId}}',
          },
          query: {
            includeItems: true,
          },
        },
        condition: 'status < 300',
      },
    ],
  };
}

function jsonResponse(value: unknown, status: number, statusText: string): Response {
  return new Response(JSON.stringify(value), {
    status,
    statusText,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
