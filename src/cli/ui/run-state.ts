import type { ServerResponse } from 'node:http';

import { createAnsiHtmlState, renderAnsiChunkToHtml, type AnsiHtmlState } from '../ansi-html.js';
import { createScenarioConsoleReporter } from '../test.reporter.js';
import type {
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

export interface UiRunStepResult {
  index: number;
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  source: UiScenarioStepSource;
  method: string;
  path: string;
  responseStatus?: number;
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

export function createUiRunTestResult(
  result: ScenarioExecutionResult,
  stepSources: UiScenarioStepSource[],
): UiRunTestResult {
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
