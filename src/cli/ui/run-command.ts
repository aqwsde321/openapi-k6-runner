import { CommanderError } from 'commander';
import path from 'node:path';

import type { LoadTestConfig } from '../../config/load-test.config.js';
import type { ScenarioExecutionReporter, ScenarioInputProvider } from '../../executor/scenario.executor.js';
import { DEFAULT_WORKSPACE_DIR } from '../../scaffold/load-test.init.js';
import { formatDisplayPath } from './paths.js';
import {
  appendUiRunChunk,
  appendUiRunTestResult,
  createUiRunRecord,
  createUiRunTestResult,
  createUiRunWritable,
  createUiScenarioReporter,
  finishUiRun,
  requestUiRunInput,
  type UiRunRecord,
  type UiRunStatus,
} from './run-state.js';
import { readUiScenarioStepSources } from './scenario-files.js';
import {
  createUiScenarioReaderContext,
  formatUiScenarioOption,
  resolveLoadTestDir,
  resolveUiScenarioPath,
  validateUiScenarioOption,
} from './scenario-paths.js';

const DEFAULT_CONFIG_PATH = `${DEFAULT_WORKSPACE_DIR}/config.yaml`;

type WritableLike = {
  write(chunk: string): unknown;
  isTTY?: boolean;
};

type ReadableLike = NodeJS.ReadableStream & {
  isTTY?: boolean;
};

export interface UiRunCliContext {
  cwd?: string;
  stdin?: ReadableLike;
  stdout?: WritableLike;
  stderr?: WritableLike;
  cliPath?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  interactive?: boolean;
  captureRequestResponseValues?: boolean;
  inputProvider?: ScenarioInputProvider;
  testReporter?: ScenarioExecutionReporter;
}

export interface UiRunCommandState {
  cwd: string;
  options: {
    module?: string;
  };
  context: UiRunCliContext;
  config: LoadTestConfig;
  runCli: (argv: string[], context: UiRunCliContext) => Promise<void>;
  runs: Map<string, UiRunRecord>;
  nextRunId: number;
}

export async function startUiRun(
  state: UiRunCommandState,
  body: unknown,
): Promise<{ runId: string; status: UiRunStatus }> {
  const payload = parseUiRunPayload(body);
  const scenario = validateUiScenarioOption(state, payload.scenario);
  const runId = String(state.nextRunId++);
  const run = createUiRunRecord({
    id: runId,
    command: payload.command,
    scenario,
  });

  state.runs.set(runId, run);
  void runUiCliCommand(state, run, payload);
  return { runId, status: run.status };
}

function parseUiRunPayload(value: unknown): {
  command: 'validate' | 'test';
  scenario: string;
  showValues: boolean;
  varFile: string[];
  vars: string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request body must be an object');
  }

  const record = value as Record<string, unknown>;
  const command = record.command;
  const scenario = record.scenario;

  if (command !== 'validate' && command !== 'test') {
    throw new Error('command must be "validate" or "test"');
  }

  if (typeof scenario !== 'string' || scenario.trim() === '') {
    throw new Error('scenario must be a non-empty string');
  }

  return {
    command,
    scenario,
    showValues: command === 'test' && record.showValues !== false,
    varFile: parseUiStringArray(record.varFile, 'varFile'),
    vars: parseUiStringArray(record.vars, 'vars'),
  };
}

async function runUiCliCommand(
  state: UiRunCommandState,
  run: UiRunRecord,
  payload: { command: 'validate' | 'test'; scenario: string; showValues: boolean; varFile: string[]; vars: string[] },
): Promise<void> {
  const scenarioPath = resolveUiScenarioPath(state, payload.scenario);
  const stepSources = payload.command === 'test'
    ? await readUiScenarioStepSources(createUiScenarioReaderContext(state), scenarioPath)
    : [];
  const args = [
    payload.command,
    '--scenario',
    formatDisplayPath(state.cwd, scenarioPath),
    '--config',
    formatDisplayPath(state.cwd, state.config.path),
    ...(state.options.module === undefined ? [] : ['--module', state.options.module]),
    ...payload.varFile.flatMap((value) => ['--var-file', value]),
    ...payload.vars.flatMap((value) => ['--var', value]),
  ];
  const displayCommand = formatUiRunDisplayCommand(state, payload, scenarioPath);

  appendUiRunChunk(run, 'stdout', `\u001b[90m$ ${displayCommand}\u001b[0m\n`);
  const stdout = createUiRunWritable(run, 'stdout');
  const stderr = createUiRunWritable(run, 'stderr');
  const testReporter = payload.command === 'test'
    ? createUiScenarioReporter(stdout, state.context.testReporter, {
        onScenarioEnd(result) {
          appendUiRunTestResult(run, createUiRunTestResult(result, stepSources, {
            includeValues: payload.showValues,
          }));
        },
      })
    : state.context.testReporter;

  try {
    await state.runCli(args, {
      ...state.context,
      cwd: state.cwd,
      stdout,
      stderr,
      env: state.context.env,
      fetch: state.context.fetch,
      interactive: false,
      captureRequestResponseValues: payload.showValues,
      inputProvider: payload.command === 'test'
        ? (request) => requestUiRunInput(run, request)
        : state.context.inputProvider,
      testReporter,
    });
    finishUiRun(run, 'passed', 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendUiRunChunk(run, 'stderr', `${message}\n`);
    const hint = createUiFailureHint(message);

    if (hint !== undefined) {
      appendUiRunChunk(run, 'stderr', `\n${hint}\n`);
    }

    finishUiRun(run, 'failed', error instanceof CommanderError ? error.exitCode : 1);
  }
}

function formatUiRunDisplayCommand(
  state: UiRunCommandState,
  payload: { command: 'validate' | 'test'; varFile: string[]; vars: string[] },
  scenarioPath: string,
): string {
  const scenarioDir = path.join(resolveLoadTestDir(state.cwd, state.config), 'scenarios');
  const scenarioOption = formatUiScenarioOption(state.cwd, scenarioDir, scenarioPath);
  const args = [
    payload.command,
    '-s',
    scenarioOption,
    '--config',
    formatDisplayPath(state.cwd, state.config.path),
    ...(state.options.module === undefined ? [] : ['--module', state.options.module]),
    ...payload.varFile.flatMap((value) => ['--var-file', value]),
    ...payload.vars.flatMap((value) => ['--var', value]),
  ];

  return `npx --yes openapi-k6 ${args.map(shellQuote).join(' ')}`;
}

function createUiFailureHint(message: string): string | undefined {
  const normalized = message.toLowerCase();

  if (
    (normalized.includes('enoent') || normalized.includes('no such file')) &&
    normalized.includes('/openapi/') &&
    normalized.includes('.openapi.')
  ) {
    return 'Next: OpenAPI snapshot이 없습니다. 먼저 openapi-k6 sync를 실행하세요.';
  }

  if (normalized.includes('snapshot') && normalized.includes('todo')) {
    return `Next: ${DEFAULT_CONFIG_PATH}의 snapshot 설정을 채우고 openapi-k6 sync를 실행하세요.`;
  }

  if (
    normalized.includes('fetch failed') ||
    normalized.includes('econnrefused') ||
    normalized.includes('enotfound') ||
    normalized.includes('timed out')
  ) {
    return 'Next: 대상 백엔드 서버가 떠 있는지 확인하고 Target의 baseUrl을 점검하세요.';
  }

  return undefined;
}

function parseUiStringArray(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }

  return value;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}
