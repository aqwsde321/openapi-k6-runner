import type { ServerResponse } from 'node:http';

import { createAnsiHtmlState, renderAnsiChunkToHtml, type AnsiHtmlState } from '../ansi-html.js';
import { createScenarioConsoleReporter } from '../test.reporter.js';
import type {
  ScenarioInputRequest,
  ScenarioExecutionReporter,
  ScenarioExecutionResult,
} from '../../executor/scenario.executor.js';

export type UiRunStatus = 'running' | 'passed' | 'failed';

type WritableLike = {
  write(chunk: string): unknown;
  isTTY?: boolean;
};

export interface UiRunRecord {
  id: string;
  command: 'validate' | 'test' | 'suite';
  scenario: string;
  status: UiRunStatus;
  exitCode?: number;
  chunks: UiRunChunk[];
  testResult?: UiRunTestResult;
  suiteResult?: UiSuiteRunResult;
  pendingInput?: UiRunPendingInput;
  events: UiRunEvent[];
  nextEventId: number;
  secretValues: Set<string>;
  showSensitiveValues: boolean;
  clients: Set<ServerResponse>;
  ansiHtmlState: AnsiHtmlState;
}

interface UiRunEvent {
  id: number;
  name: string;
  data: unknown;
}

export interface UiRunChunk {
  stream: 'stdout' | 'stderr';
  chunk: string;
  html: string;
}

export interface UiRunTestResult {
  scenario: string;
  status: 'passed' | 'failed';
  durationMs: number;
  steps: UiRunStepResult[];
}

export interface UiSuiteRunResult {
  suite: string;
  status: 'passed' | 'failed';
  durationMs: number;
  reportPath?: string;
  scenarios: UiSuiteScenarioRunResult[];
}

export interface UiSuiteScenarioRunResult {
  scenarioKey: string;
  scenarioName?: string;
  status: 'passed' | 'failed';
  durationMs: number;
  passedSteps: number;
  totalSteps: number;
  method?: string;
  path?: string;
  error?: string;
  failedStep?: {
    id: string;
    method?: string;
    path?: string;
    responseStatus?: number;
    condition?: string;
    error?: string;
  };
}

export interface UiRunPendingInput {
  request: UiRunInputRequest;
  resolve(value: unknown): void;
}

export interface UiRunInputRequest {
  runId: string;
  index: number;
  totalSteps: number;
  id: string;
  name: string;
  label?: string;
  required: boolean;
  sensitive?: boolean;
}

export interface UiRunStepResult {
  index: number;
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  source: UiScenarioStepSource;
  method: string;
  path: string;
  url?: string;
  request?: UiRunRequestValue;
  response?: UiRunResponseValue;
  input?: UiRunStepInputValue;
  condition?: UiRunStepConditionValue;
  extracts: UiRunStepExtractValue[];
  error?: string;
  responseStatus?: number;
}

export interface UiRunStepConditionValue {
  expression: string;
  passed: boolean;
}

export interface UiRunStepExtractValue {
  name: string;
  path: string;
  passed: boolean;
  error?: string;
}

export interface UiRunStepInputValue {
  name: string;
  label?: string;
  source: 'vars' | 'prompt' | 'none';
  provided: boolean;
  sensitive?: boolean;
}

export interface UiRunRequestValue {
  headers?: Record<string, string>;
  body?: string;
}

export interface UiRunResponseValue {
  status: number;
  statusText: string;
  headers?: Record<string, string>;
  body: string;
}

export interface UiScenarioStepSource {
  kind: 'direct' | 'use' | 'include';
  reference?: string;
  lineage?: UiScenarioStepSourceReference[];
}

export interface UiScenarioStepSourceReference {
  kind: 'use' | 'include';
  reference: string;
  definition?: {
    path: string;
    code: string;
  };
}

export function createUiRunRecord(options: {
  id: string;
  command: 'validate' | 'test' | 'suite';
  scenario: string;
  showSensitiveValues?: boolean;
}): UiRunRecord {
  return {
    id: options.id,
    command: options.command,
    scenario: options.scenario,
    status: 'running',
    chunks: [],
    events: [],
    nextEventId: 1,
    secretValues: new Set(),
    showSensitiveValues: options.showSensitiveValues === true,
    clients: new Set(),
    ansiHtmlState: createAnsiHtmlState(),
  };
}

export function createUiRunWritable(run: UiRunRecord, stream: 'stdout' | 'stderr'): WritableLike {
  return {
    write(chunk: string | Uint8Array): unknown {
      appendUiRunChunk(run, stream, typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    },
    isTTY: false,
  };
}

export function appendUiRunChunk(run: UiRunRecord, stream: 'stdout' | 'stderr', chunk: string): void {
  const maskedChunk = run.showSensitiveValues ? chunk : maskUiRunText(chunk, [...run.secretValues]);
  const event = {
    stream,
    chunk: maskedChunk,
    html: renderAnsiChunkToHtml(maskedChunk, run.ansiHtmlState),
  };
  run.chunks.push(event);
  writeUiRunEvent(run, 'chunk', event);
}

export function appendUiRunTestResult(run: UiRunRecord, result: UiRunTestResult): void {
  run.testResult = result;
  writeUiRunEvent(run, 'test-result', result);
}

export function appendUiRunSuiteResult(run: UiRunRecord, result: UiSuiteRunResult): void {
  run.suiteResult = result;
  writeUiRunEvent(run, 'suite-result', result);
}

export function requestUiRunInput(run: UiRunRecord, request: ScenarioInputRequest): Promise<unknown> {
  return new Promise((resolve) => {
    const event: UiRunInputRequest = {
      runId: run.id,
      index: request.index,
      totalSteps: request.totalSteps,
      id: request.id,
      name: request.name,
      ...(request.label === undefined ? {} : { label: request.label }),
      required: request.required,
      ...(request.sensitive === undefined ? {} : { sensitive: request.sensitive }),
    };

    run.pendingInput = {
      request: event,
      resolve,
    };
    writeUiRunEvent(run, 'input-request', event);
  });
}

export function submitUiRunInput(run: UiRunRecord, body: unknown): { accepted: true } {
  if (run.pendingInput === undefined) {
    throw new Error(`run ${JSON.stringify(run.id)} is not waiting for input`);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('request body must be an object');
  }

  const record = body as Record<string, unknown>;
  const name = record.name;

  if (typeof name !== 'string' || name !== run.pendingInput.request.name) {
    throw new Error(`input name must be ${JSON.stringify(run.pendingInput.request.name)}`);
  }

  const pending = run.pendingInput;
  run.pendingInput = undefined;
  writeUiRunEvent(run, 'input-submitted', {
    runId: run.id,
    id: pending.request.id,
    name: pending.request.name,
  });
  pending.resolve(record.value);
  return { accepted: true };
}

export function createUiRunTestResult(
  result: ScenarioExecutionResult,
  stepSources: UiScenarioStepSource[],
  options: { includeValues?: boolean; showSensitiveValues?: boolean } = {},
): UiRunTestResult {
  const includeValues = options.includeValues === true;
  const showSensitiveValues = options.showSensitiveValues === true;
  const secretValues = [...result.secretValues]
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length);

  return {
    scenario: result.scenario,
    status: result.passed ? 'passed' : 'failed',
    durationMs: Math.round(result.durationMs),
    steps: result.steps.map((step) => ({
      index: step.index,
      id: step.id,
      status: step.passed ? 'passed' : 'failed',
      durationMs: Math.round(step.durationMs),
      source: stepSources[step.index] ?? { kind: 'direct' },
      method: step.method,
      path: showSensitiveValues ? step.path : maskUiRunText(step.path, secretValues),
      extracts: step.extracts.map((extract) => ({
        name: extract.name,
        path: extract.path,
        passed: extract.passed,
        ...(extract.error === undefined
          ? {}
          : { error: showSensitiveValues ? extract.error : maskUiRunText(extract.error, secretValues) }),
      })),
      ...(includeValues && step.url !== undefined
        ? { url: showSensitiveValues ? step.url : maskUiRunUrl(step.url, secretValues) }
        : {}),
      ...(includeValues && step.request !== undefined
        ? { request: showSensitiveValues ? step.request : maskUiRunRequest(step.request, secretValues) }
        : {}),
      ...(includeValues && step.response !== undefined
        ? {
            response: showSensitiveValues
              ? step.response
              : {
                  status: step.response.status,
                  statusText: maskUiRunText(step.response.statusText, secretValues),
                  ...(step.response.headers === undefined
                    ? {}
                    : { headers: maskUiRunHeaders(step.response.headers, secretValues) }),
                  body: maskUiRunBody(step.response.body, secretValues),
                },
          }
        : {}),
      ...(step.input === undefined
        ? {}
        : {
            input: {
              name: step.input.name,
              ...(step.input.label === undefined ? {} : { label: step.input.label }),
              source: step.input.source,
              provided: step.input.provided,
              ...(step.input.sensitive === undefined ? {} : { sensitive: step.input.sensitive }),
            },
          }),
      ...(step.condition === undefined
        ? {}
        : {
            condition: {
              expression: showSensitiveValues
                ? step.condition.expression
                : maskUiRunText(step.condition.expression, secretValues),
              passed: step.condition.passed,
            },
          }),
      ...(step.error === undefined
        ? {}
        : { error: showSensitiveValues ? step.error : maskUiRunText(step.error, secretValues) }),
      ...(step.response === undefined ? {} : { responseStatus: step.response.status }),
    })),
  };
}

export function createUiScenarioReporter(
  stdout: WritableLike,
  injectedReporter: ScenarioExecutionReporter | undefined,
  resultReporter?: ScenarioExecutionReporter,
  run?: UiRunRecord,
): ScenarioExecutionReporter {
  let reporter = createScenarioConsoleReporter(stdout, {
    color: true,
    live: false,
    showSensitiveValues: run?.showSensitiveValues,
  });

  if (run !== undefined) {
    reporter = teeScenarioReporters(createUiRunSecretReporter(run), reporter);
  }

  if (injectedReporter !== undefined) {
    reporter = teeScenarioReporters(reporter, injectedReporter);
  }

  return resultReporter === undefined
    ? reporter
    : teeScenarioReporters(reporter, resultReporter);
}

function createUiRunSecretReporter(run: UiRunRecord): ScenarioExecutionReporter {
  const remember = (values: string[]) => {
    for (const value of values) {
      if (value !== '') run.secretValues.add(value);
    }
  };

  return {
    onScenarioStart: (event) => remember(event.secretValues),
    onStepStart: (event) => remember(event.secretValues),
    onStepRequest: (event) => remember(event.secretValues),
    onStepEnd: (event) => remember(event.secretValues),
    onScenarioEnd: (result) => remember(result.secretValues),
  };
}

export function finishUiRun(run: UiRunRecord, status: 'passed' | 'failed', exitCode: number): void {
  run.status = status;
  run.exitCode = exitCode;
  run.secretValues.clear();
  writeUiRunEvent(run, 'done', {
    status,
    exitCode,
  });

  for (const client of run.clients) {
    client.end();
  }

  run.clients.clear();
}

export function streamUiRunEvents(
  run: UiRunRecord,
  response: ServerResponse,
  lastEventId?: string,
): void {
  writeSseHeaders(response);

  const resumeAfter = parseLastEventId(lastEventId);
  const replay = resumeAfter === undefined
    ? createUiRunSnapshot(run)
    : run.events.filter((event) => event.id > resumeAfter);

  for (const event of replay) {
    writeSseEvent(response, event);
  }

  if (run.status !== 'running') {
    response.end();
    return;
  }

  run.clients.add(response);
  response.on('close', () => {
    run.clients.delete(response);
  });
}

export function streamMissingUiRun(response: ServerResponse): void {
  writeSseHeaders(response);
  writeSseEvent(response, {
    id: 0,
    name: 'done',
    data: {
      status: 'failed',
      exitCode: 1,
      error: 'UI 서버가 재시작되어 진행 중이던 실행을 이어갈 수 없습니다.',
    },
  });
  response.end();
}

function teeScenarioReporters(
  left: ScenarioExecutionReporter,
  right: ScenarioExecutionReporter,
): ScenarioExecutionReporter {
  return {
    async onScenarioStart(event) {
      await left.onScenarioStart?.(event);
      await right.onScenarioStart?.(event);
    },
    async onStepStart(event) {
      await left.onStepStart?.(event);
      await right.onStepStart?.(event);
    },
    async onStepRequest(event) {
      await left.onStepRequest?.(event);
      await right.onStepRequest?.(event);
    },
    async onStepEnd(event) {
      await left.onStepEnd?.(event);
      await right.onStepEnd?.(event);
    },
    async onScenarioEnd(result) {
      await left.onScenarioEnd?.(result);
      await right.onScenarioEnd?.(result);
    },
  };
}

function writeUiRunEvent(run: UiRunRecord, name: string, data: unknown): void {
  const event = {
    id: run.nextEventId++,
    name,
    data,
  };
  run.events.push(event);

  for (const client of run.clients) {
    writeSseEvent(client, event);
  }
}

function createUiRunSnapshot(run: UiRunRecord): UiRunEvent[] {
  return run.events.filter((event) => (
    event.name === 'chunk' ||
    (event.name === 'test-result' && event.data === run.testResult) ||
    (event.name === 'suite-result' && event.data === run.suiteResult) ||
    (event.name === 'input-request' && event.data === run.pendingInput?.request) ||
    (event.name === 'done' && run.status !== 'running')
  ));
}

function parseLastEventId(value: string | undefined): number | undefined {
  const normalized = value?.trim();

  if (normalized === undefined || !/^\d+$/.test(normalized)) {
    return undefined;
  }

  const id = Number(normalized);
  return Number.isSafeInteger(id) ? id : undefined;
}

function writeSseEvent(response: ServerResponse, event: UiRunEvent): void {
  response.write(`id: ${event.id}\n`);
  response.write(`event: ${event.name}\n`);
  response.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function writeSseHeaders(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
}

const SENSITIVE_KEY_PARTS = [
  'password',
  'secret',
  'token',
  'apikey',
  'authorization',
  'cookie',
  'setcookie',
];
const SENSITIVE_ASSIGNMENT = /(\b[A-Za-z0-9_.-]*(?:password|secret|token|api[-_.]?key|authorization|set[-_.]?cookie|cookie)[A-Za-z0-9_.-]*\b)(\s*(?:={1,3}|:)\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi;
const SENSITIVE_QUOTED_ASSIGNMENT = /(["'])([A-Za-z0-9_.-]*(?:password|secret|token|api[-_.]?key|authorization|set[-_.]?cookie|cookie)[A-Za-z0-9_.-]*)(["'])(\s*:\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,}]+)/gi;
const SENSITIVE_BRACKET_ASSIGNMENT = /(\[\s*["'])([A-Za-z0-9_.-]*(?:password|secret|token|api[-_.]?key|authorization|set[-_.]?cookie|cookie)[A-Za-z0-9_.-]*)(["']\s*\])(\s*(?:={1,3}|:)\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi;

function maskUiRunRequest(
  request: NonNullable<ScenarioExecutionResult['steps'][number]['request']>,
  secretValues: string[],
): UiRunRequestValue {
  return {
    ...(request.headers === undefined ? {} : { headers: maskUiRunHeaders(request.headers, secretValues) }),
    ...(request.body === undefined ? {} : { body: maskUiRunBody(request.body, secretValues) }),
  };
}

function maskUiRunHeaders(headers: Record<string, string>, secretValues: string[]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSensitiveUiRunKey(key) ? '***' : maskUiRunText(value, secretValues),
    ]),
  );
}

function maskUiRunBody(value: string, secretValues: string[]): string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return maskUiRunText(value, secretValues);
  }

  const masked = maskUiRunJsonValue(parsed, secretValues);
  return JSON.stringify(masked) === JSON.stringify(parsed)
    ? value
    : JSON.stringify(masked, null, 2);
}

function maskUiRunJsonValue(value: unknown, secretValues: string[]): unknown {
  if (typeof value === 'string') {
    return maskUiRunText(value, secretValues);
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskUiRunJsonValue(item, secretValues));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveUiRunKey(key) ? '***' : maskUiRunJsonValue(item, secretValues),
      ]),
    );
  }

  return value;
}

function maskUiRunUrl(value: string, secretValues: string[]): string {
  try {
    const url = new URL(value);
    const pathname = maskEncodedUiRunUrlPart(url.pathname, secretValues);
    const username = maskEncodedUiRunUrlPart(url.username, secretValues);
    const search = new URLSearchParams();

    if (pathname !== undefined) url.pathname = pathname;
    if (username !== undefined) url.username = username;
    for (const [key, item] of url.searchParams) {
      search.append(key, isSensitiveUiRunKey(key) ? '***' : maskUiRunSecrets(item, secretValues));
    }

    url.search = search.toString();
    if (url.hash) {
      const fragment = url.hash.slice(1);
      if (fragment.includes('=')) {
        const hash = new URLSearchParams();
        for (const [key, item] of new URLSearchParams(fragment)) {
          hash.append(key, isSensitiveUiRunKey(key) ? '***' : maskUiRunSecrets(item, secretValues));
        }
        url.hash = hash.toString();
      } else {
        const decoded = decodeURIComponent(fragment);
        url.hash = maskUiRunText(decoded, secretValues);
      }
    }
    if (url.password) url.password = '***';
    return maskUiRunSecrets(url.toString(), secretValues);
  } catch {
    return maskUiRunText(value, secretValues);
  }
}

function maskUiRunText(value: string, secretValues: string[]): string {
  return maskUiRunSecrets(value, secretValues)
    .replace(
      SENSITIVE_BRACKET_ASSIGNMENT,
      (_match, start: string, key: string, end: string, separator: string) => `${start}${key}${end}${separator}***`,
    )
    .replace(
      SENSITIVE_QUOTED_ASSIGNMENT,
      (_match, open: string, key: string, close: string, separator: string) => (
        `${open}${key}${close}${separator}"***"`
      ),
    )
    .replace(SENSITIVE_ASSIGNMENT, (_match, key: string, separator: string) => `${key}${separator}***`);
}

function maskUiRunSecrets(value: string, secretValues: string[]): string {
  return secretValues.reduce((text, secret) => {
    const encoded = encodeURIComponent(secret);
    const formEncoded = encoded.replace(/%20/g, '+');
    return [...new Set([secret, encoded, formEncoded])]
      .reduce((masked, variant) => masked.split(variant).join('***'), text);
  }, value);
}

function maskEncodedUiRunUrlPart(value: string, secretValues: string[]): string | undefined {
  const decoded = decodeURIComponent(value);
  const masked = maskUiRunSecrets(decoded, secretValues);
  return masked === decoded ? undefined : masked;
}

function isSensitiveUiRunKey(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}
