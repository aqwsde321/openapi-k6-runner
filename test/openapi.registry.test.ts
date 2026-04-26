import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  OpenApiParseError,
  buildApiRegistry,
  createMethodPathKey,
  parseOpenApiFile,
} from '../src/openapi/openapi.parser.js';
import { OpenApiResolveError, resolveApiOperation } from '../src/openapi/openapi.resolver.js';

describe('OpenAPI registry', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-openapi-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('builds a registry for an OpenAPI 3.0 JSON fixture', async () => {
    const sourcePath = path.join(workspace, 'oas30.json');
    await writeFile(
      sourcePath,
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Fixture API', version: '1.0.0' },
        servers: [{ url: 'https://api.example.com' }],
        paths: {
          '/users/{id}': {
            parameters: [{ $ref: '#/components/parameters/UserId' }],
            get: {
              operationId: 'getUserById',
              parameters: [
                {
                  name: 'includePosts',
                  in: 'query',
                  schema: { type: 'boolean' },
                },
              ],
              responses: {
                200: { $ref: '#/components/responses/UserResponse' },
              },
            },
          },
        },
        components: {
          parameters: {
            UserId: {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          },
          responses: {
            UserResponse: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      }),
      'utf8',
    );

    const registry = await parseOpenApiFile(sourcePath);
    const operation = registry.byOperationId.get('getUserById');

    expect(registry.defaultServerUrl).toBe('https://api.example.com');
    expect(operation).toMatchObject({
      operationId: 'getUserById',
      method: 'GET',
      path: '/users/{id}',
      serverUrl: 'https://api.example.com',
    });
    expect(operation?.parameters).toHaveLength(2);
    expect(operation?.parameters[0]).toMatchObject({ name: 'id', in: 'path' });
    expect(operation?.responses).toMatchObject({ 200: { description: 'OK' } });
    expect(registry.byMethodPath.get(createMethodPathKey('GET', '/users/{id}'))).toBe(operation);
  });

  it('builds a registry for an OpenAPI 3.1 YAML fixture', async () => {
    const sourcePath = path.join(workspace, 'oas31.yaml');
    await writeFile(
      sourcePath,
      [
        'openapi: 3.1.0',
        'info:',
        '  title: Fixture API 3.1',
        '  version: 1.0.0',
        'paths:',
        '  /health/status:',
        '    get:',
        '      responses:',
        '        "200":',
        '          description: OK',
        '',
      ].join('\n'),
      'utf8',
    );

    const registry = await parseOpenApiFile(sourcePath);
    const operation = registry.byMethodPath.get('GET /health/status');

    expect(operation).toMatchObject({
      method: 'GET',
      path: '/health/status',
      parameters: [],
      responses: { 200: { description: 'OK' } },
    });
  });

  it('resolves by operationId before method and path', () => {
    const registry = buildApiRegistry({
      openapi: '3.0.3',
      info: { title: 'Fixture API', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: { 200: { description: 'OK' } },
          },
        },
        '/orders': {
          post: {
            operationId: 'createOrder',
            responses: { 201: { description: 'Created' } },
          },
        },
      },
    });

    const operation = resolveApiOperation(
      registry,
      { operationId: 'createOrder', method: 'GET', path: '/users' },
      'create-order',
    );

    expect(operation).toMatchObject({ method: 'POST', path: '/orders' });
  });

  it('resolves by method and path when operationId is absent', () => {
    const registry = buildApiRegistry({
      openapi: '3.0.3',
      info: { title: 'Fixture API', version: '1.0.0' },
      paths: {
        '/health': {
          get: {
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    });

    const operation = resolveApiOperation(
      registry,
      { method: 'get', path: '/health' },
      'health',
    );

    expect(operation).toMatchObject({ method: 'GET', path: '/health' });
  });

  it('does not index HTTP methods outside the MVP generator scope', () => {
    const registry = buildApiRegistry({
      openapi: '3.0.3',
      info: { title: 'Fixture API', version: '1.0.0' },
      paths: {
        '/health': {
          head: {
            operationId: 'headHealth',
            responses: { 200: { description: 'OK' } },
          },
          options: {
            operationId: 'optionsHealth',
            responses: { 200: { description: 'OK' } },
          },
          trace: {
            operationId: 'traceHealth',
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    });

    expect(registry.byOperationId.has('headHealth')).toBe(false);
    expect(registry.byOperationId.has('optionsHealth')).toBe(false);
    expect(registry.byOperationId.has('traceHealth')).toBe(false);
    expect(registry.byMethodPath.has('HEAD /health')).toBe(false);
    expect(registry.byMethodPath.has('OPTIONS /health')).toBe(false);
    expect(registry.byMethodPath.has('TRACE /health')).toBe(false);
    expect(() =>
      resolveApiOperation(registry, { operationId: 'headHealth' }, 'head-health'),
    ).toThrowError(
      new OpenApiResolveError('step "head-health": operationId "headHealth" was not found'),
    );
  });

  it('fails when an operationId is missing from the registry', () => {
    const registry = buildApiRegistry({
      openapi: '3.0.3',
      info: { title: 'Fixture API', version: '1.0.0' },
      paths: {},
    });

    expect(() =>
      resolveApiOperation(registry, { operationId: 'missingOperation' }, 'missing-step'),
    ).toThrowError(
      new OpenApiResolveError('step "missing-step": operationId "missingOperation" was not found'),
    );
  });

  it('fails when method and path are missing from the registry', () => {
    const registry = buildApiRegistry({
      openapi: '3.0.3',
      info: { title: 'Fixture API', version: '1.0.0' },
      paths: {},
    });

    expect(() =>
      resolveApiOperation(registry, { method: 'GET', path: '/missing' }, 'missing-step'),
    ).toThrowError(
      new OpenApiResolveError('step "missing-step": GET /missing was not found'),
    );
  });

  it('fails when operationId is duplicated', () => {
    expect(() =>
      buildApiRegistry({
        openapi: '3.0.3',
        info: { title: 'Fixture API', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'duplicateOperation',
              responses: { 200: { description: 'OK' } },
            },
          },
          '/orders': {
            post: {
              operationId: 'duplicateOperation',
              responses: { 201: { description: 'Created' } },
            },
          },
        },
      }),
    ).toThrowError(new OpenApiParseError('<inline>: duplicate operationId "duplicateOperation"'));
  });

  it('rejects Swagger 2.0 documents', () => {
    expect(() =>
      buildApiRegistry({
        swagger: '2.0',
        info: { title: 'Swagger API', version: '1.0.0' },
        paths: {},
      }),
    ).toThrowError(
      new OpenApiParseError('<inline>: Swagger/OpenAPI 2.0 is not supported'),
    );
  });
});
