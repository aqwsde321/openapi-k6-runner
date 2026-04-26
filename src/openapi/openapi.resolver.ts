import type { ApiOperation, ApiReference, ApiRegistry } from '../core/types.js';
import { createMethodPathKey } from './openapi.parser.js';

export class OpenApiResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenApiResolveError';
  }
}

export function resolveApiOperation(
  registry: ApiRegistry,
  api: ApiReference,
  stepId = '<unknown>',
): ApiOperation {
  const operationId = normalizeOptionalString(api.operationId);

  if (operationId !== undefined) {
    const operation = registry.byOperationId.get(operationId);

    if (!operation) {
      throw new OpenApiResolveError(
        `step "${stepId}": operationId "${operationId}" was not found`,
      );
    }

    return operation;
  }

  const method = normalizeOptionalString(api.method)?.toUpperCase();
  const endpointPath = normalizeOptionalString(api.path);

  if (method === undefined || endpointPath === undefined) {
    throw new OpenApiResolveError(
      `step "${stepId}": api must include operationId or both method and path`,
    );
  }

  const operation = registry.byMethodPath.get(createMethodPathKey(method, endpointPath));

  if (!operation) {
    throw new OpenApiResolveError(
      `step "${stepId}": ${method} ${endpointPath} was not found`,
    );
  }

  return operation;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
