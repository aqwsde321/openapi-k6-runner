import {
  isInputStep,
  type ApiOperation,
  type ASTScenario,
  type ASTStep,
  type Scenario,
  type Step,
  type StepRequest,
} from '../core/types.js';
import { resolveStepRegistry, type ApiRegistrySource } from '../core/api-registry.js';
import { resolveApiOperation } from '../openapi/openapi.resolver.js';

export interface AstBuildOptions {
  defaultModuleName?: string;
}

export function buildAst(
  scenario: Scenario,
  registrySource: ApiRegistrySource,
  options: AstBuildOptions = {},
): ASTScenario {
  return {
    name: scenario.name,
    ...(scenario.vars === undefined ? {} : { vars: scenario.vars }),
    steps: scenario.steps.map((step) => buildAstStep(step, registrySource, options)),
  };
}

function buildAstStep(
  step: Step,
  registrySource: ApiRegistrySource,
  options: AstBuildOptions,
): ASTStep {
  if (isInputStep(step)) {
    return {
      id: step.id,
      input: { ...step.input },
    };
  }

  const { registry, moduleName } = resolveStepRegistry(step, registrySource, options);
  const operation = resolveApiOperation(registry, step.api, step.id);

  return {
    id: step.id,
    ...(moduleName === undefined ? {} : { moduleName }),
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
