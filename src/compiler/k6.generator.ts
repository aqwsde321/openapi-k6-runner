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

  if (hasCondition(ast)) {
    lines.push("import { check } from 'k6';");
  }

  lines.push(
    '',
    `const BASE_URL = __ENV.BASE_URL || ${JSON.stringify(baseUrl)};`,
    '',
    ...renderHelpers(ast),
    '',
    'export default function () {',
    '  const context = {};',
  );

  ast.steps.forEach((step, index) => {
    lines.push('', ...renderStep(step, index));
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
      'function logFailedCheck(stepId, condition, url, response) {',
      '  console.error(JSON.stringify({',
      "    type: 'openapi-k6-check-failed',",
      '    step: stepId,',
      '    condition,',
      '    status: response.status,',
      '    url,',
      '    responseBody: truncateLogValue(response.body, 2000),',
      '  }, null, 2));',
      '}',
    );
  }

  return helpers;
}

function renderStep(step: ASTStep, index: number): string[] {
  const lines: string[] = [];
  const urlVariable = `url${index}`;
  const responseVariable = `res${index}`;
  const bodyVariable = `body${index}`;
  const paramsVariable = `params${index}`;
  const method = step.method.toUpperCase();
  const httpCall = HTTP_CALLS[method];

  if (!httpCall) {
    throw new K6GenerationError(`step "${step.id}": unsupported HTTP method ${step.method}`);
  }

  const hasQueryValue = hasRequestEntries(step.request.query);
  lines.push(
    `  ${hasQueryValue ? 'let' : 'const'} ${urlVariable} = joinUrl(BASE_URL, ${compilePathExpression(step)});`,
  );

  if (hasQueryValue) {
    lines.push(`  ${urlVariable} = appendQuery(${urlVariable}, ${compileValueExpression(step.request.query)});`);
  }

  const hasBodyValue = step.request.body !== undefined && BODY_METHODS.has(method);
  if (hasBodyValue) {
    lines.push(`  const ${bodyVariable} = JSON.stringify(${compileValueExpression(step.request.body)});`);
  }

  const headers = buildHeaders(step.request, hasBodyValue);
  if (headers !== undefined) {
    lines.push(`  const ${paramsVariable} = { headers: ${compileValueExpression(headers)} };`);
  }

  lines.push(`  const ${responseVariable} = ${renderHttpCall(httpCall, method, urlVariable, bodyVariable, paramsVariable, hasBodyValue, headers !== undefined)};`);
  lines.push(...renderCondition(step, index, responseVariable, urlVariable));
  lines.push(...renderExtract(step, index, responseVariable));
  return lines;
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
  hasParams: boolean,
): string {
  if (BODY_METHODS.has(method)) {
    const bodyArgument = hasBodyValue ? bodyVariable : 'null';
    return hasParams
      ? `http.${httpCall}(${urlVariable}, ${bodyArgument}, ${paramsVariable})`
      : `http.${httpCall}(${urlVariable}, ${bodyArgument})`;
  }

  if (method === 'DELETE' && hasParams) {
    return `http.${httpCall}(${urlVariable}, null, ${paramsVariable})`;
  }

  return hasParams
    ? `http.${httpCall}(${urlVariable}, ${paramsVariable})`
    : `http.${httpCall}(${urlVariable})`;
}

function renderExtract(step: ASTStep, index: number, responseVariable: string): string[] {
  if (!step.extract || Object.keys(step.extract).length === 0) {
    return [];
  }

  const jsonVariable = `res${index}Json`;
  const lines = [`  const ${jsonVariable} = ${responseVariable}.json();`];

  for (const [variableName, rule] of Object.entries(step.extract)) {
    lines.push(
      `  ${compileContextReference(variableName)} = readJsonPath(${jsonVariable}, ${JSON.stringify(compileJsonPathSegments(rule.from))});`,
    );
  }

  return lines;
}

function renderCondition(
  step: ASTStep,
  index: number,
  responseVariable: string,
  urlVariable: string,
): string[] {
  if (step.condition === undefined) {
    return [];
  }

  const condition = compileCondition(step.condition, step.id);
  const checkVariable = `check${index}`;
  return [
    `  const ${checkVariable} = check(${responseVariable}, {`,
    `    ${JSON.stringify(`${step.id} ${step.condition}`)}: (res) => res.status ${condition.operator} ${condition.status},`,
    '  });',
    `  if (!${checkVariable}) {`,
    `    logFailedCheck(${JSON.stringify(step.id)}, ${JSON.stringify(step.condition)}, ${urlVariable}, ${responseVariable});`,
    '  }',
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
