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

export interface AstBuildOptions {
  defaultModuleName?: string;
}

type ApiRegistrySource = ApiRegistry | Map<string, ApiRegistry>;

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

function resolveStepRegistry(
  step: Step,
  registrySource: ApiRegistrySource,
  options: AstBuildOptions,
): { registry: ApiRegistry; moduleName?: string } {
  if (!(registrySource instanceof Map)) {
    if (step.api.module !== undefined) {
      throw new Error(`step "${step.id}": api.module requires a module registry`);
    }

    return { registry: registrySource };
  }

  const moduleName = step.api.module ?? options.defaultModuleName;

  if (moduleName === undefined) {
    throw new Error(`step "${step.id}": api.module is required because no fallback module was selected`);
  }

  const registry = registrySource.get(moduleName);

  if (!registry) {
    throw new Error(`step "${step.id}": api.module "${moduleName}" was not found`);
  }

  return { registry, moduleName };
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
