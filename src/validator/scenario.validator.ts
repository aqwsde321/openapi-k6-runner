import type { ApiOperation, ApiRegistry, Scenario, Step } from '../core/types.js';
import { resolveApiOperation } from '../openapi/openapi.resolver.js';
import { compileJsonPathSegments } from '../utils/jsonpath.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const CONDITION_PATTERN = /^status\s*(==|!=|>=|<)\s*\d{3}$/;

type ApiRegistrySource = ApiRegistry | Map<string, ApiRegistry>;

export interface ScenarioValidationResult {
  scenarioName: string;
  stepCount: number;
  warnings: string[];
}

export interface ScenarioValidationOptions {
  defaultModuleName?: string;
}

export class ScenarioValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super([
      'Scenario validation failed:',
      ...issues.map((issue) => `  - ${issue}`),
    ].join('\n'));
    this.name = 'ScenarioValidationError';
    this.issues = issues;
  }
}

export function validateScenarioAgainstOpenApi(
  scenario: Scenario,
  registrySource: ApiRegistrySource,
  options: ScenarioValidationOptions = {},
): ScenarioValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  for (const step of scenario.steps) {
    let operation: ApiOperation;

    validateCondition(step, issues);
    validateExtracts(step, issues);

    try {
      const { registry } = resolveStepRegistry(step, registrySource, options);
      operation = resolveApiOperation(registry, step.api, step.id);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    validatePathParams(step, operation, issues, warnings);
    validateRequiredParameters(step, operation, 'query', issues);
    validateRequiredParameters(step, operation, 'header', issues);
    validateRequestPayloadSupport(step, operation, issues);
    validateRequestBodyContentTypes(step, operation, issues);
    validateRequiredRequestBody(step, operation, issues);
  }

  if (issues.length > 0) {
    throw new ScenarioValidationError(issues);
  }

  return {
    scenarioName: scenario.name,
    stepCount: scenario.steps.length,
    warnings,
  };
}

function resolveStepRegistry(
  step: Step,
  registrySource: ApiRegistrySource,
  options: ScenarioValidationOptions,
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

function validateCondition(step: Step, issues: string[]): void {
  if (step.condition === undefined) {
    return;
  }

  if (!CONDITION_PATTERN.test(step.condition.trim())) {
    issues.push(`step "${step.id}": unsupported condition "${step.condition}"`);
  }
}

function validateExtracts(step: Step, issues: string[]): void {
  for (const [name, rule] of Object.entries(step.extract ?? {})) {
    try {
      compileJsonPathSegments(rule.from);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`step "${step.id}": extract.${name}.from is invalid: ${message}`);
    }
  }
}

function validatePathParams(
  step: Step,
  operation: ApiOperation,
  issues: string[],
  warnings: string[],
): void {
  const expectedNames = readPathTemplateParameterNames(operation.path);
  const expectedNameSet = new Set(expectedNames);
  const providedParams = step.request?.pathParams ?? {};

  for (const name of expectedNames) {
    if (isMissingPathParameterValue(providedParams[name])) {
      issues.push(`step "${step.id}": missing request.pathParams.${name} for path ${operation.path}`);
    }
  }

  for (const name of Object.keys(providedParams)) {
    if (!expectedNameSet.has(name)) {
      warnings.push(`step "${step.id}": request.pathParams.${name} is not used by path ${operation.path}`);
    }
  }
}

function isMissingPathParameterValue(value: unknown): boolean {
  return value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0);
}

function readPathTemplateParameterNames(endpointPath: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const pattern = /{([^}]+)}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(endpointPath)) !== null) {
    const name = normalizeOptionalString(match[1]);

    if (name !== undefined && !seen.has(name)) {
      names.push(name);
      seen.add(name);
    }
  }

  return names;
}

function validateRequiredParameters(
  step: Step,
  operation: ApiOperation,
  location: 'query' | 'header',
  issues: string[],
): void {
  for (const name of readRequiredParameterNames(operation, location)) {
    if (!hasProvidedParameter(step, location, name)) {
      issues.push(
        `step "${step.id}": missing request.${requestFieldName(location)}.${name} required by ${operation.method} ${operation.path}`,
      );
    }
  }
}

function readRequiredParameterNames(
  operation: ApiOperation,
  location: 'query' | 'header',
): string[] {
  return operation.parameters.flatMap((parameter) => {
    if (!isRecord(parameter)) {
      return [];
    }

    const parameterLocation = normalizeOptionalString(parameter.in)?.toLowerCase();
    const name = normalizeOptionalString(parameter.name);

    if (parameterLocation !== location || name === undefined || parameter.required !== true) {
      return [];
    }

    return [name];
  });
}

function hasProvidedParameter(step: Step, location: 'query' | 'header', name: string): boolean {
  const request = step.request;

  if (location === 'query') {
    const value = request?.query?.[name];
    return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
  }

  if (
    name.toLowerCase() === 'content-type' &&
    (request?.body !== undefined || request?.multipart !== undefined)
  ) {
    return true;
  }

  const headers = request?.headers ?? {};
  return Object.entries(headers).some(([key, value]) =>
    key.toLowerCase() === name.toLowerCase() && value !== undefined && value !== null);
}

function requestFieldName(location: 'query' | 'header'): string {
  return location === 'query' ? 'query' : 'headers';
}

function validateRequestPayloadSupport(
  step: Step,
  operation: ApiOperation,
  issues: string[],
): void {
  if (BODY_METHODS.has(operation.method)) {
    return;
  }

  if (step.request?.body !== undefined) {
    issues.push(
      `step "${step.id}": request.body is only supported for POST, PUT, or PATCH by ${operation.method} ${operation.path}`,
    );
  }

  if (step.request?.multipart !== undefined) {
    issues.push(
      `step "${step.id}": request.multipart is only supported for POST, PUT, or PATCH by ${operation.method} ${operation.path}`,
    );
  }
}

function validateRequestBodyContentTypes(
  step: Step,
  operation: ApiOperation,
  issues: string[],
): void {
  if (!BODY_METHODS.has(operation.method)) {
    return;
  }

  const contentTypes = readRequestBodyContentTypes(operation.requestBody);

  if (contentTypes.length === 0) {
    return;
  }

  if (step.request?.body !== undefined && !contentTypes.some(isJsonContentType)) {
    issues.push(
      `step "${step.id}": request.body requires OpenAPI requestBody content type application/json or +json by ${operation.method} ${operation.path}`,
    );
  }

  if (step.request?.multipart !== undefined && !contentTypes.includes('multipart/form-data')) {
    issues.push(
      `step "${step.id}": request.multipart requires OpenAPI requestBody content type multipart/form-data by ${operation.method} ${operation.path}`,
    );
  }
}

function readRequestBodyContentTypes(requestBody: unknown): string[] {
  if (!isRecord(requestBody) || !isRecord(requestBody.content)) {
    return [];
  }

  return Object.keys(requestBody.content).flatMap((contentType) => {
    const normalized = normalizeOptionalString(contentType)?.toLowerCase();
    return normalized === undefined ? [] : [normalized];
  });
}

function isJsonContentType(contentType: string): boolean {
  return contentType === 'application/json' || contentType.endsWith('+json');
}

function validateRequiredRequestBody(
  step: Step,
  operation: ApiOperation,
  issues: string[],
): void {
  if (!isRequiredRequestBody(operation.requestBody)) {
    return;
  }

  if (step.request?.body === undefined && step.request?.multipart === undefined) {
    issues.push(
      `step "${step.id}": request.body or request.multipart is required by ${operation.method} ${operation.path}`,
    );
  }
}

function isRequiredRequestBody(requestBody: unknown): boolean {
  return isRecord(requestBody) && requestBody.required === true;
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
