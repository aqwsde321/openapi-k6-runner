import type { ASTScenario, ASTStep, StepRequest } from '../core/types.js';
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

export interface K6GeneratorOptions {
  baseUrl?: string;
}

export class K6GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'K6GenerationError';
  }
}

export function generateK6Script(ast: ASTScenario, options: K6GeneratorOptions = {}): string {
  const baseUrl = options.baseUrl?.trim();

  if (!baseUrl) {
    throw new K6GenerationError('BASE_URL is required to generate a k6 script');
  }

  const lines: string[] = [
    "import http from 'k6/http';",
  ];

  const k6Imports = [
    ...(hasCondition(ast) ? ['check'] : []),
    ...(hasSteps(ast) ? ['group'] : []),
  ];

  if (k6Imports.length > 0) {
    lines.push(`import { ${k6Imports.join(', ')} } from 'k6';`);
  }

  lines.push(
    '',
    `const BASE_URL = __ENV.BASE_URL || ${JSON.stringify(baseUrl)};`,
    "const OPENAPI_K6_TRACE = __ENV.OPENAPI_K6_TRACE === '1';",
    '',
    ...renderHelpers(ast),
    '',
    'export default function () {',
    '  const context = {};',
  );

  ast.steps.forEach((step, index) => {
    lines.push('', ...renderStep(ast.name, step, index));
  });

  lines.push('}', '');
  return lines.join('\n');
}

function renderHelpers(ast: ASTScenario): string[] {
  const helpers = [
    'function joinUrl(baseUrl, endpointPath) {',
    "  return `${baseUrl.replace(/\\/+$/, '')}/${endpointPath.replace(/^\\/+/, '')}`;",
    '}',
  ];

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
      '    url,',
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

  if (hasCondition(ast)) {
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
      '    url,',
      '    durationMs: response.timings.duration,',
      '    responseBody: truncateLogValue(response.body, 2000),',
      '  }, null, 2));',
      '}',
    );
  }

  return helpers;
}

function renderStep(scenarioName: string, step: ASTStep, index: number): string[] {
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
    `${hasQueryValue ? 'let' : 'const'} ${urlVariable} = joinUrl(BASE_URL, ${compilePathExpression(step)});`,
  );

  if (hasQueryValue) {
    innerLines.push(`${urlVariable} = appendQuery(${urlVariable}, ${compileValueExpression(step.request.query)});`);
  }

  const hasBodyValue = step.request.body !== undefined && BODY_METHODS.has(method);
  if (hasBodyValue) {
    innerLines.push(`const ${bodyVariable} = JSON.stringify(${compileValueExpression(step.request.body)});`);
  }

  const headers = buildHeaders(step.request, hasBodyValue);
  innerLines.push(`const ${paramsVariable} = ${renderRequestParams(headers, tagsVariable)};`);

  innerLines.push(`logStepStart(${metadataVariable}, ${urlVariable});`);
  innerLines.push(`const ${responseVariable} = ${renderHttpCall(httpCall, method, urlVariable, bodyVariable, paramsVariable, hasBodyValue)};`);
  innerLines.push(`logStepEnd(${metadataVariable}, ${responseVariable});`);
  innerLines.push(...renderCondition(step, index, responseVariable, urlVariable, metadataVariable));
  innerLines.push(...renderExtract(step, index, responseVariable));

  return [
    `  group(${JSON.stringify(`${step.id} ${method} ${step.path}`)}, () => {`,
    ...innerLines.map((line) => `    ${line}`),
    '  });',
  ];
}

function compilePathExpression(step: ASTStep): string {
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

function renderExtract(step: ASTStep, index: number, responseVariable: string): string[] {
  if (!step.extract || Object.keys(step.extract).length === 0) {
    return [];
  }

  const jsonVariable = `res${index}Json`;
  const lines = [`const ${jsonVariable} = ${responseVariable}.json();`];

  for (const [variableName, rule] of Object.entries(step.extract)) {
    lines.push(
      `${compileContextReference(variableName)} = readJsonPath(${jsonVariable}, ${JSON.stringify(compileJsonPathSegments(rule.from))});`,
    );
  }

  return lines;
}

function renderCondition(
  step: ASTStep,
  index: number,
  responseVariable: string,
  urlVariable: string,
  metadataVariable: string,
): string[] {
  if (step.condition === undefined) {
    return [];
  }

  const condition = compileCondition(step.condition, step.id);
  const checkVariable = `check${index}`;
  return [
    `const ${checkVariable} = check(${responseVariable}, {`,
    `  ${JSON.stringify(`${step.id} ${step.condition}`)}: (res) => res.status ${condition.operator} ${condition.status},`,
    '});',
    `if (!${checkVariable}) {`,
    `  logFailedCheck(${metadataVariable}, ${JSON.stringify(step.condition)}, ${urlVariable}, ${responseVariable});`,
    '}',
  ];
}

function compileCondition(condition: string, stepId: string): { operator: string; status: number } {
  const match = /^status\s*(==|!=|>=|<)\s*(\d{3})$/.exec(condition.trim());

  if (!match) {
    throw new K6GenerationError(
      `step "${stepId}": unsupported condition "${condition}"`,
    );
  }

  const operator = match[1] === '=='
    ? '==='
    : match[1] === '!='
      ? '!=='
      : match[1];

  return { operator, status: Number(match[2]) };
}

function buildHeaders(
  request: StepRequest,
  includeJsonContentType: boolean,
): Record<string, unknown> | undefined {
  const headers: Record<string, unknown> = {};

  if (includeJsonContentType && !hasHeader(request.headers, 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  if (request.headers) {
    Object.assign(headers, request.headers);
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

function renderLogMetadata(scenarioName: string, step: ASTStep, method: string): string {
  return renderStringRecord({
    scenario: scenarioName,
    step: step.id,
    method,
    path: step.path,
  });
}

function renderRequestTags(scenarioName: string, step: ASTStep, method: string): string {
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
  return ast.steps.some((step) => hasRequestEntries(step.request.query));
}

function hasExtract(ast: ASTScenario): boolean {
  return ast.steps.some((step) => step.extract && Object.keys(step.extract).length > 0);
}

function hasCondition(ast: ASTScenario): boolean {
  return ast.steps.some((step) => step.condition !== undefined);
}

function hasSteps(ast: ASTScenario): boolean {
  return ast.steps.length > 0;
}

function compileContextReference(variableName: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(variableName)
    ? `context.${variableName}`
    : `context[${JSON.stringify(variableName)}]`;
}

function escapeTemplateLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}
