import path from 'node:path';

import { isASTApiStep, isASTInputStep, type ASTApiStep, type ASTInputStep, type ASTScenario, type ASTStep, type StepRequest } from '../core/types.js';
import {
  createModuleBaseUrlEnvName,
  findModuleBaseUrlEnvNameCollisions,
} from '../core/module-env.js';
import { formatUnsupportedConditionError, parseStatusCondition } from '../core/condition.js';
import { compileValueExpression } from '../core/template.js';
import { compileJsonPathSegments } from '../utils/jsonpath.js';

const HTTP_CALLS: Record<string, string> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'del',
};

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const ENV_TEMPLATE_PATTERN = /{{\s*env\.([A-Z_][A-Z0-9_]*)\s*}}/g;
const VARS_TEMPLATE_PATTERN = /{{\s*vars\.([A-Za-z_$][A-Za-z0-9_$]*)\s*}}/g;
const K6_RUN_ID_TEMPLATE_PATTERN = /{{\s*k6\.run\.id\s*}}/g;
const K6_TEMPLATE_PATTERN = /{{\s*k6\.(scenario\.(?:iterationInInstance|iterationInTest)|vu\.(?:idInInstance|idInTest|iterationInInstance|iterationInScenario))\s*}}/g;

export interface K6GeneratorOptions {
  baseUrl?: string;
  moduleBaseUrls?: Record<string, string | undefined>;
  fileRootDir?: string;
  outputPath?: string;
}

export class K6GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'K6GenerationError';
  }
}

export function generateK6Script(ast: ASTScenario, options: K6GeneratorOptions = {}): string {
  const baseUrlPlan = buildBaseUrlPlan(ast, options);
  const secretEnvNames = collectEnvReferenceNames(ast);
  const needsVars = Object.keys(ast.vars ?? {}).length > 0 || collectVarsReferenceNames(ast).length > 0;
  const needsK6RunId = hasK6RunIdReferences(ast);
  const needsK6Execution = needsK6RunId || hasK6ExecutionReferences(ast);

  const lines: string[] = [
    "import http from 'k6/http';",
    ...(needsK6Execution ? ["import exec from 'k6/execution';"] : []),
  ];

  const k6Imports = [
    ...(hasChecks(ast) ? ['check'] : []),
    ...(hasSteps(ast) ? ['group'] : []),
  ];

  if (k6Imports.length > 0) {
    lines.push(`import { ${k6Imports.join(', ')} } from 'k6';`);
  }

  lines.push(
    '',
    ...renderK6Options(ast),
    ...baseUrlPlan.declarations,
    ...(needsVars ? [`const VARS = ${JSON.stringify(ast.vars ?? {})};`] : []),
    "const OPENAPI_K6_TRACE = __ENV.OPENAPI_K6_TRACE === '1';",
    ...(secretEnvNames.length === 0
      ? []
      : [`const OPENAPI_K6_SECRET_ENV_NAMES = ${JSON.stringify(secretEnvNames)};`]),
    ...renderMultipartFileDeclarations(ast, options),
    '',
    ...renderHelpers(ast, secretEnvNames, needsK6RunId),
    '',
    'export default function () {',
    '  const context = {};',
  );

  ast.steps.forEach((step, index) => {
    lines.push('', ...renderStep(ast.name, step, index, baseUrlPlan.stepReferences[index] ?? 'BASE_URL'));
  });

  lines.push('}', '');
  return lines.join('\n');
}

function renderK6Options(ast: ASTScenario): string[] {
  if (!hasChecks(ast)) {
    return [];
  }

  return [
    'export const options = {',
    '  thresholds: {',
    "    checks: ['rate==1.0'],",
    '  },',
    '};',
    '',
  ];
}

interface BaseUrlPlan {
  declarations: string[];
  stepReferences: string[];
}

function buildBaseUrlPlan(ast: ASTScenario, options: K6GeneratorOptions): BaseUrlPlan {
  const moduleNames = collectStepModuleNames(ast);

  if (moduleNames.length <= 1) {
    const baseUrl = resolveSingleBaseUrl(moduleNames[0], options);

    return {
      declarations: [`const BASE_URL = __ENV.BASE_URL || ${JSON.stringify(baseUrl)};`],
      stepReferences: ast.steps.map(() => 'BASE_URL'),
    };
  }

  assertNoModuleBaseUrlEnvNameCollisions(moduleNames);

  const moduleVariables = new Map<string, string>();
  const declarations = moduleNames.map((moduleName, index) => {
    const variableName = `BASE_URL_${index}`;
    const configuredBaseUrl = normalizeOptionalString(options.moduleBaseUrls?.[moduleName]);

    if (configuredBaseUrl === undefined) {
      throw new K6GenerationError(`BASE_URL is required to generate a k6 script for module "${moduleName}"`);
    }

    moduleVariables.set(moduleName, variableName);
    return `const ${variableName} = __ENV.${createModuleBaseUrlEnvName(moduleName)} || __ENV.BASE_URL || ${JSON.stringify(configuredBaseUrl)};`;
  });

  return {
    declarations,
    stepReferences: ast.steps.map((step) => {
      if (isASTInputStep(step)) {
        return 'BASE_URL';
      }

      const moduleName = step.moduleName;

      if (moduleName === undefined) {
        throw new K6GenerationError(`step "${step.id}": moduleName is required for multi-module k6 generation`);
      }

      return moduleVariables.get(moduleName) ?? 'BASE_URL';
    }),
  };
}

function assertNoModuleBaseUrlEnvNameCollisions(moduleNames: string[]): void {
  const [collision] = findModuleBaseUrlEnvNameCollisions(moduleNames);

  if (collision !== undefined) {
    throw new K6GenerationError(
      `module base URL env name collision: modules ${collision.moduleNames.map((name) => JSON.stringify(name)).join(', ')} all map to ${collision.envName}`,
    );
  }
}

function resolveSingleBaseUrl(moduleName: string | undefined, options: K6GeneratorOptions): string {
  const baseUrl = normalizeOptionalString(
    moduleName === undefined
      ? options.baseUrl
      : options.moduleBaseUrls?.[moduleName] ?? options.baseUrl,
  );

  if (baseUrl === undefined) {
    throw new K6GenerationError('BASE_URL is required to generate a k6 script');
  }

  return baseUrl;
}

function collectStepModuleNames(ast: ASTScenario): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const step of ast.steps) {
    if (isASTInputStep(step)) {
      continue;
    }

    if (step.moduleName !== undefined && !seen.has(step.moduleName)) {
      names.push(step.moduleName);
      seen.add(step.moduleName);
    }
  }

  return names;
}

function renderHelpers(ast: ASTScenario, secretEnvNames: string[], needsK6RunId: boolean): string[] {
  const hasSecretEnvReferences = secretEnvNames.length > 0;
  const helpers = [
    'function joinUrl(baseUrl, endpointPath) {',
    "  return `${baseUrl.replace(/\\/+$/, '')}/${endpointPath.replace(/^\\/+/, '')}`;",
    '}',
  ];

  if (needsK6RunId) {
    helpers.push(
      '',
      'function openapiK6RunId() {',
      '  return __ENV.OPENAPI_K6_RUN_ID || String(exec.scenario.startTime);',
      '}',
    );
  }

  if (hasSecretEnvReferences) {
    helpers.push(
      '',
      'function readSecretValues() {',
      '  return OPENAPI_K6_SECRET_ENV_NAMES',
      '    .map((name) => __ENV[name])',
      '    .filter((value) => value !== undefined && value !== null && String(value) !== \'\');',
      '}',
      '',
      'function maskLogValue(value) {',
      '  if (value === undefined || value === null) {',
      '    return value;',
      '  }',
      '',
      '  return readSecretValues()',
      '    .sort((left, right) => String(right).length - String(left).length)',
      '    .reduce((text, secret) => text.split(String(secret)).join(\'***\'), String(value));',
      '}',
    );
  }

  if (hasSteps(ast)) {
    helpers.push(
      '',
      'function logStepStart(metadata, url) {',
      '  if (!OPENAPI_K6_TRACE) {',
      '    return;',
      '  }',
      '',
      '  console.log(JSON.stringify({',
      "    type: 'openapi-k6-step-start',",
      '    scenario: metadata.scenario,',
      '    step: metadata.step,',
      '    method: metadata.method,',
      '    path: metadata.path,',
      hasSecretEnvReferences ? '    url: maskLogValue(url),' : '    url,',
      '  }));',
      '}',
      '',
      'function logStepEnd(metadata, response) {',
      '  if (!OPENAPI_K6_TRACE) {',
      '    return;',
      '  }',
      '',
      '  console.log(JSON.stringify({',
      "    type: 'openapi-k6-step-end',",
      '    scenario: metadata.scenario,',
      '    step: metadata.step,',
      '    method: metadata.method,',
      '    path: metadata.path,',
      '    status: response.status,',
      '    durationMs: response.timings.duration,',
      '  }));',
      '}',
    );
  }

  if (hasQuery(ast)) {
    helpers.push(
      '',
      'function appendQuery(url, query) {',
      '  const search = Object.entries(query)',
      '    .filter(([, value]) => value !== undefined && value !== null)',
      '    .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])',
      "    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)",
      "    .join('&');",
      '',
      "  return search ? `${url}${url.includes('?') ? '&' : '?'}${search}` : url;",
      '}',
    );
  }

  if (hasExtract(ast)) {
    helpers.push(
      '',
      'function readJsonPath(value, path) {',
      '  return path.reduce((current, key) => current == null ? undefined : current[key], value);',
      '}',
    );
  }

  if (hasChecks(ast)) {
    helpers.push(
      '',
      'function truncateLogValue(value, limit) {',
      '  if (value === undefined || value === null) {',
      '    return value;',
      '  }',
      '',
      '  const text = String(value);',
      "  return text.length > limit ? `${text.slice(0, limit)}...<truncated ${text.length - limit} chars>` : text;",
      '}',
      '',
      'function logFailedCheck(metadata, condition, url, response) {',
      '  console.error(JSON.stringify({',
      "    type: 'openapi-k6-check-failed',",
      '    scenario: metadata.scenario,',
      '    step: metadata.step,',
      '    method: metadata.method,',
      '    path: metadata.path,',
      '    condition,',
      '    status: response.status,',
      hasSecretEnvReferences ? '    url: maskLogValue(url),' : '    url,',
      '    durationMs: response.timings.duration,',
      hasSecretEnvReferences
        ? '    responseBody: truncateLogValue(maskLogValue(response.body), 2000),'
        : '    responseBody: truncateLogValue(response.body, 2000),',
      '  }, null, 2));',
      '}',
    );
  }

  return helpers;
}

function collectEnvReferenceNames(ast: ASTScenario): string[] {
  const names = new Set<string>();

  for (const step of ast.steps) {
    if (isASTInputStep(step)) {
      continue;
    }

    collectEnvReferenceNamesFromValue(step.request, names);
  }

  return [...names].sort();
}

function collectVarsReferenceNames(ast: ASTScenario): string[] {
  const names = new Set<string>();

  for (const step of ast.steps) {
    if (isASTInputStep(step)) {
      names.add(step.input.name);
    } else {
      collectVarsReferenceNamesFromValue(step.request, names);
    }
  }

  return [...names].sort();
}

function hasK6RunIdReferences(ast: ASTScenario): boolean {
  return ast.steps.some((step) => isASTApiStep(step) && hasK6RunIdReferencesInValue(step.request));
}

function hasK6RunIdReferencesInValue(value: unknown): boolean {
  if (typeof value === 'string') {
    K6_RUN_ID_TEMPLATE_PATTERN.lastIndex = 0;
    return K6_RUN_ID_TEMPLATE_PATTERN.test(value);
  }

  if (Array.isArray(value)) {
    return value.some(hasK6RunIdReferencesInValue);
  }

  if (isRecord(value)) {
    return Object.values(value).some(hasK6RunIdReferencesInValue);
  }

  return false;
}

function hasK6ExecutionReferences(ast: ASTScenario): boolean {
  return ast.steps.some((step) => isASTApiStep(step) && hasK6ExecutionReferencesInValue(step.request));
}

function hasK6ExecutionReferencesInValue(value: unknown): boolean {
  if (typeof value === 'string') {
    K6_TEMPLATE_PATTERN.lastIndex = 0;
    return K6_TEMPLATE_PATTERN.test(value);
  }

  if (Array.isArray(value)) {
    return value.some(hasK6ExecutionReferencesInValue);
  }

  if (isRecord(value)) {
    return Object.values(value).some(hasK6ExecutionReferencesInValue);
  }

  return false;
}

function collectVarsReferenceNamesFromValue(value: unknown, names: Set<string>): void {
  if (typeof value === 'string') {
    VARS_TEMPLATE_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = VARS_TEMPLATE_PATTERN.exec(value)) !== null) {
      names.add(match[1]);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectVarsReferenceNamesFromValue(item, names));
    return;
  }

  if (isRecord(value)) {
    Object.values(value).forEach((item) => collectVarsReferenceNamesFromValue(item, names));
  }
}

function collectEnvReferenceNamesFromValue(value: unknown, names: Set<string>): void {
  if (typeof value === 'string') {
    ENV_TEMPLATE_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = ENV_TEMPLATE_PATTERN.exec(value)) !== null) {
      names.add(match[1]);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectEnvReferenceNamesFromValue(item, names));
    return;
  }

  if (isRecord(value)) {
    Object.values(value).forEach((item) => collectEnvReferenceNamesFromValue(item, names));
  }
}

function renderStep(
  scenarioName: string,
  step: ASTStep,
  index: number,
  baseUrlReference: string,
): string[] {
  if (isASTInputStep(step)) {
    return renderInputStep(step, index);
  }

  const innerLines: string[] = [];
  const urlVariable = `url${index}`;
  const responseVariable = `res${index}`;
  const bodyVariable = `body${index}`;
  const paramsVariable = `params${index}`;
  const metadataVariable = `metadata${index}`;
  const tagsVariable = `tags${index}`;
  const method = step.method.toUpperCase();
  const httpCall = HTTP_CALLS[method];

  if (!httpCall) {
    throw new K6GenerationError(`step "${step.id}": unsupported HTTP method ${step.method}`);
  }

  innerLines.push(
    `const ${metadataVariable} = ${renderLogMetadata(scenarioName, step, method)};`,
  );
  innerLines.push(
    `const ${tagsVariable} = ${renderRequestTags(scenarioName, step, method)};`,
  );

  const hasQueryValue = hasRequestEntries(step.request.query);
  innerLines.push(
    `${hasQueryValue ? 'let' : 'const'} ${urlVariable} = joinUrl(${baseUrlReference}, ${compilePathExpression(step)});`,
  );

  if (hasQueryValue) {
    innerLines.push(`${urlVariable} = appendQuery(${urlVariable}, ${compileValueExpression(step.request.query)});`);
  }

  const hasJsonBodyValue = step.request.body !== undefined && BODY_METHODS.has(method);
  const hasMultipartValue = step.request.multipart !== undefined;

  if (step.request.body !== undefined && hasMultipartValue) {
    throw new K6GenerationError(`step "${step.id}": request.body and request.multipart cannot be used together`);
  }

  if (hasMultipartValue && !BODY_METHODS.has(method)) {
    throw new K6GenerationError(`step "${step.id}": request.multipart is only supported for POST, PUT, or PATCH`);
  }

  if (hasJsonBodyValue) {
    innerLines.push(`const ${bodyVariable} = JSON.stringify(${compileValueExpression(step.request.body)});`);
  } else if (hasMultipartValue) {
    innerLines.push(`const ${bodyVariable} = ${renderMultipartBody(step, index)};`);
  }

  const hasBodyValue = hasJsonBodyValue || hasMultipartValue;
  const headers = buildHeaders(step.request, hasJsonBodyValue, hasMultipartValue);
  innerLines.push(`const ${paramsVariable} = ${renderRequestParams(headers, tagsVariable)};`);

  innerLines.push(`logStepStart(${metadataVariable}, ${urlVariable});`);
  innerLines.push(`const ${responseVariable} = ${renderHttpCall(httpCall, method, urlVariable, bodyVariable, paramsVariable, hasBodyValue)};`);
  innerLines.push(`logStepEnd(${metadataVariable}, ${responseVariable});`);
  innerLines.push(...renderCondition(step, index, responseVariable, urlVariable, metadataVariable));
  innerLines.push(...renderExtract(step, index, responseVariable, urlVariable, metadataVariable));

  return [
    `  group(${JSON.stringify(`${step.id} ${method} ${step.path}`)}, () => {`,
    ...innerLines.map((line) => `    ${line}`),
    '  });',
  ];
}

function renderInputStep(
  step: ASTInputStep,
  index: number,
): string[] {
  const valueVariable = `input${index}`;
  const inputReference = compileVarsReference(step.input.name);
  const lines = [`const ${valueVariable} = ${inputReference};`];

  if (step.input.required) {
    lines.push(
      `if (${valueVariable} === undefined || ${valueVariable} === null || String(${valueVariable}).trim() === '') {`,
      `  throw new Error(${JSON.stringify(`step "${step.id}": input ${step.input.name} is required. Pass --var ${step.input.name}=<value> before running k6.`)});`,
      '}',
    );
  }

  lines.push(
    `if (${valueVariable} !== undefined && ${valueVariable} !== null && String(${valueVariable}).trim() !== '') {`,
    `  ${compileContextReference(step.input.name)} = ${valueVariable};`,
    '}',
  );

  return [
    `  group(${JSON.stringify(`${step.id} INPUT ${step.input.name}`)}, () => {`,
    ...lines.map((line) => `    ${line}`),
    '  });',
  ];
}

function compilePathExpression(step: ASTApiStep): string {
  const pathParams = step.request.pathParams ?? {};
  const pathParamPattern = /{([^}]+)}/g;
  let cursor = 0;
  let expression = '`';
  let match: RegExpExecArray | null;

  while ((match = pathParamPattern.exec(step.path)) !== null) {
    const name = match[1];
    const value = pathParams[name];

    if (value === undefined) {
      throw new K6GenerationError(
        `step "${step.id}": missing request.pathParams.${name} for path ${step.path}`,
      );
    }

    expression += escapeTemplateLiteral(step.path.slice(cursor, match.index));
    expression += `\${encodeURIComponent(String(${compileValueExpression(value)}))}`;
    cursor = match.index + match[0].length;
  }

  expression += escapeTemplateLiteral(step.path.slice(cursor));
  expression += '`';
  return expression;
}

function renderHttpCall(
  httpCall: string,
  method: string,
  urlVariable: string,
  bodyVariable: string,
  paramsVariable: string,
  hasBodyValue: boolean,
): string {
  if (BODY_METHODS.has(method)) {
    const bodyArgument = hasBodyValue ? bodyVariable : 'null';
    return `http.${httpCall}(${urlVariable}, ${bodyArgument}, ${paramsVariable})`;
  }

  if (method === 'DELETE') {
    return `http.${httpCall}(${urlVariable}, null, ${paramsVariable})`;
  }

  return `http.${httpCall}(${urlVariable}, ${paramsVariable})`;
}

function renderExtract(
  step: ASTApiStep,
  index: number,
  responseVariable: string,
  urlVariable: string,
  metadataVariable: string,
): string[] {
  if (!step.extract || Object.keys(step.extract).length === 0) {
    return [];
  }

  const jsonVariable = `res${index}Json`;
  const lines = [`const ${jsonVariable} = ${responseVariable}.json();`];

  Object.entries(step.extract).forEach(([variableName, rule], extractIndex) => {
    const valueVariable = `extract${index}_${extractIndex}`;
    const checkVariable = `extractCheck${index}_${extractIndex}`;

    lines.push(
      `const ${valueVariable} = readJsonPath(${jsonVariable}, ${JSON.stringify(compileJsonPathSegments(rule.from))});`,
      `${compileContextReference(variableName)} = ${valueVariable};`,
      `const ${checkVariable} = check(${responseVariable}, {`,
      `  ${JSON.stringify(`${step.id} extract ${variableName}`)}: () => ${valueVariable} !== undefined,`,
      '});',
      `if (!${checkVariable}) {`,
      `  logFailedCheck(${metadataVariable}, ${JSON.stringify(`extract ${variableName}`)}, ${urlVariable}, ${responseVariable});`,
      '}',
    );
  });

  return lines;
}

function renderMultipartFileDeclarations(ast: ASTScenario, options: K6GeneratorOptions): string[] {
  const declarations: string[] = [];

  ast.steps.forEach((step, stepIndex) => {
    if (isASTInputStep(step)) {
      return;
    }

    Object.values(step.request.multipart?.files ?? {}).forEach((file, fileIndex) => {
      declarations.push(
        `const ${renderMultipartFileVariable(stepIndex, fileIndex)} = open(${JSON.stringify(resolveMultipartOpenPath(ast, file.path, options))}, 'b');`,
      );
    });
  });

  return declarations;
}

function renderMultipartBody(step: ASTApiStep, stepIndex: number): string {
  const multipart = step.request.multipart;

  if (multipart === undefined) {
    throw new K6GenerationError(`step "${step.id}": request.multipart is missing`);
  }

  const entries = [
    ...Object.entries(multipart.fields ?? {}).map(
      ([fieldName, value]) => `${JSON.stringify(fieldName)}: ${compileValueExpression(value)}`,
    ),
    ...Object.entries(multipart.files).map(
      ([fieldName, file], fileIndex) => {
        const fileVariable = renderMultipartFileVariable(stepIndex, fileIndex);
        const filename = file.filename ?? path.basename(file.path);
        const args = [
          fileVariable,
          compileValueExpression(filename),
          ...(file.contentType === undefined ? [] : [compileValueExpression(file.contentType)]),
        ];

        return `${JSON.stringify(fieldName)}: http.file(${args.join(', ')})`;
      },
    ),
  ];

  return `{ ${entries.join(', ')} }`;
}

function renderMultipartFileVariable(stepIndex: number, fileIndex: number): string {
  return `multipartFile${stepIndex}_${fileIndex}`;
}

function resolveMultipartOpenPath(ast: ASTScenario, filePath: string, options: K6GeneratorOptions): string {
  validateMultipartFilePath(filePath);

  const fileRootDir = path.resolve(options.fileRootDir ?? 'openapi-k6');
  const outputPath = options.outputPath === undefined
    ? path.join(fileRootDir, 'generated', `${ast.name}.k6.js`)
    : path.resolve(options.outputPath);
  const outputDir = path.dirname(outputPath);
  const absoluteFilePath = path.resolve(fileRootDir, filePath);
  const relativePath = path.relative(outputDir, absoluteFilePath) || path.basename(absoluteFilePath);
  const normalizedPath = relativePath.split(path.sep).join('/');

  return normalizedPath.startsWith('.') ? normalizedPath : `./${normalizedPath}`;
}

function validateMultipartFilePath(filePath: string): void {
  if (!filePath.trim()) {
    throw new K6GenerationError('request.multipart file path must not be empty');
  }

  if (filePath.includes('{{')) {
    throw new K6GenerationError('request.multipart file path must be a static path without templates');
  }

  if (path.isAbsolute(filePath)) {
    throw new K6GenerationError('request.multipart file path must be relative to the workspace directory');
  }

  if (filePath.trim().split(/[\\/]+/).includes('..')) {
    throw new K6GenerationError('request.multipart file path must stay inside the workspace directory');
  }
}

function renderCondition(
  step: ASTApiStep,
  index: number,
  responseVariable: string,
  urlVariable: string,
  metadataVariable: string,
): string[] {
  // ponytail: k6 check 실패는 현재 iteration을 중단하지 않음, scenario 실패 정책을 설정 가능하게 만들 때 재검토
  const expression = step.condition ?? 'status < 400';
  const condition = step.condition === undefined
    ? { operator: '<', status: 400 }
    : compileCondition(step.condition, step.id);
  const checkVariable = `check${index}`;
  return [
    `const ${checkVariable} = check(${responseVariable}, {`,
    `  ${JSON.stringify(`${step.id} ${expression}`)}: (res) => res.status ${condition.operator} ${condition.status},`,
    '});',
    `if (!${checkVariable}) {`,
    `  logFailedCheck(${metadataVariable}, ${JSON.stringify(expression)}, ${urlVariable}, ${responseVariable});`,
    '}',
  ];
}

function compileCondition(condition: string, stepId: string): { operator: string; status: number } {
  const parsed = parseStatusCondition(condition);

  if (parsed === undefined) {
    throw new K6GenerationError(formatUnsupportedConditionError(stepId, condition));
  }

  return parsed;
}

function buildHeaders(
  request: StepRequest,
  includeJsonContentType: boolean,
  omitContentType = false,
): Record<string, unknown> | undefined {
  const headers: Record<string, unknown> = {};

  if (includeJsonContentType && !hasHeader(request.headers, 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  if (request.headers) {
    for (const [key, value] of Object.entries(request.headers)) {
      if (omitContentType && key.toLowerCase() === 'content-type') {
        continue;
      }

      headers[key] = value;
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function renderRequestParams(
  headers: Record<string, unknown> | undefined,
  tagsVariable: string,
): string {
  if (headers === undefined) {
    return `{ tags: ${tagsVariable} }`;
  }

  return `{ headers: ${compileValueExpression(headers)}, tags: ${tagsVariable} }`;
}

function renderLogMetadata(scenarioName: string, step: ASTApiStep, method: string): string {
  return renderStringRecord({
    scenario: scenarioName,
    step: step.id,
    method,
    path: step.path,
  });
}

function renderRequestTags(scenarioName: string, step: ASTApiStep, method: string): string {
  return renderStringRecord({
    openapi_scenario: scenarioName,
    openapi_step: step.id,
    openapi_method: method,
    openapi_path: step.path,
    openapi_api: `${method} ${step.path}`,
  });
}

function renderStringRecord(value: Record<string, string>): string {
  const entries = Object.entries(value).map(
    ([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item)}`,
  );

  return `{ ${entries.join(', ')} }`;
}

function hasHeader(headers: Record<string, unknown> | undefined, headerName: string): boolean {
  if (!headers) {
    return false;
  }

  return Object.keys(headers).some((key) => key.toLowerCase() === headerName);
}

function hasRequestEntries(value: Record<string, unknown> | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0;
}

function hasQuery(ast: ASTScenario): boolean {
  return ast.steps.some((step) => isASTApiStep(step) && hasRequestEntries(step.request.query));
}

function hasExtract(ast: ASTScenario): boolean {
  return ast.steps.some((step) => isASTApiStep(step) && step.extract && Object.keys(step.extract).length > 0);
}

function hasChecks(ast: ASTScenario): boolean {
  return ast.steps.some(isASTApiStep) || hasExtract(ast);
}

function hasSteps(ast: ASTScenario): boolean {
  return ast.steps.length > 0;
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

function compileContextReference(variableName: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(variableName)
    ? `context.${variableName}`
    : `context[${JSON.stringify(variableName)}]`;
}

function compileVarsReference(variableName: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(variableName)
    ? `VARS.${variableName}`
    : `VARS[${JSON.stringify(variableName)}]`;
}

function escapeTemplateLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}
