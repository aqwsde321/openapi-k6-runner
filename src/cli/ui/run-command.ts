import { CommanderError } from 'commander';
import path from 'node:path';

import type { LoadTestConfig } from '../../config/load-test.config.js';
import type {
  ScenarioExecutionReporter,
  ScenarioExecutionResult,
  ScenarioInputProvider,
} from '../../executor/scenario.executor.js';
import { DEFAULT_WORKSPACE_DIR } from '../../scaffold/load-test.init.js';
import { formatDisplayPath } from './paths.js';
import {
  appendUiRunChunk,
  appendUiRunSuiteResult,
  appendUiRunTestResult,
  createUiRunRecord,
  type UiSuiteRunResult,
  createUiRunTestResult,
  createUiRunWritable,
  createUiScenarioReporter,
  finishUiRun,
  requestUiRunInput,
  type UiRunRecord,
  type UiRunStatus,
} from './run-state.js';
import {
  runSuiteTestCommand,
  runValidateCommand,
} from '../scenario-command.js';
import {
  writeSuiteTestSummary,
  writeValidateSummary,
} from '../scenario-output.js';
import { readUiScenarioStepSources } from './scenario-files.js';
import {
  createUiScenarioReaderContext,
  formatUiScenarioOption,
  resolveLoadTestDir,
  resolveUiScenarioPath,
  validateUiScenarioOption,
} from './scenario-paths.js';
import {
  readUiSuiteDetail,
  formatUiSuiteOption,
  resolveUiSuitePath,
} from './suites.js';

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

export async function startUiSuiteRun(
  state: UiRunCommandState,
  body: unknown,
): Promise<{ runId: string; status: UiRunStatus }> {
  const payload = parseUiSuiteRunPayload(body);
  resolveUiSuitePath(state, payload.suite);
  const runId = String(state.nextRunId++);
  const run = createUiRunRecord({
    id: runId,
    command: 'suite',
    scenario: payload.suite,
  });

  state.runs.set(runId, run);
  void runUiSuiteCliCommand(state, run, payload);
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

function parseUiSuiteRunPayload(value: unknown): {
  command: 'validate' | 'test';
  suite: string;
  showValues: boolean;
  varFile: string[];
  vars: string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request body must be an object');
  }

  const record = value as Record<string, unknown>;
  const command = record.command;
  const suite = record.suite;

  if (command !== 'validate' && command !== 'test') {
    throw new Error('command must be "validate" or "test"');
  }

  if (typeof suite !== 'string' || suite.trim() === '') {
    throw new Error('suite must be a non-empty string');
  }

  return {
    command,
    suite,
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
      }, run)
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

async function runUiSuiteCliCommand(
  state: UiRunCommandState,
  run: UiRunRecord,
  payload: { command: 'validate' | 'test'; suite: string; showValues: boolean; varFile: string[]; vars: string[] },
): Promise<void> {
  const suitePath = resolveUiSuitePath(state, payload.suite);
  const stdout = createUiRunWritable(run, 'stdout');
  const stderr = createUiRunWritable(run, 'stderr');
  const displayCommand = formatUiSuiteRunDisplayCommand(state, payload, suitePath);

  appendUiRunChunk(run, 'stdout', `\u001b[90m$ ${displayCommand}\u001b[0m\n`);

  try {
    if (payload.command === 'validate') {
      const result = await runUiSuiteValidateCommand(state, run, payload, stdout, stderr);
      appendUiRunSuiteResult(run, result);
      finishUiRun(run, result.status, result.status === 'passed' ? 0 : 1);
      return;
    }

    const result = await runSuiteTestCommand({
      suite: payload.suite,
      config: formatDisplayPath(state.cwd, state.config.path),
      ...(state.options.module === undefined ? {} : { module: state.options.module }),
      varFile: payload.varFile,
      var: payload.vars,
    }, {
      ...state.context,
      cwd: state.cwd,
      stdout,
      stderr,
      env: state.context.env,
      fetch: state.context.fetch,
      interactive: false,
      captureRequestResponseValues: payload.showValues,
      inputProvider: (request) => requestUiRunInput(run, request),
      testReporter: createUiScenarioReporter(stdout, state.context.testReporter, undefined, run),
    });

    writeSuiteTestSummary(stdout, result, state.cwd);
    const suiteResult = createUiSuiteRunResult(result.suiteName, result.durationMs, result.scenarios, {
      reportPath: result.reportPath === undefined ? undefined : formatDisplayPath(state.cwd, result.reportPath),
    });
    appendUiRunSuiteResult(run, suiteResult);
    finishUiRun(run, suiteResult.status, suiteResult.status === 'passed' ? 0 : 1);
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

async function runUiSuiteValidateCommand(
  state: UiRunCommandState,
  run: UiRunRecord,
  payload: { suite: string; varFile: string[]; vars: string[] },
  stdout: WritableLike,
  stderr: WritableLike,
): Promise<UiSuiteRunResult> {
  const suiteDetail = await readUiSuiteDetail(state, payload.suite);
  const scenarios: UiSuiteRunResult['scenarios'] = [];

  for (const scenario of suiteDetail.scenarios) {
    const scenarioKey = scenario.id;

    appendUiRunChunk(
      run,
      'stdout',
      `\u001b[90m$ ${formatUiScenarioValidateDisplayCommand(state, scenarioKey, payload)}\u001b[0m\n`,
    );

    try {
      const result = await runValidateCommand({
        scenario: scenarioKey,
        config: formatDisplayPath(state.cwd, state.config.path),
        ...(state.options.module === undefined ? {} : { module: state.options.module }),
        varFile: payload.varFile,
        var: payload.vars,
      }, {
        ...state.context,
        cwd: state.cwd,
        stdout,
        stderr,
        env: state.context.env,
        fetch: state.context.fetch,
        interactive: false,
      });

      writeValidateSummary(stdout, result, state.cwd);
      scenarios.push({
        scenarioKey,
        scenarioName: result.scenarioName,
        status: 'passed',
        durationMs: 0,
        passedSteps: result.stepCount,
        totalSteps: result.stepCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`${message}\n`);
      scenarios.push({
        scenarioKey,
        status: 'failed',
        durationMs: 0,
        passedSteps: 0,
        totalSteps: scenario.stepCount ?? 0,
        error: message,
      });
    }
  }

  return {
    suite: suiteDetail.name,
    status: scenarios.every((scenario) => scenario.status === 'passed') ? 'passed' : 'failed',
    durationMs: 0,
    scenarios,
  };
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

function formatUiSuiteRunDisplayCommand(
  state: UiRunCommandState,
  payload: { command: 'validate' | 'test'; suite: string; varFile: string[]; vars: string[] },
  suitePath: string,
): string {
  const suiteDir = path.join(resolveLoadTestDir(state.cwd, state.config), 'suites');
  const suiteOption = formatUiSuiteOption(state.cwd, suiteDir, suitePath);
  const commonArgs = [
    '--config',
    formatDisplayPath(state.cwd, state.config.path),
    ...(state.options.module === undefined ? [] : ['--module', state.options.module]),
    ...payload.varFile.flatMap((value) => ['--var-file', value]),
    ...payload.vars.flatMap((value) => ['--var', value]),
  ];

  if (payload.command === 'validate') {
    return `openapi-k6 UI validate suite ${[suiteOption, ...commonArgs].map(shellQuote).join(' ')}`;
  }

  const args = [
    'test',
    '--suite',
    suiteOption,
    ...commonArgs,
  ];

  return `npx --yes openapi-k6 ${args.map(shellQuote).join(' ')}`;
}

function formatUiScenarioValidateDisplayCommand(
  state: UiRunCommandState,
  scenario: string,
  payload: { varFile: string[]; vars: string[] },
): string {
  const args = [
    'validate',
    '-s',
    scenario,
    '--config',
    formatDisplayPath(state.cwd, state.config.path),
    ...(state.options.module === undefined ? [] : ['--module', state.options.module]),
    ...payload.varFile.flatMap((value) => ['--var-file', value]),
    ...payload.vars.flatMap((value) => ['--var', value]),
  ];

  return `npx --yes openapi-k6 ${args.map(shellQuote).join(' ')}`;
}

function createUiSuiteRunResult(
  suiteName: string,
  durationMs: number,
  scenarios: Array<ScenarioExecutionResult & { scenarioKey: string }>,
  options: { reportPath?: string } = {},
): UiSuiteRunResult {
  return {
    suite: suiteName,
    status: scenarios.every((scenario) => scenario.passed) ? 'passed' : 'failed',
    durationMs: Math.round(durationMs),
    ...(options.reportPath === undefined ? {} : { reportPath: options.reportPath }),
    scenarios: scenarios.map((scenario) => {
      const failedStep = scenario.steps.find((step) => !step.passed);
      const requestStep = failedStep ?? [...scenario.steps].reverse().find((step) => step.method || step.path);

      return {
        scenarioKey: scenario.scenarioKey,
        scenarioName: scenario.scenario,
        status: scenario.passed ? 'passed' : 'failed',
        durationMs: Math.round(scenario.durationMs),
        passedSteps: scenario.steps.filter((step) => step.passed).length,
        totalSteps: scenario.steps.length,
        ...(requestStep === undefined ? {} : { method: requestStep.method, path: requestStep.path }),
        ...(failedStep === undefined
          ? {}
          : {
              failedStep: {
                id: failedStep.id,
                method: failedStep.method,
                path: failedStep.path,
                ...(failedStep.response === undefined ? {} : { responseStatus: failedStep.response.status }),
                ...(failedStep.condition === undefined ? {} : { condition: failedStep.condition.expression }),
                ...(failedStep.error === undefined ? {} : { error: failedStep.error }),
              },
            }),
      };
    }),
  };
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
