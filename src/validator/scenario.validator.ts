import type { ApiOperation, Scenario, Step } from '../core/types.js';
import { resolveStepRegistry, type ApiRegistrySource } from '../core/api-registry.js';
import { isSupportedStatusCondition } from '../core/condition.js';
import { collectTemplateReferences } from '../core/template.js';
import { resolveApiOperation } from '../openapi/openapi.resolver.js';
import { compileJsonPathSegments } from '../utils/jsonpath.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const PLACEHOLDER_PATTERN = /^<[A-Za-z0-9_.-]+>$/;

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
  readonly hints: string[];

  constructor(issues: string[]) {
    const hints = createScenarioValidationHints(issues);

    super([
      'Scenario validation failed:',
      ...issues.map((issue) => `  - ${issue}`),
      ...formatScenarioValidationHints(hints),
    ].join('\n'));
    this.name = 'ScenarioValidationError';
    this.issues = issues;
    this.hints = hints;
  }
}

export function validateScenarioAgainstOpenApi(
  scenario: Scenario,
  registrySource: ApiRegistrySource,
  options: ScenarioValidationOptions = {},
): ScenarioValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const availableContextNames = new Set<string>();
  const availableVarsNames = new Set(Object.keys(scenario.vars ?? {}));

  validateScenarioVarPlaceholders(scenario, issues);

  for (const step of scenario.steps) {
    let operation: ApiOperation;

    validateCondition(step, issues);
    validateExtracts(step, issues);
    validateRequestTemplates(step, availableContextNames, availableVarsNames, issues);
    validateRequestPlaceholders(step, issues);

    try {
      const { registry } = resolveStepRegistry(step, registrySource, options);
      operation = resolveApiOperation(registry, step.api, step.id);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
      registerExtractNames(step, availableContextNames);
      continue;
    }

    validatePathParamTemplates(step, operation, availableContextNames, availableVarsNames, issues);
    registerExtractNames(step, availableContextNames);
    validatePathParams(step, operation, issues, warnings);
    validateRequiredParameters(step, operation, 'query', issues);
    validateRequiredParameters(step, operation, 'header', issues);
    validateRequestPayloadSupport(step, operation, issues);
    validateRequestBodyContentTypes(step, operation, issues);
    validateRequiredRequestBody(step, operation, issues);
    validateRequiredRequestBodyFields(step, operation, issues);
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

function validateScenarioVarPlaceholders(scenario: Scenario, issues: string[]): void {
  validatePlaceholderValue('scenario', 'vars', scenario.vars, issues);
}

function validateRequestTemplates(
  step: Step,
  availableContextNames: Set<string>,
  availableVarsNames: Set<string>,
  issues: string[],
): void {
  const request = step.request;

  if (request === undefined) {
    return;
  }

  validateTemplateValue(step, 'request.headers', request.headers, availableContextNames, availableVarsNames, issues);
  validateTemplateValue(step, 'request.query', request.query, availableContextNames, availableVarsNames, issues);
  validateTemplateValue(step, 'request.body', request.body, availableContextNames, availableVarsNames, issues);
  validateTemplateValue(step, 'request.multipart.fields', request.multipart?.fields, availableContextNames, availableVarsNames, issues);
  validateMultipartFileMetadataTemplates(step, availableContextNames, availableVarsNames, issues);
}

function validateRequestPlaceholders(step: Step, issues: string[]): void {
  validatePlaceholderValue(`step "${step.id}"`, 'request', step.request, issues);
}

function validatePathParamTemplates(
  step: Step,
  operation: ApiOperation,
  availableContextNames: Set<string>,
  availableVarsNames: Set<string>,
  issues: string[],
): void {
  const pathParams = step.request?.pathParams;

  if (pathParams === undefined) {
    return;
  }

  for (const name of readPathTemplateParameterNames(operation.path)) {
    validateTemplateValue(
      step,
      `request.pathParams.${name}`,
      pathParams[name],
      availableContextNames,
      availableVarsNames,
      issues,
    );
  }
}

function validateMultipartFileMetadataTemplates(
  step: Step,
  availableContextNames: Set<string>,
  availableVarsNames: Set<string>,
  issues: string[],
): void {
  for (const [fieldName, file] of Object.entries(step.request?.multipart?.files ?? {})) {
    const filePathLabel = appendTemplatePath('request.multipart.files', fieldName);

    validateTemplateValue(
      step,
      appendTemplatePath(filePathLabel, 'filename'),
      file.filename,
      availableContextNames,
      availableVarsNames,
      issues,
    );
    validateTemplateValue(
      step,
      appendTemplatePath(filePathLabel, 'contentType'),
      file.contentType,
      availableContextNames,
      availableVarsNames,
      issues,
    );
  }
}

function validatePlaceholderValue(
  ownerLabel: string,
  pathLabel: string,
  value: unknown,
  issues: string[],
): void {
  if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (PLACEHOLDER_PATTERN.test(trimmed)) {
      issues.push(`${ownerLabel}: ${pathLabel} still contains placeholder ${JSON.stringify(trimmed)}`);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validatePlaceholderValue(ownerLabel, `${pathLabel}[${index}]`, item, issues));
    return;
  }

  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      validatePlaceholderValue(ownerLabel, appendTemplatePath(pathLabel, key), item, issues);
    }
  }
}

function validateTemplateValue(
  step: Step,
  pathLabel: string,
  value: unknown,
  availableContextNames: Set<string>,
  availableVarsNames: Set<string>,
  issues: string[],
): void {
  if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'string') {
    try {
      for (const reference of collectTemplateReferences(value)) {
        if (reference.type === 'context' && !availableContextNames.has(reference.name)) {
          issues.push(`step "${step.id}": ${pathLabel} references unknown context.${reference.name}`);
        } else if (reference.type === 'vars' && !availableVarsNames.has(reference.name)) {
          issues.push(`step "${step.id}": ${pathLabel} references unknown vars.${reference.name}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`step "${step.id}": ${pathLabel} has invalid template: ${message}`);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateTemplateValue(step, `${pathLabel}[${index}]`, item, availableContextNames, availableVarsNames, issues));
    return;
  }

  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      validateTemplateValue(step, appendTemplatePath(pathLabel, key), item, availableContextNames, availableVarsNames, issues);
    }
  }
}

function appendTemplatePath(pathLabel: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${pathLabel}.${key}`
    : `${pathLabel}[${JSON.stringify(key)}]`;
}

function registerExtractNames(step: Step, availableContextNames: Set<string>): void {
  for (const name of Object.keys(step.extract ?? {})) {
    availableContextNames.add(name);
  }
}

function validateCondition(step: Step, issues: string[]): void {
  if (step.condition === undefined) {
    return;
  }

  if (!isSupportedStatusCondition(step.condition)) {
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

function validateRequiredRequestBodyFields(
  step: Step,
  operation: ApiOperation,
  issues: string[],
): void {
  const requiredFieldNames = readRequiredJsonRequestBodyFieldNames(operation.requestBody);
  const request = step.request;

  if (requiredFieldNames.length === 0 || request?.body === undefined || request.multipart !== undefined) {
    return;
  }

  const body = request.body;

  for (const name of requiredFieldNames) {
    if (!isRecord(body) || body[name] === undefined || body[name] === null) {
      issues.push(`step "${step.id}": missing request.body.${name} required by ${operation.method} ${operation.path}`);
    }
  }
}

function isRequiredRequestBody(requestBody: unknown): boolean {
  return isRecord(requestBody) && requestBody.required === true;
}

function readRequiredJsonRequestBodyFieldNames(requestBody: unknown): string[] {
  if (!isRecord(requestBody) || !isRecord(requestBody.content)) {
    return [];
  }

  const fieldNames: string[] = [];
  const seen = new Set<string>();

  for (const [contentType, mediaType] of Object.entries(requestBody.content)) {
    const normalizedContentType = normalizeOptionalString(contentType)?.toLowerCase();

    if (normalizedContentType === undefined || !isJsonContentType(normalizedContentType) || !isRecord(mediaType)) {
      continue;
    }

    for (const name of readRequiredObjectSchemaFieldNames(mediaType.schema)) {
      if (!seen.has(name)) {
        fieldNames.push(name);
        seen.add(name);
      }
    }
  }

  return fieldNames;
}

function readRequiredObjectSchemaFieldNames(schema: unknown): string[] {
  if (!isRecord(schema)) {
    return [];
  }

  const fieldNames = readDirectRequiredObjectSchemaFieldNames(schema);

  if (Array.isArray(schema.allOf)) {
    for (const item of schema.allOf) {
      fieldNames.push(...readRequiredObjectSchemaFieldNames(item));
    }
  }

  return [...new Set(fieldNames)];
}

function readDirectRequiredObjectSchemaFieldNames(schema: Record<string, unknown>): string[] {
  const type = normalizeOptionalString(schema.type)?.toLowerCase();
  const properties = isRecord(schema.properties) ? schema.properties : undefined;

  if (type !== undefined && type !== 'object' && properties === undefined) {
    return [];
  }

  if (!Array.isArray(schema.required)) {
    return [];
  }

  return schema.required.flatMap((name) => {
    const normalized = normalizeOptionalString(name);
    return normalized === undefined ? [] : [normalized];
  });
}

function createScenarioValidationHints(issues: string[]): string[] {
  const hints: string[] = [];
  const seen = new Set<string>();
  const addHint = (hint: string): void => {
    if (!seen.has(hint)) {
      hints.push(hint);
      seen.add(hint);
    }
  };

  for (const issue of issues) {
    if (issue.includes(' still contains placeholder ')) {
      addHint('Replace every <...> placeholder with a real value, {{env.NAME}}, {{vars.NAME}}, or an earlier extract before validate/test.');
    }

    if (issue.includes(' references unknown context.')) {
      addHint('Context values can only reference extract names from earlier steps; fix the extract name or move this step after the extracting step.');
    }

    if (issue.includes(' references unknown vars.')) {
      addHint('Define missing vars under scenario vars:, pass --var name=value, or load them with --var-file.');
    }

    if (issue.includes(' has invalid template:')) {
      addHint('Use template names like {{token}}, {{env.NAME}}, {{vars.NAME}}, or {{k6.scenario.iterationInTest}}; names must be supported identifiers.');
    }

    if (issue.includes('operationId "') && issue.includes(' was not found')) {
      addHint('Find the endpoint with openapi-k6 catalog --query <keyword> --ai, then update api.operationId or use api.method/api.path.');
    }

    if (issue.includes('api must include operationId or both method and path') || /step ".+": [A-Z]+ .+ was not found$/.test(issue)) {
      addHint('Use api.operationId when possible; otherwise set both api.method and api.path from catalog output.');
    }

    if (issue.includes('api.module is required because no fallback module was selected')) {
      addHint('Set defaultModule in config.yaml or add api.module to the step.');
    }

    if (issue.includes('api.module "') && issue.includes('" was not found')) {
      addHint('Use an existing module from config.yaml, or add the module with openapi-k6 module add.');
    }

    if (issue.includes('missing request.pathParams.')) {
      addHint('Add the missing request.pathParams value for each {...} segment in api.path.');
    }

    if (issue.includes('missing request.query.')) {
      addHint('Add the required request.query value from OpenAPI parameters.');
    }

    if (issue.includes('missing request.headers.')) {
      addHint('Add the required request.headers value from OpenAPI parameters.');
    }

    if (issue.includes('missing request.body.')) {
      addHint('Add the missing required request.body fields; inspect body fields with openapi-k6 catalog --query <keyword> --ai.');
    }

    if (issue.includes('request.body or request.multipart is required')) {
      addHint('Add request.body for JSON endpoints or request.multipart for multipart/form-data endpoints.');
    }

    if (issue.includes('request.body requires OpenAPI requestBody content type')) {
      addHint('Use request.body only for JSON requestBody content types; use request.multipart for multipart/form-data.');
    }

    if (issue.includes('request.multipart requires OpenAPI requestBody content type')) {
      addHint('Use request.multipart only when OpenAPI requestBody content type is multipart/form-data.');
    }

    if (issue.includes('request.body is only supported for POST, PUT, or PATCH')) {
      addHint('Remove request.body from GET/DELETE steps unless the endpoint method is POST, PUT, or PATCH.');
    }

    if (issue.includes('request.multipart is only supported for POST, PUT, or PATCH')) {
      addHint('Remove request.multipart from GET/DELETE steps unless the endpoint method is POST, PUT, or PATCH.');
    }

    if (issue.includes('unsupported condition ')) {
      addHint('Use supported conditions such as status == 200, status != 404, status >= 200, or status < 300.');
    }

    if (issue.includes('.from is invalid:')) {
      addHint('Use simple extract JSONPath values like $.token, $.data.id, or $.items[0].id.');
    }
  }

  return hints;
}

function formatScenarioValidationHints(hints: string[]): string[] {
  if (hints.length === 0) {
    return [];
  }

  return [
    '',
    'Fix hints:',
    ...hints.map((hint) => `  - ${hint}`),
  ];
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
