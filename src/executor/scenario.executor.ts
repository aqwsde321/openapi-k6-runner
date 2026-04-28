import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import type { ASTScenario, ASTStep, MultipartFile, StepRequest } from '../core/types.js';
import { compileJsonPathSegments } from '../utils/jsonpath.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const CONTEXT_REFERENCE = '[A-Za-z_$][A-Za-z0-9_$]*';
const ENV_REFERENCE = 'env\\.[A-Z_][A-Z0-9_]*';
const TEMPLATE_REFERENCE = `(?:${ENV_REFERENCE}|${CONTEXT_REFERENCE})`;
const TEMPLATE_PATTERN = new RegExp(`{{\\s*(${TEMPLATE_REFERENCE})\\s*}}`, 'g');
const FULL_TEMPLATE_PATTERN = new RegExp(`^{{\\s*(${TEMPLATE_REFERENCE})\\s*}}$`);
const DEFAULT_RESPONSE_BODY_LIMIT = 2000;

type FetchLike = typeof fetch;
type MaybePromise<T> = T | Promise<T>;

export interface ScenarioExecutorOptions {
  baseUrl: string;
  fileRootDir?: string;
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  responseBodyLimit?: number;
  reporter?: ScenarioExecutionReporter;
}

export interface ScenarioExecutionReporter {
  onScenarioStart?(event: ScenarioStartEvent): MaybePromise<void>;
  onStepStart?(event: StepStartEvent): MaybePromise<void>;
  onStepRequest?(event: StepRequestEvent): MaybePromise<void>;
  onStepEnd?(event: StepEndEvent): MaybePromise<void>;
  onScenarioEnd?(result: ScenarioExecutionResult): MaybePromise<void>;
}

export interface ScenarioStartEvent {
  scenario: string;
  baseUrl: string;
  totalSteps: number;
  secretValues: string[];
}

export interface StepStartEvent {
  scenario: string;
  index: number;
  totalSteps: number;
  id: string;
  method: string;
  path: string;
  secretValues: string[];
}

export interface StepRequestEvent extends StepStartEvent {
  url: string;
}

export interface StepEndEvent {
  scenario: string;
  index: number;
  totalSteps: number;
  result: StepExecutionResult;
  secretValues: string[];
}

export interface ScenarioExecutionResult {
  scenario: string;
  baseUrl: string;
  durationMs: number;
  passed: boolean;
  steps: StepExecutionResult[];
  secretValues: string[];
}

export interface StepExecutionResult {
  index: number;
  id: string;
  method: string;
  path: string;
  url?: string;
  durationMs: number;
  passed: boolean;
  response?: StepResponseResult;
  condition?: ConditionExecutionResult;
  extracts: ExtractExecutionResult[];
  error?: string;
}

export interface StepResponseResult {
  status: number;
  statusText: string;
  body: string;
}

export interface ConditionExecutionResult {
  expression: string;
  passed: boolean;
}

export interface ExtractExecutionResult {
  name: string;
  path: string;
  passed: boolean;
  valuePreview?: string;
  error?: string;
}

interface RuntimeState {
  context: Record<string, unknown>;
  env: Record<string, string | undefined>;
  secretValues: Set<string>;
}

interface RuntimeRequest {
  url: string;
  init: RequestInit;
}

interface ParsedCondition {
  operator: '===' | '!==' | '>=' | '<';
  status: number;
}

export class ScenarioExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioExecutionError';
  }
}

export async function executeAstScenario(
  ast: ASTScenario,
  options: ScenarioExecutorOptions,
): Promise<ScenarioExecutionResult> {
  const baseUrl = options.baseUrl.trim();

  if (!baseUrl) {
    throw new ScenarioExecutionError('baseUrl is required to test a scenario');
  }

  const state: RuntimeState = {
    context: {},
    env: options.env ?? process.env,
    secretValues: new Set(),
  };
  const fetchImpl = options.fetch ?? fetch;
  const fileRootDir = path.resolve(options.fileRootDir ?? 'load-tests');
  const scenarioStartedAt = performance.now();
  const reporter = options.reporter;
  const steps: StepExecutionResult[] = [];

  await reporter?.onScenarioStart?.({
    scenario: ast.name,
    baseUrl,
    totalSteps: ast.steps.length,
    secretValues: [...state.secretValues],
  });

  for (const [index, step] of ast.steps.entries()) {
    steps.push(await executeStep(step, index, {
      baseUrl,
      fetchImpl,
      fileRootDir,
      state,
      reporter,
      scenario: ast.name,
      totalSteps: ast.steps.length,
    }));
  }

  const result = {
    scenario: ast.name,
    baseUrl,
    durationMs: performance.now() - scenarioStartedAt,
    passed: steps.every((step) => step.passed),
    steps,
    secretValues: [...state.secretValues],
  };

  await reporter?.onScenarioEnd?.(result);

  return result;
}

export function formatScenarioExecutionReport(
  result: ScenarioExecutionResult,
  options: { responseBodyLimit?: number } = {},
): string {
  const responseBodyLimit = options.responseBodyLimit ?? DEFAULT_RESPONSE_BODY_LIMIT;
  const lines = [
    `Scenario: ${result.scenario}`,
    `Base URL: ${maskText(result.baseUrl, result.secretValues)}`,
    '',
  ];

  for (const step of result.steps) {
    lines.push(`[${step.index + 1}/${result.steps.length}] ${step.id}`);
    lines.push(`${step.method} ${step.path}`);

    if (step.url !== undefined) {
      lines.push(`url: ${maskText(step.url, result.secretValues)}`);
    }

    if (step.response !== undefined) {
      const statusText = step.response.statusText ? ` ${step.response.statusText}` : '';
      lines.push(`status: ${step.response.status}${statusText}`);
    }

    lines.push(`duration: ${Math.round(step.durationMs)}ms`);

    if (step.condition !== undefined) {
      lines.push(`condition: ${step.condition.expression} ${step.condition.passed ? 'pass' : 'fail'}`);
    }

    if (step.extracts.length > 0) {
      lines.push('extract:');
      for (const extract of step.extracts) {
        if (extract.passed) {
          lines.push(`  ${extract.name}: ok`);
        } else {
          lines.push(`  ${extract.name}: fail (${extract.error ?? 'unknown error'})`);
        }
      }
    }

    if (step.error !== undefined) {
      lines.push(`error: ${maskText(step.error, result.secretValues)}`);
    }

    if (!step.passed && step.response?.body) {
      lines.push('response body:');
      lines.push(maskText(truncateText(step.response.body, responseBodyLimit), result.secretValues));
    }

    lines.push('');
  }

  lines.push(`Result: ${result.passed ? 'PASS' : 'FAIL'}`);
  return `${lines.join('\n')}\n`;
}

async function executeStep(
  step: ASTStep,
  index: number,
  options: {
    baseUrl: string;
    fetchImpl: FetchLike;
    fileRootDir: string;
    state: RuntimeState;
    reporter?: ScenarioExecutionReporter;
    scenario: string;
    totalSteps: number;
  },
): Promise<StepExecutionResult> {
  const startedAt = performance.now();
  const method = step.method.toUpperCase();
  let url: string | undefined;
  const startEvent: StepStartEvent = {
    scenario: options.scenario,
    index,
    totalSteps: options.totalSteps,
    id: step.id,
    method,
    path: step.path,
    secretValues: [...options.state.secretValues],
  };

  await options.reporter?.onStepStart?.(startEvent);

  let result: StepExecutionResult;

  try {
    const parsedCondition = step.condition === undefined
      ? undefined
      : parseCondition(step.condition, step.id);
    const request = await buildRuntimeRequest(step, method, options.baseUrl, options.fileRootDir, options.state);
    url = request.url;
    await options.reporter?.onStepRequest?.({
      ...startEvent,
      url,
      secretValues: [...options.state.secretValues],
    });
    const response = await options.fetchImpl(request.url, request.init);
    const body = await response.text();
    const responseResult = {
      status: response.status,
      statusText: response.statusText,
      body,
    };
    const condition = step.condition === undefined || parsedCondition === undefined
      ? undefined
      : {
          expression: step.condition,
          passed: evaluateCondition(response.status, parsedCondition),
        };
    const extracts = evaluateExtracts(step, body, options.state);
    const passed = (condition?.passed ?? true) && extracts.every((extract) => extract.passed);

    result = {
      index,
      id: step.id,
      method,
      path: step.path,
      url,
      durationMs: performance.now() - startedAt,
      passed,
      response: responseResult,
      ...(condition === undefined ? {} : { condition }),
      extracts,
    };
  } catch (error) {
    result = {
      index,
      id: step.id,
      method,
      path: step.path,
      ...(url === undefined ? {} : { url }),
      durationMs: performance.now() - startedAt,
      passed: false,
      extracts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await options.reporter?.onStepEnd?.({
    scenario: options.scenario,
    index,
    totalSteps: options.totalSteps,
    result,
    secretValues: [...options.state.secretValues],
  });

  return result;
}

async function buildRuntimeRequest(
  step: ASTStep,
  method: string,
  baseUrl: string,
  fileRootDir: string,
  state: RuntimeState,
): Promise<RuntimeRequest> {
  const hasBody = step.request.body !== undefined;
  const hasMultipart = step.request.multipart !== undefined;

  if (hasBody && hasMultipart) {
    throw new ScenarioExecutionError(`step "${step.id}": request.body and request.multipart cannot be used together`);
  }

  if (hasMultipart && !BODY_METHODS.has(method)) {
    throw new ScenarioExecutionError(`step "${step.id}": request.multipart is only supported for POST, PUT, or PATCH`);
  }

  let url = joinUrl(baseUrl, compilePath(step, state));
  url = appendQuery(url, evaluateRecord(step.request.query, state));

  const hasJsonBody = hasBody && BODY_METHODS.has(method);
  const headers = buildHeaders(step.request, hasJsonBody, hasMultipart, state);
  const init: RequestInit = {
    method,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  };

  if (hasJsonBody) {
    init.body = JSON.stringify(evaluateTemplateValue(step.request.body, state));
  } else if (hasMultipart) {
    init.body = await buildMultipartBody(step, fileRootDir, state);
  }

  return { url, init };
}

function compilePath(step: ASTStep, state: RuntimeState): string {
  const pathParams = step.request.pathParams ?? {};
  const pathParamPattern = /{([^}]+)}/g;
  let cursor = 0;
  let output = '';
  let match: RegExpExecArray | null;

  while ((match = pathParamPattern.exec(step.path)) !== null) {
    const name = match[1];
    const rawValue = pathParams[name];

    if (rawValue === undefined) {
      throw new ScenarioExecutionError(
        `step "${step.id}": missing request.pathParams.${name} for path ${step.path}`,
      );
    }

    output += step.path.slice(cursor, match.index);
    output += encodeURIComponent(String(evaluateTemplateValue(rawValue, state)));
    cursor = match.index + match[0].length;
  }

  output += step.path.slice(cursor);
  return output;
}

function appendQuery(url: string, query: Record<string, unknown> | undefined): string {
  if (query === undefined || Object.keys(query).length === 0) {
    return url;
  }

  const search = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

  return search ? `${url}${url.includes('?') ? '&' : '?'}${search}` : url;
}

function buildHeaders(
  request: StepRequest,
  includeJsonContentType: boolean,
  omitContentType: boolean,
  state: RuntimeState,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (includeJsonContentType && !hasHeader(request.headers, 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  for (const [key, rawValue] of Object.entries(request.headers ?? {})) {
    if (omitContentType && key.toLowerCase() === 'content-type') {
      continue;
    }

    const value = evaluateTemplateValue(rawValue, state);

    if (value !== undefined && value !== null) {
      headers[key] = String(value);
    }
  }

  return headers;
}

async function buildMultipartBody(step: ASTStep, fileRootDir: string, state: RuntimeState): Promise<FormData> {
  const multipart = step.request.multipart;

  if (multipart === undefined) {
    throw new ScenarioExecutionError(`step "${step.id}": request.multipart is missing`);
  }

  const form = new FormData();

  for (const [fieldName, rawValue] of Object.entries(multipart.fields ?? {})) {
    const value = evaluateTemplateValue(rawValue, state);
    form.append(fieldName, formatFormFieldValue(value));
  }

  for (const [fieldName, file] of Object.entries(multipart.files)) {
    const filePath = resolveMultipartFilePath(fileRootDir, file);
    const data = await fs.readFile(filePath);
    const blob = new Blob([data], file.contentType === undefined ? {} : { type: file.contentType });
    form.append(fieldName, blob, file.filename ?? path.basename(file.path));
  }

  return form;
}

function resolveMultipartFilePath(fileRootDir: string, file: MultipartFile): string {
  validateMultipartFilePath(file.path);
  return path.resolve(fileRootDir, file.path);
}

function validateMultipartFilePath(filePath: string): void {
  if (!filePath.trim()) {
    throw new ScenarioExecutionError('request.multipart file path must not be empty');
  }

  if (filePath.includes('{{')) {
    throw new ScenarioExecutionError('request.multipart file path must be a static path without templates');
  }

  if (path.isAbsolute(filePath)) {
    throw new ScenarioExecutionError('request.multipart file path must be relative to the load-tests directory');
  }

  if (filePath.trim().split(/[\\/]+/).includes('..')) {
    throw new ScenarioExecutionError('request.multipart file path must stay inside the load-tests directory');
  }
}

function evaluateExtracts(step: ASTStep, body: string, state: RuntimeState): ExtractExecutionResult[] {
  const entries = Object.entries(step.extract ?? {});

  if (entries.length === 0) {
    return [];
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return entries.map(([name, rule]) => ({
      name,
      path: rule.from,
      passed: false,
      error: `response body is not valid JSON: ${message}`,
    }));
  }

  return entries.map(([name, rule]) => {
    try {
      const value = readJsonPath(parsedBody, compileJsonPathSegments(rule.from));

      if (value === undefined) {
        return {
          name,
          path: rule.from,
          passed: false,
          error: 'value is undefined',
        };
      }

      state.context[name] = value;
      return {
        name,
        path: rule.from,
        passed: true,
        valuePreview: formatPreview(value),
      };
    } catch (error) {
      return {
        name,
        path: rule.from,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function readJsonPath(value: unknown, segments: Array<string | number>): unknown {
  return segments.reduce<unknown>(
    (current, key) => current == null ? undefined : (current as Record<string, unknown>)[key],
    value,
  );
}

function parseCondition(condition: string, stepId: string): ParsedCondition {
  const match = /^status\s*(==|!=|>=|<)\s*(\d{3})$/.exec(condition.trim());

  if (!match) {
    throw new ScenarioExecutionError(`step "${stepId}": unsupported condition "${condition}"`);
  }

  const operator = match[1] === '=='
    ? '==='
    : match[1] === '!='
      ? '!=='
      : match[1];

  return { operator: operator as ParsedCondition['operator'], status: Number(match[2]) };
}

function evaluateCondition(status: number, condition: ParsedCondition): boolean {
  switch (condition.operator) {
    case '===':
      return status === condition.status;
    case '!==':
      return status !== condition.status;
    case '>=':
      return status >= condition.status;
    case '<':
      return status < condition.status;
  }
}

function evaluateRecord(
  value: Record<string, unknown> | undefined,
  state: RuntimeState,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, evaluateTemplateValue(item, state)]),
  );
}

function evaluateTemplateValue(value: unknown, state: RuntimeState): unknown {
  if (typeof value === 'string') {
    return evaluateTemplateString(value, state);
  }

  if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => evaluateTemplateValue(item, state));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, evaluateTemplateValue(item, state)]),
    );
  }

  throw new ScenarioExecutionError(`Unsupported template value: ${String(value)}`);
}

function evaluateTemplateString(value: string, state: RuntimeState): unknown {
  const fullTemplate = FULL_TEMPLATE_PATTERN.exec(value);

  if (fullTemplate) {
    return resolveTemplateReference(fullTemplate[1], state);
  }

  if (!value.includes('{{')) {
    return value;
  }

  TEMPLATE_PATTERN.lastIndex = 0;

  let cursor = 0;
  let output = '';
  let match: RegExpExecArray | null;

  while ((match = TEMPLATE_PATTERN.exec(value)) !== null) {
    const literal = value.slice(cursor, match.index);

    if (literal.includes('{{') || literal.includes('}}')) {
      throw new ScenarioExecutionError(`Invalid template string: ${value}`);
    }

    output += literal;
    output += String(resolveTemplateReference(match[1], state));
    cursor = match.index + match[0].length;
  }

  if (cursor === 0 || value.slice(cursor).includes('{{') || value.slice(cursor).includes('}}')) {
    throw new ScenarioExecutionError(`Invalid template string: ${value}`);
  }

  output += value.slice(cursor);
  return output;
}

function resolveTemplateReference(reference: string, state: RuntimeState): unknown {
  if (reference.startsWith('env.')) {
    const name = reference.slice('env.'.length);
    const value = state.env[name];

    if (value === undefined) {
      throw new ScenarioExecutionError(`Missing env.${name} for template "{{${reference}}}"`);
    }

    if (value !== '') {
      state.secretValues.add(value);
    }

    return value;
  }

  if (!Object.prototype.hasOwnProperty.call(state.context, reference)) {
    throw new ScenarioExecutionError(`Missing context.${reference} for template "{{${reference}}}"`);
  }

  return state.context[reference];
}

function joinUrl(baseUrl: string, endpointPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${endpointPath.replace(/^\/+/, '')}`;
}

function hasHeader(headers: Record<string, unknown> | undefined, headerName: string): boolean {
  if (!headers) {
    return false;
  }

  return Object.keys(headers).some((key) => key.toLowerCase() === headerName);
}

function formatFormFieldValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatPreview(value: unknown): string {
  if (typeof value === 'string') {
    return truncateText(value, 80);
  }

  return truncateText(JSON.stringify(value), 80);
}

function truncateText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...<truncated ${value.length - limit} chars>` : value;
}

function maskText(value: string, secretValues: string[]): string {
  return secretValues
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((text, secret) => text.split(secret).join('***'), value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
