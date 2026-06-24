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
  command: 'validate' | 'test';
  scenario: string;
  status: UiRunStatus;
  exitCode?: number;
  chunks: UiRunChunk[];
  testResult?: UiRunTestResult;
  pendingInput?: UiRunPendingInput;
  clients: Set<ServerResponse>;
  ansiHtmlState: AnsiHtmlState;
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
  responseStatus?: number;
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
}

export function createUiRunRecord(options: {
  id: string;
  command: 'validate' | 'test';
  scenario: string;
}): UiRunRecord {
  return {
    id: options.id,
    command: options.command,
    scenario: options.scenario,
    status: 'running',
    chunks: [],
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
  const event = {
    stream,
    chunk,
    html: renderAnsiChunkToHtml(chunk, run.ansiHtmlState),
  };
  run.chunks.push(event);
  writeUiRunEvent(run, 'chunk', event);
}

export function appendUiRunTestResult(run: UiRunRecord, result: UiRunTestResult): void {
  run.testResult = result;
  writeUiRunEvent(run, 'test-result', result);
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
  options: { includeValues?: boolean } = {},
): UiRunTestResult {
  const includeValues = options.includeValues === true;

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
      path: step.path,
      ...(includeValues && step.url !== undefined ? { url: step.url } : {}),
      ...(includeValues && step.request !== undefined ? { request: step.request } : {}),
      ...(includeValues && step.response !== undefined
        ? {
            response: {
              status: step.response.status,
              statusText: step.response.statusText,
              ...(step.response.headers === undefined ? {} : { headers: step.response.headers }),
              body: step.response.body,
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
      ...(step.response === undefined ? {} : { responseStatus: step.response.status }),
    })),
  };
}

export function createUiScenarioReporter(
  stdout: WritableLike,
  injectedReporter: ScenarioExecutionReporter | undefined,
  resultReporter?: ScenarioExecutionReporter,
): ScenarioExecutionReporter {
  let reporter = createScenarioConsoleReporter(stdout, {
    color: true,
    live: false,
  });

  if (injectedReporter !== undefined) {
    reporter = teeScenarioReporters(reporter, injectedReporter);
  }

  return resultReporter === undefined
    ? reporter
    : teeScenarioReporters(reporter, resultReporter);
}

export function finishUiRun(run: UiRunRecord, status: 'passed' | 'failed', exitCode: number): void {
  run.status = status;
  run.exitCode = exitCode;
  writeUiRunEvent(run, 'done', {
    status,
    exitCode,
  });

  for (const client of run.clients) {
    client.end();
  }

  run.clients.clear();
}

export function streamUiRunEvents(run: UiRunRecord, response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  for (const chunk of run.chunks) {
    writeSseEvent(response, 'chunk', chunk);
  }

  if (run.testResult !== undefined) {
    writeSseEvent(response, 'test-result', run.testResult);
  }

  if (run.pendingInput !== undefined) {
    writeSseEvent(response, 'input-request', run.pendingInput.request);
  }

  if (run.status !== 'running') {
    writeSseEvent(response, 'done', {
      status: run.status,
      exitCode: run.exitCode ?? 1,
    });
    response.end();
    return;
  }

  run.clients.add(response);
  response.on('close', () => {
    run.clients.delete(response);
  });
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
  for (const client of run.clients) {
    writeSseEvent(client, name, data);
  }
}

function writeSseEvent(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}
