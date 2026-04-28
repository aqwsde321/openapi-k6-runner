import type {
  ApiOperation,
  ApiRegistry,
  ASTScenario,
  ASTStep,
  Scenario,
  Step,
  StepRequest,
} from '../core/types.js';
import { resolveApiOperation } from '../openapi/openapi.resolver.js';

export function buildAst(scenario: Scenario, registry: ApiRegistry): ASTScenario {
  return {
    name: scenario.name,
    steps: scenario.steps.map((step) => buildAstStep(step, registry)),
  };
}

function buildAstStep(step: Step, registry: ApiRegistry): ASTStep {
  const operation = resolveApiOperation(registry, step.api, step.id);

  return {
    id: step.id,
    method: operation.method,
    path: operation.path,
    pathParameters: collectPathParameters(operation),
    request: normalizeRequest(step.request),
    ...(step.extract === undefined ? {} : { extract: step.extract }),
    ...(step.condition === undefined ? {} : { condition: step.condition }),
  };
}

function normalizeRequest(request: StepRequest | undefined): StepRequest {
  if (request === undefined) {
    return {};
  }

  return {
    ...(request.headers === undefined ? {} : { headers: { ...request.headers } }),
    ...(request.query === undefined ? {} : { query: { ...request.query } }),
    ...(request.pathParams === undefined ? {} : { pathParams: { ...request.pathParams } }),
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(request.multipart === undefined
      ? {}
      : {
          multipart: {
            ...(request.multipart.fields === undefined ? {} : { fields: { ...request.multipart.fields } }),
            files: Object.fromEntries(
              Object.entries(request.multipart.files).map(([fieldName, file]) => [fieldName, { ...file }]),
            ),
          },
        }),
  };
}

function collectPathParameters(operation: ApiOperation): unknown[] {
  return operation.parameters.filter(isPathParameter);
}

function isPathParameter(parameter: unknown): boolean {
  if (!isRecord(parameter)) {
    return false;
  }

  return normalizeOptionalString(parameter.in)?.toLowerCase() === 'path';
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
