import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  evaluateStatusCondition,
  formatUnsupportedConditionError,
  parseStatusCondition,
  type StatusCondition,
} from '../core/condition.js';
import { isASTInputStep, type ASTApiStep, type ASTInputStep, type ASTScenario, type ASTStep, type MultipartFile, type StepRequest } from '../core/types.js';
import { compileJsonPathSegments } from '../utils/jsonpath.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const CONTEXT_REFERENCE = '[A-Za-z_$][A-Za-z0-9_$]*';
const ENV_REFERENCE = 'env\\.[A-Z_][A-Z0-9_]*';
const VARS_REFERENCE = 'vars\\.[A-Za-z_$][A-Za-z0-9_$]*';
const K6_REFERENCE = 'k6\\.(?:run\\.id|scenario\\.(?:iterationInInstance|iterationInTest)|vu\\.(?:idInInstance|idInTest|iterationInInstance|iterationInScenario))';
const TEMPLATE_REFERENCE = `(?:${ENV_REFERENCE}|${VARS_REFERENCE}|${K6_REFERENCE}|${CONTEXT_REFERENCE})`;
const TEMPLATE_PATTERN = new RegExp(`{{\\s*(${TEMPLATE_REFERENCE})\\s*}}`, 'g');
const FULL_TEMPLATE_PATTERN = new RegExp(`^{{\\s*(${TEMPLATE_REFERENCE})\\s*}}$`);
const DEFAULT_RESPONSE_BODY_LIMIT = 2000;
const DEFAULT_TEST_K6_VALUES: K6ExecutionValues = {
  'run.id': 'test-run',
  'scenario.iterationInInstance': 0,
  'scenario.iterationInTest': 0,
  'vu.idInInstance': 1,
  'vu.idInTest': 1,
  'vu.iterationInInstance': 0,
  'vu.iterationInScenario': 0,
};

type FetchLike = typeof fetch;
type MaybePromise<T> = T | Promise<T>;

export interface ScenarioExecutorOptions {
  baseUrl: string;
  moduleBaseUrls?: Record<string, string | undefined>;
  fileRootDir?: string;
  env?: Record<string, string | undefined>;
  k6?: Partial<K6ExecutionValues>;
  fetch?: FetchLike;
  responseBodyLimit?: number;
  captureRequestResponseValues?: boolean;
  inputProvider?: ScenarioInputProvider;
  reporter?: ScenarioExecutionReporter;
}

export interface K6ExecutionValues {
  'run.id': string;
  'scenario.iterationInInstance': number;
  'scenario.iterationInTest': number;
  'vu.idInInstance': number;
  'vu.idInTest': number;
  'vu.iterationInInstance': number;
  'vu.iterationInScenario': number;
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

export interface ScenarioInputRequest {
  scenario: string;
  index: number;
  totalSteps: number;
  id: string;
  name: string;
  label?: string;
  required: boolean;
  sensitive?: boolean;
  secretValues: string[];
}

export type ScenarioInputProvider = (request: ScenarioInputRequest) => MaybePromise<unknown>;

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
  request?: StepRequestResult;
  response?: StepResponseResult;
  input?: StepInputResult;
  condition?: ConditionExecutionResult;
  extracts: ExtractExecutionResult[];
  error?: string;
}

export interface StepInputResult {
  name: string;
  label?: string;
  source: 'vars' | 'prompt' | 'none';
  provided: boolean;
  sensitive?: boolean;
}

export interface StepRequestResult {
  headers?: Record<string, string>;
  body?: string;
}

export interface StepResponseResult {
  status: number;
  statusText: string;
  headers?: Record<string, string>;
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
  vars: Record<string, unknown>;
  k6: K6ExecutionValues;
  secretValues: Set<string>;
}

interface RuntimeRequest {
  url: string;
  init: RequestInit;
  details?: StepRequestResult;
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
  const moduleBaseUrls = normalizeModuleBaseUrls(options.moduleBaseUrls);

  if (!baseUrl) {
    throw new ScenarioExecutionError('baseUrl is required to test a scenario');
  }

  const state: RuntimeState = {
    context: {},
    env: options.env ?? process.env,
    vars: ast.vars ?? {},
    k6: {
      ...DEFAULT_TEST_K6_VALUES,
      ...(options.k6 ?? {}),
    },
    secretValues: new Set(),
  };
  const fetchImpl = options.fetch ?? fetch;
  const fileRootDir = path.resolve(options.fileRootDir ?? 'openapi-k6');
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
    const result = await executeStep(step, index, {
      baseUrl,
      moduleBaseUrls,
      fetchImpl,
      fileRootDir,
      state,
      captureRequestResponseValues: options.captureRequestResponseValues === true,
      inputProvider: options.inputProvider,
      reporter,
      scenario: ast.name,
      totalSteps: ast.steps.length,
    });
    steps.push(result);

    if (!result.passed) {
      break;
    }
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

    if (step.input !== undefined) {
      lines.push(`input: ${step.input.name} ${step.input.provided ? 'provided' : 'missing'}`);
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
    moduleBaseUrls: Map<string, string>;
    fetchImpl: FetchLike;
    fileRootDir: string;
    state: RuntimeState;
    captureRequestResponseValues: boolean;
    inputProvider?: ScenarioInputProvider;
    reporter?: ScenarioExecutionReporter;
    scenario: string;
    totalSteps: number;
  },
): Promise<StepExecutionResult> {
  if (isASTInputStep(step)) {
    return executeInputStep(step, index, {
      state: options.state,
      inputProvider: options.inputProvider,
      reporter: options.reporter,
      scenario: options.scenario,
      totalSteps: options.totalSteps,
    });
  }

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
    const request = await buildRuntimeRequest(
      step,
      method,
      resolveStepBaseUrl(step, options.baseUrl, options.moduleBaseUrls),
      options.fileRootDir,
      options.state,
      options.captureRequestResponseValues,
    );
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
      ...(options.captureRequestResponseValues ? { headers: Object.fromEntries(response.headers.entries()) } : {}),
      body,
    };
    const condition = step.condition === undefined || parsedCondition === undefined
      ? undefined
      : {
          expression: step.condition,
          passed: evaluateCondition(response.status, parsedCondition),
        };
    const extracts = evaluateExtracts(step, body, options.state);
    const statusPassed = condition?.passed ?? isDefaultStatusPassed(response.status);
    const passed = statusPassed && extracts.every((extract) => extract.passed);

    result = {
      index,
      id: step.id,
      method,
      path: step.path,
      url,
      durationMs: performance.now() - startedAt,
      passed,
      ...(request.details === undefined ? {} : { request: request.details }),
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

async function executeInputStep(
  step: ASTInputStep,
  index: number,
  options: {
    state: RuntimeState;
    inputProvider?: ScenarioInputProvider;
    reporter?: ScenarioExecutionReporter;
    scenario: string;
    totalSteps: number;
  },
): Promise<StepExecutionResult> {
  const startedAt = performance.now();
  const method = 'INPUT';
  const startEvent: StepStartEvent = {
    scenario: options.scenario,
    index,
    totalSteps: options.totalSteps,
    id: step.id,
    method,
    path: step.input.name,
    secretValues: [...options.state.secretValues],
  };

  await options.reporter?.onStepStart?.(startEvent);

  let source: StepInputResult['source'] = 'none';
  let provided = false;

  try {
    let value: unknown;

    if (Object.prototype.hasOwnProperty.call(options.state.vars, step.input.name)) {
      value = options.state.vars[step.input.name];
      source = 'vars';
    } else {
      value = await options.inputProvider?.({
        scenario: options.scenario,
        index,
        totalSteps: options.totalSteps,
        id: step.id,
        name: step.input.name,
        ...(step.input.label === undefined ? {} : { label: step.input.label }),
        required: step.input.required,
        ...(step.input.sensitive === undefined ? {} : { sensitive: step.input.sensitive }),
        secretValues: [...options.state.secretValues],
      });
      source = value === undefined ? 'none' : 'prompt';
    }

    provided = isProvidedInputValue(value);

    if (!provided && step.input.required) {
      throw new ScenarioExecutionError(
        `step "${step.id}": input ${step.input.name} is required. Pass --var ${step.input.name}=<value> or provide it in the UI prompt.`,
      );
    }

    if (provided) {
      options.state.context[step.input.name] = value;

      if (step.input.sensitive === true) {
        options.state.secretValues.add(String(value));
      }
    }

    const result: StepExecutionResult = {
      index,
      id: step.id,
      method,
      path: step.input.name,
      durationMs: performance.now() - startedAt,
      passed: true,
      input: formatStepInputResult(step, source, provided),
      extracts: [],
    };

    await options.reporter?.onStepEnd?.({
      scenario: options.scenario,
      index,
      totalSteps: options.totalSteps,
      result,
      secretValues: [...options.state.secretValues],
    });

    return result;
  } catch (error) {
    const result: StepExecutionResult = {
      index,
      id: step.id,
      method,
      path: step.input.name,
      durationMs: performance.now() - startedAt,
      passed: false,
      input: formatStepInputResult(step, source, provided),
      extracts: [],
      error: error instanceof Error ? error.message : String(error),
    };

    await options.reporter?.onStepEnd?.({
      scenario: options.scenario,
      index,
      totalSteps: options.totalSteps,
      result,
      secretValues: [...options.state.secretValues],
    });

    return result;
  }
}

function isProvidedInputValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function formatStepInputResult(
  step: ASTInputStep,
  source: StepInputResult['source'],
  provided: boolean,
): StepInputResult {
  return {
    name: step.input.name,
    ...(step.input.label === undefined ? {} : { label: step.input.label }),
    source,
    provided,
    ...(step.input.sensitive === undefined ? {} : { sensitive: step.input.sensitive }),
  };
}

function normalizeModuleBaseUrls(value: Record<string, string | undefined> | undefined): Map<string, string> {
  const urls = new Map<string, string>();

  for (const [moduleName, rawBaseUrl] of Object.entries(value ?? {})) {
    const baseUrl = rawBaseUrl?.trim();

    if (baseUrl) {
      urls.set(moduleName, baseUrl);
    }
  }

  return urls;
}

function resolveStepBaseUrl(
  step: ASTApiStep,
  fallbackBaseUrl: string,
  moduleBaseUrls: Map<string, string>,
): string {
  if (step.moduleName === undefined) {
    return fallbackBaseUrl;
  }

  return moduleBaseUrls.get(step.moduleName) ?? fallbackBaseUrl;
}

async function buildRuntimeRequest(
  step: ASTApiStep,
  method: string,
  baseUrl: string,
  fileRootDir: string,
  state: RuntimeState,
  captureRequestResponseValues: boolean,
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
    const bodyValue = evaluateTemplateValue(step.request.body, state);
    init.body = JSON.stringify(bodyValue);
  } else if (hasMultipart) {
    init.body = await buildMultipartBody(step, fileRootDir, state);
  }

  return {
    url,
    init,
    ...(captureRequestResponseValues ? { details: buildRequestDetails(step, headers, init.body, state) } : {}),
  };
}

function buildRequestDetails(
  step: ASTApiStep,
  headers: Record<string, string>,
  body: RequestInit['body'],
  state: RuntimeState,
): StepRequestResult {
  return {
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    ...(body === undefined || body === null ? {} : { body: formatRequestBodyDetails(step, body, state) }),
  };
}

function formatRequestBodyDetails(
  step: ASTApiStep,
  body: NonNullable<RequestInit['body']>,
  state: RuntimeState,
): string {
  if (typeof body === 'string') {
    return formatJsonString(body);
  }

  if (step.request.multipart !== undefined) {
    return JSON.stringify(formatMultipartDetails(step.request.multipart, state), null, 2);
  }

  return String(body);
}

function formatJsonString(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatMultipartDetails(multipart: NonNullable<StepRequest['multipart']>, state: RuntimeState): unknown {
  return {
    ...(multipart.fields === undefined ? {} : { fields: evaluateRecord(multipart.fields, state) ?? {} }),
    files: Object.fromEntries(
      Object.entries(multipart.files).map(([fieldName, file]) => [fieldName, {
        path: file.path,
        ...(file.filename === undefined ? {} : { filename: file.filename }),
        ...(file.contentType === undefined ? {} : { contentType: file.contentType }),
      }]),
    ),
  };
}

function compilePath(step: ASTApiStep, state: RuntimeState): string {
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

async function buildMultipartBody(step: ASTApiStep, fileRootDir: string, state: RuntimeState): Promise<FormData> {
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
    throw new ScenarioExecutionError('request.multipart file path must be relative to the workspace directory');
  }

  if (filePath.trim().split(/[\\/]+/).includes('..')) {
    throw new ScenarioExecutionError('request.multipart file path must stay inside the workspace directory');
  }
}

function evaluateExtracts(step: ASTApiStep, body: string, state: RuntimeState): ExtractExecutionResult[] {
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

function parseCondition(condition: string, stepId: string): StatusCondition {
  const parsed = parseStatusCondition(condition);

  if (parsed === undefined) {
    throw new ScenarioExecutionError(formatUnsupportedConditionError(stepId, condition));
  }

  return parsed;
}

function evaluateCondition(status: number, condition: StatusCondition): boolean {
  return evaluateStatusCondition(status, condition);
}

function isDefaultStatusPassed(status: number): boolean {
  return status < 400;
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

  if (reference.startsWith('vars.')) {
    const name = reference.slice('vars.'.length);

    if (!Object.prototype.hasOwnProperty.call(state.vars, name)) {
      throw new ScenarioExecutionError(`Missing vars.${name} for template "{{${reference}}}"`);
    }

    return state.vars[name];
  }

  if (reference.startsWith('k6.')) {
    return state.k6[reference.slice('k6.'.length) as keyof K6ExecutionValues];
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
