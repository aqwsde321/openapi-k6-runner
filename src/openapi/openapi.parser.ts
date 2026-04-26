import SwaggerParser from '@apidevtools/swagger-parser';

import type { ApiOperation, ApiRegistry } from '../core/types.js';

const HTTP_METHOD_ORDER = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
] as const;

const HTTP_METHODS = new Set<string>(HTTP_METHOD_ORDER);

export class OpenApiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenApiParseError';
  }
}

export async function parseOpenApiFile(filePath: string): Promise<ApiRegistry> {
  const spec = await SwaggerParser.dereference(filePath);
  return buildApiRegistry(spec, filePath);
}

export function buildApiRegistry(spec: unknown, sourcePath = '<inline>'): ApiRegistry {
  const document = expectRecord(spec, `${sourcePath}: OpenAPI document must be an object`);
  validateOpenApiVersion(document, sourcePath);

  const defaultServerUrl = readDefaultServerUrl(document);
  const byOperationId = new Map<string, ApiOperation>();
  const byMethodPath = new Map<string, ApiOperation>();
  const paths = expectOptionalRecord(document.paths, `${sourcePath}: paths must be an object`);

  for (const endpointPath of Object.keys(paths).sort((left, right) => left.localeCompare(right))) {
    const pathItem = expectOptionalRecord(
      paths[endpointPath],
      `${sourcePath}: paths.${endpointPath} must be an object`,
    );

    for (const method of HTTP_METHOD_ORDER) {
      const operationValue = pathItem[method];

      if (operationValue === undefined) {
        continue;
      }

      const operation = expectRecord(
        operationValue,
        `${sourcePath}: ${method.toUpperCase()} ${endpointPath} operation must be an object`,
      );
      const methodUpper = method.toUpperCase();
      const operationId = normalizeOptionalString(operation.operationId);
      const apiOperation: ApiOperation = {
        method: methodUpper,
        path: endpointPath,
        parameters: collectOperationParameters(pathItem, operation),
        ...(operationId === undefined ? {} : { operationId }),
        ...(defaultServerUrl === undefined ? {} : { serverUrl: defaultServerUrl }),
        ...(operation.requestBody === undefined ? {} : { requestBody: operation.requestBody }),
        ...(operation.responses === undefined ? {} : { responses: operation.responses }),
      };

      if (operationId !== undefined) {
        if (byOperationId.has(operationId)) {
          throw new OpenApiParseError(`${sourcePath}: duplicate operationId "${operationId}"`);
        }

        byOperationId.set(operationId, apiOperation);
      }

      byMethodPath.set(createMethodPathKey(methodUpper, endpointPath), apiOperation);
    }
  }

  return {
    byOperationId,
    byMethodPath,
    ...(defaultServerUrl === undefined ? {} : { defaultServerUrl }),
  };
}

export function createMethodPathKey(method: string, endpointPath: string): string {
  return `${method.toUpperCase()} ${endpointPath}`;
}

function validateOpenApiVersion(document: Record<string, unknown>, sourcePath: string): void {
  if (document.swagger === '2.0') {
    throw new OpenApiParseError(`${sourcePath}: Swagger/OpenAPI 2.0 is not supported`);
  }

  const version = document.openapi;

  if (typeof version !== 'string' || !version.startsWith('3.')) {
    throw new OpenApiParseError(
      `${sourcePath}: only OpenAPI 3.x documents are supported`,
    );
  }
}

function readDefaultServerUrl(document: Record<string, unknown>): string | undefined {
  if (!Array.isArray(document.servers)) {
    return undefined;
  }

  const firstServer = document.servers[0];
  if (!isRecord(firstServer)) {
    return undefined;
  }

  return normalizeOptionalString(firstServer.url);
}

function collectOperationParameters(
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
): unknown[] {
  const parameters = [
    ...readParameterArray(pathItem.parameters),
    ...readParameterArray(operation.parameters),
  ];
  const keyedParameters = new Map<string, unknown>();
  const unkeyedParameters: unknown[] = [];

  for (const parameter of parameters) {
    if (!isRecord(parameter)) {
      unkeyedParameters.push(parameter);
      continue;
    }

    const name = normalizeOptionalString(parameter.name);
    const location = normalizeOptionalString(parameter.in);

    if (name === undefined || location === undefined) {
      unkeyedParameters.push(parameter);
      continue;
    }

    keyedParameters.set(`${location}:${name}`, parameter);
  }

  return [...keyedParameters.values(), ...unkeyedParameters];
}

function readParameterArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function expectOptionalRecord(value: unknown, message: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  return expectRecord(value, message);
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new OpenApiParseError(message);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export { HTTP_METHOD_ORDER, HTTP_METHODS };
