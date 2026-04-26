import { describe, expect, it } from 'vitest';

import { buildAst } from '../src/compiler/ast.builder.js';
import type { Scenario } from '../src/core/types.js';
import { buildApiRegistry } from '../src/openapi/openapi.parser.js';

describe('AST builder', () => {
  it('builds AST steps in scenario order for operationId and method/path references', () => {
    const registry = buildApiRegistry({
      openapi: '3.0.3',
      info: { title: 'Fixture API', version: '1.0.0' },
      paths: {
        '/login': {
          post: {
            operationId: 'loginUser',
            responses: { 200: { description: 'OK' } },
          },
        },
        '/orders': {
          post: {
            responses: { 201: { description: 'Created' } },
          },
        },
      },
    });
    const scenario: Scenario = {
      name: 'login-and-create-order',
      steps: [
        {
          id: 'login',
          api: { operationId: 'loginUser' },
        },
        {
          id: 'create-order',
          api: { method: 'POST', path: '/orders' },
        },
      ],
    };

    const ast = buildAst(scenario, registry);

    expect(ast.name).toBe('login-and-create-order');
    expect(ast.steps).toEqual([
      {
        id: 'login',
        method: 'POST',
        path: '/login',
        pathParameters: [],
        request: {},
      },
      {
        id: 'create-order',
        method: 'POST',
        path: '/orders',
        pathParameters: [],
        request: {},
      },
    ]);
  });

  it('normalizes a missing request and preserves extract and condition', () => {
    const registry = buildApiRegistry({
      openapi: '3.0.3',
      info: { title: 'Fixture API', version: '1.0.0' },
      paths: {
        '/login': {
          post: {
            operationId: 'loginUser',
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    });
    const scenario: Scenario = {
      name: 'login',
      steps: [
        {
          id: 'login',
          api: { operationId: 'loginUser' },
          extract: { token: { from: '$.token' } },
          condition: 'status == 200',
        },
      ],
    };

    const ast = buildAst(scenario, registry);

    expect(ast.steps[0]).toEqual({
      id: 'login',
      method: 'POST',
      path: '/login',
      pathParameters: [],
      request: {},
      extract: { token: { from: '$.token' } },
      condition: 'status == 200',
    });
  });

  it('preserves OpenAPI path parameter metadata and DSL pathParams together', () => {
    const registry = buildApiRegistry({
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
            {
              name: 'expand',
              in: 'query',
              schema: { type: 'string' },
            },
          ],
          get: {
            operationId: 'getOrder',
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    });
    const scenario: Scenario = {
      name: 'get-order',
      steps: [
        {
          id: 'get-order',
          api: { operationId: 'getOrder' },
          request: {
            pathParams: { orderId: '{{orderId}}' },
          },
        },
      ],
    };

    const ast = buildAst(scenario, registry);

    expect(ast.steps[0]?.pathParameters).toEqual([
      {
        name: 'orderId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ]);
    expect(ast.steps[0]?.request.pathParams).toEqual({ orderId: '{{orderId}}' });
  });

  it('preserves headers, query, pathParams, and body request fields', () => {
    const registry = buildApiRegistry({
      openapi: '3.0.3',
      info: { title: 'Fixture API', version: '1.0.0' },
      paths: {
        '/orders/{orderId}': {
          patch: {
            operationId: 'updateOrder',
            parameters: [
              {
                name: 'orderId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    });
    const scenario: Scenario = {
      name: 'update-order',
      steps: [
        {
          id: 'update-order',
          api: { operationId: 'updateOrder' },
          request: {
            headers: { Authorization: 'Bearer {{token}}' },
            query: { dryRun: false },
            pathParams: { orderId: '{{orderId}}' },
            body: { status: 'PAID' },
          },
        },
      ],
    };

    const ast = buildAst(scenario, registry);

    expect(ast.steps[0]).toMatchObject({
      id: 'update-order',
      method: 'PATCH',
      path: '/orders/{orderId}',
      request: {
        headers: { Authorization: 'Bearer {{token}}' },
        query: { dryRun: false },
        pathParams: { orderId: '{{orderId}}' },
        body: { status: 'PAID' },
      },
    });
  });
});
