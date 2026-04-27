import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildOpenApiCatalog,
  syncOpenApiSnapshot,
} from '../src/openapi/openapi.catalog.js';
import { parseOpenApiFile } from '../src/openapi/openapi.parser.js';

describe('OpenAPI snapshot and catalog', () => {
  let workspace: string;
  let server: Server | undefined;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-catalog-'));
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      server = undefined;
    }

    await rm(workspace, { recursive: true, force: true });
  });

  it('builds an endpoint catalog with operation metadata', () => {
    const catalog = buildOpenApiCatalog(createCatalogFixture(), {
      generatedAt: '2026-04-26T00:00:00.000Z',
      source: '<fixture>',
    });

    expect(catalog).toEqual({
      generatedAt: '2026-04-26T00:00:00.000Z',
      source: '<fixture>',
      operations: [
        {
          method: 'GET',
          path: '/orders/{orderId}',
          operationId: 'getOrder',
          tags: ['orders'],
          summary: 'Get order',
          description: 'Returns an order.',
          parameters: [
            {
              name: 'orderId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'includeItems',
              in: 'query',
              schema: { type: 'boolean' },
            },
          ],
          hasRequestBody: false,
        },
        {
          method: 'POST',
          path: '/orders/{orderId}',
          operationId: 'createOrder',
          tags: ['orders'],
          parameters: [
            {
              name: 'orderId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          hasRequestBody: true,
        },
      ],
    });
  });

  it('syncs a local OpenAPI file into snapshot and catalog files', async () => {
    const sourcePath = path.join(workspace, 'openapi.yaml');
    const snapshotPath = path.join(workspace, 'load-tests/openapi/dev.openapi.json');
    const catalogPath = path.join(workspace, 'load-tests/openapi/catalog.json');

    await writeFile(sourcePath, createCatalogFixtureYaml(), 'utf8');

    const result = await syncOpenApiSnapshot({
      openapi: sourcePath,
      write: snapshotPath,
      catalog: catalogPath,
      generatedAt: new Date('2026-04-26T00:00:00.000Z'),
    });
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Record<string, unknown>;
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as {
      operations: Array<Record<string, unknown>>;
    };

    expect(result).toEqual({
      snapshotPath,
      catalogPath,
      operationCount: 2,
    });
    expect(snapshot.openapi).toBe('3.0.3');
    expect(catalog.operations).toHaveLength(2);
    expect(catalog.operations[0]).toMatchObject({
      method: 'GET',
      path: '/orders/{orderId}',
      operationId: 'getOrder',
      tags: ['orders'],
      hasRequestBody: false,
    });
    expect(catalog.operations[1]).toMatchObject({
      method: 'POST',
      path: '/orders/{orderId}',
      operationId: 'createOrder',
      hasRequestBody: true,
    });
  });

  it('syncs an OpenAPI URL into snapshot and catalog files', async () => {
    const source = await startOpenApiServer(createCatalogFixture());
    const snapshotPath = path.join(workspace, 'openapi/dev.openapi.json');
    const catalogPath = path.join(workspace, 'openapi/catalog.json');

    const result = await syncOpenApiSnapshot({
      openapi: source,
      write: snapshotPath,
      catalog: catalogPath,
      generatedAt: new Date('2026-04-26T00:00:00.000Z'),
    });
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as {
      source: string;
      operations: Array<Record<string, unknown>>;
    };

    expect(result.operationCount).toBe(2);
    expect(catalog.source).toBe(source);
    expect(catalog.operations.map((operation) => operation.operationId)).toEqual([
      'getOrder',
      'createOrder',
    ]);
  });

  it('bundles remote external refs into a snapshot that generate can parse locally', async () => {
    const source = await startOpenApiRouteServer({
      '/v3/api-docs': {
        openapi: '3.0.3',
        info: { title: 'External Ref API', version: '1.0.0' },
        paths: {
          '/orders/{orderId}': {
            get: {
              operationId: 'getOrder',
              parameters: [
                { $ref: './parameters/order-id.json' },
              ],
              responses: { 200: { description: 'OK' } },
            },
          },
        },
      },
      '/v3/parameters/order-id.json': {
        name: 'orderId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    });
    const snapshotPath = path.join(workspace, 'openapi/external-ref.openapi.json');
    const catalogPath = path.join(workspace, 'openapi/external-ref.catalog.json');

    await syncOpenApiSnapshot({
      openapi: source,
      write: snapshotPath,
      catalog: catalogPath,
      generatedAt: new Date('2026-04-26T00:00:00.000Z'),
    });

    const snapshotSource = await readFile(snapshotPath, 'utf8');
    const snapshot = JSON.parse(snapshotSource) as {
      paths: {
        '/orders/{orderId}': {
          get: {
            parameters: unknown[];
          };
        };
      };
    };
    const registry = await parseOpenApiFile(snapshotPath);
    const operation = registry.byOperationId.get('getOrder');

    expect(snapshotSource).not.toContain('./parameters/order-id.json');
    expect(snapshot.paths['/orders/{orderId}'].get.parameters).toEqual([
      {
        name: 'orderId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ]);
    expect(operation?.parameters).toEqual([
      {
        name: 'orderId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ]);
  });

  it('excludes HTTP methods outside the MVP generator scope from catalog', () => {
    const catalog = buildOpenApiCatalog({
      openapi: '3.0.3',
      info: { title: 'Fixture API', version: '1.0.0' },
      paths: {
        '/health': {
          get: {
            operationId: 'getHealth',
            responses: { 200: { description: 'OK' } },
          },
          head: {
            operationId: 'headHealth',
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    }, {
      generatedAt: '2026-04-26T00:00:00.000Z',
      source: '<fixture>',
    });

    expect(catalog.operations.map((operation) => operation.operationId)).toEqual(['getHealth']);
  });

  async function startOpenApiServer(spec: unknown): Promise<string> {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(spec));
    });

    await new Promise<void>((resolve) => {
      server?.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Failed to start test server');
    }

    return `http://127.0.0.1:${address.port}/v3/api-docs`;
  }

  async function startOpenApiRouteServer(routes: Record<string, unknown>): Promise<string> {
    server = createServer((request, response) => {
      const route = routes[request.url ?? ''];

      if (route === undefined) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Not found' }));
        return;
      }

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(route));
    });

    await new Promise<void>((resolve) => {
      server?.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Failed to start test server');
    }

    return `http://127.0.0.1:${address.port}/v3/api-docs`;
  }
});

function createCatalogFixture(): unknown {
  return {
    openapi: '3.0.3',
    info: { title: 'Fixture API', version: '1.0.0' },
    paths: {
      '/orders/{orderId}': {
        parameters: [
          {
            name: 'orderId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        get: {
          operationId: 'getOrder',
          tags: ['orders'],
          summary: 'Get order',
          description: 'Returns an order.',
          parameters: [
            {
              name: 'includeItems',
              in: 'query',
              schema: { type: 'boolean' },
            },
          ],
          responses: { 200: { description: 'OK' } },
        },
        post: {
          operationId: 'createOrder',
          tags: ['orders'],
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: { 201: { description: 'Created' } },
        },
      },
    },
  };
}

function createCatalogFixtureYaml(): string {
  return [
    'openapi: 3.0.3',
    'info:',
    '  title: Fixture API',
    '  version: 1.0.0',
    'paths:',
    '  /orders/{orderId}:',
    '    parameters:',
    '      - name: orderId',
    '        in: path',
    '        required: true',
    '        schema:',
    '          type: string',
    '    get:',
    '      operationId: getOrder',
    '      tags:',
    '        - orders',
    '      summary: Get order',
    '      responses:',
    '        "200":',
    '          description: OK',
    '      parameters:',
    '        - name: includeItems',
    '          in: query',
    '          schema:',
    '            type: boolean',
    '    post:',
    '      operationId: createOrder',
    '      tags:',
    '        - orders',
    '      requestBody:',
    '        content:',
    '          application/json:',
    '            schema:',
    '              type: object',
    '      responses:',
    '        "201":',
    '          description: Created',
    '',
  ].join('\n');
}
