import { CommanderError } from 'commander';
import { parse as parseDotEnv } from 'dotenv';
import { existsSync, type Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { isMap, isSeq, parse as parseYaml, parseDocument, type YAMLMap } from 'yaml';

import { loadTestConfig, resolveConfigFilePath, resolveConfigModule, type LoadTestConfig, type LoadTestModuleConfig } from '../../config/load-test.config.js';
import { createModuleBaseUrlEnvName } from '../../core/module-env.js';
import { collectTemplateReferences } from '../../core/template.js';
import type { Scenario } from '../../core/types.js';
import type { ScenarioExecutionReporter, ScenarioExecutionResult } from '../../executor/scenario.executor.js';
import { parseOpenApiFile } from '../../openapi/openapi.parser.js';
import { parseScenarioFile } from '../../parser/scenario.parser.js';
import { DEFAULT_WORKSPACE_DIR } from '../../scaffold/load-test.init.js';
import { createAnsiHtmlState, renderAnsiChunkToHtml, type AnsiHtmlState } from '../ansi-html.js';
import { createScenarioConsoleReporter } from '../test.reporter.js';
import { UI_HTML } from './html.js';

type WritableLike = {
  write(chunk: string): unknown;
  isTTY?: boolean;
};

type ReadableLike = NodeJS.ReadableStream & {
  isTTY?: boolean;
};

export interface CliContext {
  cwd?: string;
  stdin?: ReadableLike;
  stdout?: WritableLike;
  stderr?: WritableLike;
  cliPath?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  interactive?: boolean;
  testReporter?: ScenarioExecutionReporter;
}

export interface UiOptions {
  config?: string;
  module?: string;
  host?: string;
  port?: string;
}

export interface UiResult {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export interface UiServerDeps {
  runCli(argv: string[], context: CliContext): Promise<void>;
}

const DEFAULT_LOAD_TEST_DIR = DEFAULT_WORKSPACE_DIR;
const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;
const TODO_VALUE = 'TODO';

function resolveCwd(context: CliContext): string {
  return path.resolve(context.cwd ?? process.cwd());
}

async function loadOptionalConfig(
  cwd: string,
  configPath: string | undefined,
  useDefaultConfig: boolean,
): Promise<LoadTestConfig | undefined> {
  if (configPath === undefined && !useDefaultConfig) {
    return undefined;
  }

  const resolvedConfigPath = path.resolve(cwd, configPath ?? DEFAULT_CONFIG_PATH);

  try {
    return await loadTestConfig(resolvedConfigPath);
  } catch (error) {
    if (configPath === undefined && useDefaultConfig && isNodeErrorCode(error, 'ENOENT')) {
      throw new Error(`${DEFAULT_CONFIG_PATH} was not found. Run openapi-k6 init or pass --config.`);
    }

    throw error;
  }
}

async function loadLoadTestEnv(loadTestDir: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(loadTestDir, '.env'), 'utf8');
    return parseDotEnv(raw);
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return {};
    }

    throw error;
  }
}

function isConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value.trim().toUpperCase() !== TODO_VALUE;
}

function normalizeConfiguredValue(value: string | undefined): string | undefined {
  return isConfiguredValue(value) ? value.trim() : undefined;
}

function resolveScenarioPath(cwd: string, config: LoadTestConfig | undefined, value: string): string {
  if (isScenarioKey(value)) {
    const explicitPath = path.resolve(cwd, value);

    if (hasScenarioKeySeparator(value) && existsSync(explicitPath)) {
      return explicitPath;
    }

    return path.join(resolveLoadTestDir(cwd, config), 'scenarios', `${normalizeScenarioKey(value)}.yaml`);
  }

  return path.resolve(cwd, value);
}

function resolveScenarioName(scenario: string): string {
  return path.basename(scenario, path.extname(scenario));
}

function resolveLoadTestDir(cwd: string, config: LoadTestConfig | undefined): string {
  return config?.dir ?? path.resolve(cwd, DEFAULT_LOAD_TEST_DIR);
}

function resolveScenarioRootDir(cwd: string, config: LoadTestConfig | undefined): string {
  return path.join(resolveLoadTestDir(cwd, config), 'scenarios');
}

function parseWorkspaceScenarioFile(
  cwd: string,
  config: LoadTestConfig | undefined,
  scenarioPath: string,
): Promise<Scenario> {
  return parseScenarioFile(scenarioPath, {
    scenarioRootDir: resolveScenarioRootDir(cwd, config),
  });
}

function isScenarioKey(value: string): boolean {
  const trimmed = value.trim();

  if (
    trimmed === '' ||
    path.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    path.extname(trimmed) !== ''
  ) {
    return false;
  }

  const segments = splitScenarioKey(trimmed);
  return segments.length > 0 && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function normalizeScenarioKey(value: string): string {
  return splitScenarioKey(value.trim()).join('/');
}

function splitScenarioKey(value: string): string[] {
  return value.split(/[\\/]+/);
}

function hasScenarioKeySeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function formatScenarioKey(relativeFilePath: string): string {
  const parsed = path.parse(relativeFilePath);
  return path.join(parsed.dir, parsed.name).split(path.sep).join('/');
}

function isLocalRelativePath(relativePath: string): boolean {
  return relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath) &&
    !path.win32.isAbsolute(relativePath);
}

function isScenarioFile(fileName: string): boolean {
  return ['.yaml', '.yml', '.json'].includes(path.extname(fileName).toLowerCase());
}

function writeLine(stream: WritableLike, message: string): void {
  stream.write(`${message}\n`);
}

function formatDisplayPath(cwd: string, filePath: string): string {
  const relativePath = path.relative(cwd, filePath);

  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return normalizeCommandPath(relativePath);
  }

  return filePath;
}

function normalizeCommandPath(value: string): string {
  return value.split(path.sep).join('/');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}

export async function runUiServerCommand(
  options: UiOptions,
  context: CliContext = {},
  deps: UiServerDeps,
): Promise<UiResult> {
  const cwd = resolveCwd(context);
  const stdout = context.stdout ?? process.stdout;
  const config = await loadOptionalConfig(cwd, options.config, true);

  if (config === undefined) {
    throw new Error(`${DEFAULT_CONFIG_PATH} was not found. Run openapi-k6 init or pass --config.`);
  }

  if (options.module !== undefined) {
    resolveConfigModule(config, options.module);
  }

  const host = normalizeUiHost(options.host);
  const port = parseUiPort(options.port);
  const state: UiState = {
    cwd,
    options,
    context,
    config,
    runCli: deps.runCli,
    runs: new Map(),
    nextRunId: 1,
  };
  const server = createServer((request, response) => {
    void handleUiRequest(state, request, response).catch((error: unknown) => {
      writeUiJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  const resolvedPort = await listenUiServer(server, host, port, options.port !== undefined);
  const url = `http://${host}:${resolvedPort}`;
  writeLine(stdout, `openapi-k6 ui listening on ${url}`);

  return {
    host,
    port: resolvedPort,
    url,
    close: () => closeUiServer(server),
  };
}

type UiRunStatus = 'running' | 'passed' | 'failed';
type UiSnapshotStatus = 'present' | 'missing' | 'error';

interface UiState {
  cwd: string;
  options: UiOptions;
  context: CliContext;
  config: LoadTestConfig;
  runCli: (argv: string[], context: CliContext) => Promise<void>;
  runs: Map<string, UiRunRecord>;
  nextRunId: number;
}

interface UiRunRecord {
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

interface UiRunChunk {
  stream: 'stdout' | 'stderr';
  chunk: string;
  html: string;
}

interface UiRunTestResult {
  scenario: string;
  status: 'passed' | 'failed';
  durationMs: number;
  steps: UiRunStepResult[];
}

interface UiRunStepResult {
  index: number;
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  source: UiScenarioStepSource;
  method: string;
  path: string;
  responseStatus?: number;
}

async function handleUiRequest(
  state: UiState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')) {
    writeUiHtml(response);
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/scenarios') {
    writeUiJson(response, 200, await listUiScenarios(state));
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/scenario') {
    const scenario = requestUrl.searchParams.get('scenario') ?? '';
    writeUiJson(response, 200, await readUiScenarioDetail(state, scenario));
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/run') {
    const body = await readUiJsonBody(request);
    writeUiJson(response, 200, await startUiRun(state, body));
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname.startsWith('/api/runs/') && requestUrl.pathname.endsWith('/events')) {
    const runId = requestUrl.pathname.slice('/api/runs/'.length, -'/events'.length);
    streamUiRunEvents(state, runId, response);
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/check-servers') {
    writeUiJson(response, 200, await checkUiServers(state));
    return;
  }

  writeUiJson(response, 404, { error: 'Not found' });
}

async function listUiScenarios(state: UiState): Promise<{
  configPath: string;
  scenarioDir: string;
  defaultModule?: string;
  moduleCount: number;
  scenarios: Array<{
    id: string;
    name: string;
    group: string;
    path: string;
    stepCount?: number;
    modules?: string[];
    env?: string[];
    vars?: string[];
    error?: string;
  }>;
}> {
  const scenarioDir = path.join(resolveLoadTestDir(state.cwd, state.config), 'scenarios');
  const files = await listUiScenarioFiles(scenarioDir);
  const scenarios = [];

  for (const filePath of files) {
    try {
      const scenario = await parseWorkspaceScenarioFile(state.cwd, state.config, filePath);
      const analysis = analyzeUiScenario(scenario);
      scenarios.push({
        id: formatUiScenarioOption(state.cwd, scenarioDir, filePath),
        name: scenario.name,
        group: formatUiScenarioGroup(scenarioDir, filePath),
        path: formatDisplayPath(state.cwd, filePath),
        stepCount: scenario.steps.length,
        modules: analysis.modules,
        env: analysis.env,
        vars: analysis.vars,
      });
    } catch (error) {
      scenarios.push({
        id: formatDisplayPath(state.cwd, filePath),
        name: resolveScenarioName(filePath),
        group: formatUiScenarioGroup(scenarioDir, filePath),
        path: formatDisplayPath(state.cwd, filePath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    configPath: formatDisplayPath(state.cwd, state.config.path),
    scenarioDir: formatDisplayPath(state.cwd, scenarioDir),
    ...(state.config.defaultModule === undefined ? {} : { defaultModule: state.config.defaultModule }),
    moduleCount: state.config.modules.size,
    scenarios,
  };
}

async function readUiScenarioDetail(
  state: UiState,
  scenarioOption: string,
): Promise<{
  id: string;
  name: string;
  path: string;
  stepCount: number;
  modules: string[];
  env: string[];
  vars: string[];
  includes: string[];
  fixtures: string[];
  steps: Array<{
    id: string;
    source: {
      kind: 'direct' | 'use' | 'include';
      reference?: string;
    };
    module?: string;
    operationId?: string;
    method?: string;
    path?: string;
    condition?: string;
    extract?: string[];
    definition?: {
      path: string;
      code: string;
    };
  }>;
}> {
  const scenarioPath = resolveUiScenarioPath(state, scenarioOption);
  const scenario = await parseWorkspaceScenarioFile(state.cwd, state.config, scenarioPath);
  const analysis = analyzeUiScenario(scenario);
  const stepSources = await readUiScenarioStepSources(state, scenarioPath);
  const stepDefinitions = await readUiScenarioStepDefinitions(state, scenarioPath);

  return {
    id: formatUiScenarioOption(state.cwd, path.join(resolveLoadTestDir(state.cwd, state.config), 'scenarios'), scenarioPath),
    name: scenario.name,
    path: formatDisplayPath(state.cwd, scenarioPath),
    stepCount: scenario.steps.length,
    modules: analysis.modules,
    env: analysis.env,
    vars: analysis.vars,
    includes: await readScenarioIncludes(scenarioPath),
    fixtures: await readTopLevelStringArray(scenarioPath, 'fixtures'),
    steps: scenario.steps.map((step, index) => ({
      id: step.id,
      source: stepSources[index] ?? { kind: 'direct' },
      ...(step.api.module === undefined ? {} : { module: step.api.module }),
      ...(step.api.operationId === undefined ? {} : { operationId: step.api.operationId }),
      ...(step.api.method === undefined ? {} : { method: step.api.method }),
      ...(step.api.path === undefined ? {} : { path: step.api.path }),
      ...(step.condition === undefined ? {} : { condition: step.condition }),
      ...(step.extract === undefined ? {} : { extract: Object.keys(step.extract) }),
      ...(stepDefinitions[index] === undefined ? {} : { definition: stepDefinitions[index] }),
    })),
  };
}

function analyzeUiScenario(scenario: Scenario): {
  modules: string[];
  env: string[];
  vars: string[];
} {
  const modules = new Set<string>();
  const env = new Set<string>();
  const vars = new Set<string>();

  for (const step of scenario.steps) {
    if (step.api.module !== undefined) {
      modules.add(step.api.module);
    }

    collectUiTemplateReferences(step.request, env, vars);
  }

  collectUiTemplateReferences(scenario.vars, env, vars);

  return {
    modules: [...modules].sort(),
    env: [...env].sort(),
    vars: [...vars].sort(),
  };
}

function collectUiTemplateReferences(value: unknown, env: Set<string>, vars: Set<string>): void {
  if (typeof value === 'string') {
    try {
      for (const reference of collectTemplateReferences(value)) {
        if (reference.type === 'env') {
          env.add(reference.name);
        } else if (reference.type === 'vars') {
          vars.add(reference.name);
        }
      }
    } catch {
      return;
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUiTemplateReferences(item, env, vars);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectUiTemplateReferences(item, env, vars);
    }
  }
}

async function startUiRun(
  state: UiState,
  body: unknown,
): Promise<{ runId: string; status: UiRunStatus }> {
  const payload = parseUiRunPayload(body);
  const scenario = validateUiScenarioOption(state, payload.scenario);
  const runId = String(state.nextRunId++);
  const run: UiRunRecord = {
    id: runId,
    command: payload.command,
    scenario,
    status: 'running',
    chunks: [],
    clients: new Set(),
    ansiHtmlState: createAnsiHtmlState(),
  };

  state.runs.set(runId, run);
  void runUiCliCommand(state, run, payload);
  return { runId, status: run.status };
}

function parseUiRunPayload(value: unknown): {
  command: 'validate' | 'test';
  scenario: string;
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
    varFile: parseUiStringArray(record.varFile, 'varFile'),
    vars: parseUiStringArray(record.vars, 'vars'),
  };
}

async function runUiCliCommand(
  state: UiState,
  run: UiRunRecord,
  payload: { command: 'validate' | 'test'; scenario: string; varFile: string[]; vars: string[] },
): Promise<void> {
  const scenarioPath = resolveUiScenarioPath(state, payload.scenario);
  const stepSources = payload.command === 'test'
    ? await readUiScenarioStepSources(state, scenarioPath)
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
          appendUiRunTestResult(run, createUiRunTestResult(result, stepSources));
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
  state: UiState,
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

function createUiRunWritable(run: UiRunRecord, stream: 'stdout' | 'stderr'): WritableLike {
  return {
    write(chunk: string | Uint8Array): unknown {
      appendUiRunChunk(run, stream, typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    },
    isTTY: false,
  };
}

function appendUiRunChunk(run: UiRunRecord, stream: 'stdout' | 'stderr', chunk: string): void {
  const event = {
    stream,
    chunk,
    html: renderAnsiChunkToHtml(chunk, run.ansiHtmlState),
  };
  run.chunks.push(event);
  writeUiRunEvent(run, 'chunk', event);
}

function appendUiRunTestResult(run: UiRunRecord, result: UiRunTestResult): void {
  run.testResult = result;
  writeUiRunEvent(run, 'test-result', result);
}

function createUiRunTestResult(
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

function createUiScenarioReporter(
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

function finishUiRun(run: UiRunRecord, status: 'passed' | 'failed', exitCode: number): void {
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

function streamUiRunEvents(state: UiState, runId: string, response: ServerResponse): void {
  const run = state.runs.get(runId);

  if (run === undefined) {
    writeUiJson(response, 404, { error: `run ${JSON.stringify(runId)} was not found` });
    return;
  }

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

function writeUiRunEvent(run: UiRunRecord, name: string, data: unknown): void {
  for (const client of run.clients) {
    writeSseEvent(client, name, data);
  }
}

async function checkUiServers(state: UiState): Promise<{
  checkedAt: string;
  modules: Array<{
    name: string;
    baseUrl?: string;
    source?: string;
    status: 'unknown' | 'reachable' | 'failed';
    httpStatus?: number;
    durationMs?: number;
    error?: string;
    snapshot: {
      path?: string;
      status: UiSnapshotStatus;
      error?: string;
    };
  }>;
}> {
  const loadTestDir = resolveLoadTestDir(state.cwd, state.config);
  const runtimeEnv = {
    ...(await loadLoadTestEnv(loadTestDir)),
    ...(state.context.env ?? process.env),
  };
  const modules = [];

  for (const moduleConfig of state.config.modules.values()) {
    modules.push(await checkUiModuleServer(state, moduleConfig, runtimeEnv));
  }

  return {
    checkedAt: new Date().toISOString(),
    modules,
  };
}

async function checkUiModuleServer(
  state: UiState,
  moduleConfig: LoadTestModuleConfig,
  runtimeEnv: Record<string, string | undefined>,
): Promise<{
  name: string;
  baseUrl?: string;
  source?: string;
  status: 'unknown' | 'reachable' | 'failed';
  httpStatus?: number;
  durationMs?: number;
  error?: string;
  snapshot: {
    path?: string;
    status: UiSnapshotStatus;
    error?: string;
  };
}> {
  const snapshot = await checkUiSnapshot(state, moduleConfig);
  const resolved = await resolveUiModuleBaseUrl(state, moduleConfig, runtimeEnv);

  if (resolved.baseUrl === undefined) {
    return {
      name: moduleConfig.name,
      status: 'unknown',
      error: 'baseUrl is not configured',
      snapshot,
    };
  }

  const startedAt = Date.now();

  try {
    const response = await fetchUiReachability(state.context.fetch ?? fetch, resolved.baseUrl);
    return {
      name: moduleConfig.name,
      baseUrl: resolved.baseUrl,
      source: resolved.source,
      status: 'reachable',
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      snapshot,
    };
  } catch (error) {
    return {
      name: moduleConfig.name,
      baseUrl: resolved.baseUrl,
      source: resolved.source,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: formatUiError(error),
      snapshot,
    };
  }
}

async function checkUiSnapshot(
  state: UiState,
  moduleConfig: LoadTestModuleConfig,
): Promise<{ path?: string; status: UiSnapshotStatus; error?: string }> {
  if (!isConfiguredValue(moduleConfig.snapshot)) {
    return {
      status: 'missing',
      error: 'snapshot is not configured',
    };
  }

  const snapshotPath = resolveConfigFilePath(state.config, moduleConfig.snapshot);
  const displayPath = formatDisplayPath(state.cwd, snapshotPath);

  try {
    await fs.access(snapshotPath);
    return {
      path: displayPath,
      status: 'present',
    };
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return {
        path: displayPath,
        status: 'missing',
        error: 'run openapi-k6 sync',
      };
    }

    return {
      path: displayPath,
      status: 'error',
      error: formatUiError(error),
    };
  }
}

function formatUiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && 'cause' in error
    ? (error as Error & { cause?: unknown }).cause
    : undefined;

  if (cause instanceof Error && cause.message && cause.message !== message) {
    return `${message}: ${cause.message}`;
  }

  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
    return `${message}: ${cause.code}`;
  }

  return message;
}

async function resolveUiModuleBaseUrl(
  state: UiState,
  moduleConfig: LoadTestModuleConfig,
  runtimeEnv: Record<string, string | undefined>,
): Promise<{ baseUrl?: string; source?: string }> {
  const moduleEnvName = createModuleBaseUrlEnvName(moduleConfig.name);
  const moduleEnv = normalizeConfiguredValue(runtimeEnv[moduleEnvName]);

  if (moduleEnv !== undefined) {
    return { baseUrl: moduleEnv, source: moduleEnvName };
  }

  const rootEnv = normalizeConfiguredValue(runtimeEnv.BASE_URL);

  if (rootEnv !== undefined) {
    return { baseUrl: rootEnv, source: 'BASE_URL' };
  }

  const moduleBaseUrl = normalizeConfiguredValue(moduleConfig.baseUrl);

  if (moduleBaseUrl !== undefined) {
    return { baseUrl: moduleBaseUrl, source: `modules.${moduleConfig.name}.baseUrl` };
  }

  const rootBaseUrl = normalizeConfiguredValue(state.config.baseUrl);

  if (rootBaseUrl !== undefined) {
    return { baseUrl: rootBaseUrl, source: 'baseUrl' };
  }

  if (isConfiguredValue(moduleConfig.snapshot)) {
    try {
      const registry = await parseOpenApiFile(resolveConfigFilePath(state.config, moduleConfig.snapshot));

      if (registry.defaultServerUrl !== undefined) {
        return { baseUrl: registry.defaultServerUrl, source: `modules.${moduleConfig.name}.snapshot servers[0].url` };
      }
    } catch {
      return {};
    }
  }

  return {};
}

async function fetchUiReachability(fetchImpl: typeof fetch, baseUrl: string): Promise<Response> {
  const targetUrl = new URL(baseUrl);
  const head = await fetchWithTimeout(fetchImpl, targetUrl, 'HEAD');

  if (head.ok || head.status > 0) {
    return head;
  }

  return fetchWithTimeout(fetchImpl, targetUrl, 'GET');
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: URL, method: 'GET' | 'HEAD'): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    return await fetchImpl(url, {
      method,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function listUiScenarioFiles(directoryPath: string): Promise<string[]> {
  let entries: Dirent[];

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return [];
    }

    throw error;
  }

  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'partials' && entry.name !== 'fixtures') {
        files.push(...await listUiScenarioFiles(entryPath));
      }
    } else if (entry.isFile() && isScenarioFile(entry.name) && !entry.name.endsWith('.example')) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function formatUiScenarioOption(cwd: string, scenarioDir: string, filePath: string): string {
  const relative = path.relative(scenarioDir, filePath);

  if (isLocalRelativePath(relative) && path.extname(relative).toLowerCase() === '.yaml') {
    const scenarioKey = formatScenarioKey(relative);

    if (isScenarioKey(scenarioKey)) {
      return scenarioKey;
    }
  }

  return formatDisplayPath(cwd, filePath);
}

function formatUiScenarioGroup(scenarioDir: string, filePath: string): string {
  const relative = path.relative(scenarioDir, filePath);
  const group = path.dirname(relative).split(path.sep).join('/');
  return group === '.' ? 'root' : group;
}

function validateUiScenarioOption(state: UiState, value: string): string {
  resolveUiScenarioPath(state, value);
  return value;
}

function resolveUiScenarioPath(state: UiState, value: string): string {
  const scenarioDir = path.join(resolveLoadTestDir(state.cwd, state.config), 'scenarios');
  const keyedScenarioPath = isScenarioKey(value)
    ? path.join(scenarioDir, `${normalizeScenarioKey(value)}.yaml`)
    : undefined;
  const scenarioPath = keyedScenarioPath !== undefined && existsSync(keyedScenarioPath)
    ? keyedScenarioPath
    : resolveScenarioPath(state.cwd, state.config, value);
  const relative = path.relative(scenarioDir, scenarioPath);

  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes('partials') ||
    relative.split(path.sep).includes('fixtures')
  ) {
    throw new Error(`scenario must be inside ${formatDisplayPath(state.cwd, scenarioDir)}`);
  }

  return scenarioPath;
}

async function readTopLevelStringArray(filePath: string, key: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  const value = (parsed as Record<string, unknown>)[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

async function readScenarioIncludes(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  const steps = (parsed as Record<string, unknown>).steps;

  if (!Array.isArray(steps)) {
    return [];
  }

  return steps.flatMap((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      return [];
    }

    const record = step as Record<string, unknown>;
    return [
      typeof record.include === 'string' ? record.include : undefined,
      typeof record.use === 'string' ? record.use : undefined,
    ].filter((item): item is string => item !== undefined);
  });
}

interface UiScenarioStepSource {
  kind: 'direct' | 'use' | 'include';
  reference?: string;
}

interface UiScenarioStepDefinition {
  path: string;
  code: string;
}

async function readUiScenarioStepSources(state: UiState, filePath: string): Promise<UiScenarioStepSource[]> {
  try {
    return await readUiScenarioStepSourcesInternal(state, path.resolve(filePath), new Set());
  } catch {
    return [];
  }
}

async function readUiScenarioStepSourcesInternal(
  state: UiState,
  filePath: string,
  stack: Set<string>,
): Promise<UiScenarioStepSource[]> {
  if (stack.has(filePath)) {
    return [];
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  const steps = (parsed as Record<string, unknown>).steps;

  if (!Array.isArray(steps)) {
    return [];
  }

  const nextStack = new Set(stack);
  nextStack.add(filePath);
  const sources: UiScenarioStepSource[] = [];

  for (const step of steps) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      sources.push({ kind: 'direct' });
      continue;
    }

    const record = step as Record<string, unknown>;
    const useReference = typeof record.use === 'string' ? record.use : undefined;
    const includeReference = typeof record.include === 'string' ? record.include : undefined;

    if (useReference !== undefined) {
      const nestedPath = resolveUiScenarioPath(state, useReference);
      const nestedSources = await readUiScenarioStepSourcesInternal(state, nestedPath, nextStack);
      sources.push(...nestedSources.map(() => ({ kind: 'use' as const, reference: useReference })));
      continue;
    }

    if (includeReference !== undefined) {
      const nestedPath = path.resolve(path.dirname(filePath), includeReference);
      const nestedSources = await readUiScenarioStepSourcesInternal(state, nestedPath, nextStack);
      sources.push(...nestedSources.map(() => ({ kind: 'include' as const, reference: includeReference })));
      continue;
    }

    sources.push({ kind: 'direct' });
  }

  return sources;
}

async function readUiScenarioStepDefinitions(state: UiState, filePath: string): Promise<UiScenarioStepDefinition[]> {
  try {
    return await readUiScenarioStepDefinitionsInternal(state, path.resolve(filePath), new Set());
  } catch {
    return [];
  }
}

async function readUiScenarioStepDefinitionsInternal(
  state: UiState,
  filePath: string,
  stack: Set<string>,
): Promise<UiScenarioStepDefinition[]> {
  if (stack.has(filePath)) {
    return [];
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const document = parseDocument(raw, { keepSourceTokens: true });

  if (document.errors.length > 0 || !isMap(document.contents)) {
    return [];
  }

  const steps = document.contents.get('steps', true);

  if (!isSeq(steps)) {
    return [];
  }

  const nextStack = new Set(stack);
  nextStack.add(filePath);
  const definitions: UiScenarioStepDefinition[] = [];

  for (const step of steps.items) {
    if (!isMap(step)) {
      continue;
    }

    const useReference = readYamlMapString(step, 'use');
    const includeReference = readYamlMapString(step, 'include');

    if (useReference !== undefined) {
      const nestedPath = resolveUiScenarioPath(state, useReference);
      definitions.push(...await readUiScenarioStepDefinitionsInternal(state, nestedPath, nextStack));
      continue;
    }

    if (includeReference !== undefined) {
      const nestedPath = path.resolve(path.dirname(filePath), includeReference);
      definitions.push(...await readUiScenarioStepDefinitionsInternal(state, nestedPath, nextStack));
      continue;
    }

    const code = formatYamlNodeSnippet(raw, step);

    if (code !== undefined) {
      definitions.push({
        path: formatDisplayPath(state.cwd, filePath),
        code,
      });
    }
  }

  return definitions;
}

function readYamlMapString(node: YAMLMap, key: string): string | undefined {
  const value = node.get(key);
  return typeof value === 'string' ? value : undefined;
}

function formatYamlNodeSnippet(raw: string, node: unknown): string | undefined {
  const range = readYamlNodeRange(node);

  if (range === undefined) {
    return undefined;
  }

  const lineStart = raw.lastIndexOf('\n', Math.max(0, range[0] - 1)) + 1;
  return dedentYamlSnippet(raw.slice(lineStart, range[1]));
}

function readYamlNodeRange(node: unknown): [number, number, number?] | undefined {
  const range = node && typeof node === 'object'
    ? (node as { range?: unknown }).range
    : undefined;

  if (
    Array.isArray(range) &&
    typeof range[0] === 'number' &&
    typeof range[1] === 'number'
  ) {
    return [range[0], range[1], typeof range[2] === 'number' ? range[2] : undefined];
  }

  return undefined;
}

function dedentYamlSnippet(value: string): string {
  const lines = value.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.match(/^ */)?.[0].length ?? 0);
  const indent = indents.length === 0 ? 0 : Math.min(...indents);

  return lines.map((line) => line.trim() === '' ? '' : line.slice(indent)).join('\n');
}

async function readUiJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLength += buffer.length;

    if (totalLength > 1024 * 1024) {
      throw new Error('request body is too large');
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
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

function writeUiHtml(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
  });
  response.end(UI_HTML);
}

function writeUiJson(response: ServerResponse, statusCode: number, data: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  });
  response.end(JSON.stringify(data));
}

function writeSseEvent(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function normalizeUiHost(value: string | undefined): string {
  const host = value?.trim() ?? '127.0.0.1';

  if (!host) {
    throw new Error('--host must not be empty');
  }

  return host;
}

function parseUiPort(value: string | undefined): number {
  if (value === undefined) {
    return 3766;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('--port must be an integer between 0 and 65535');
  }

  return port;
}

async function listenUiServer(
  server: Server,
  host: string,
  port: number,
  explicitPort: boolean,
): Promise<number> {
  const maxAttempts = explicitPort || port === 0 ? 1 : 10;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidatePort = port === 0 ? 0 : port + attempt;

    try {
      return await listenUiServerOnce(server, host, candidatePort);
    } catch (error) {
      if (explicitPort || !isNodeErrorCode(error, 'EADDRINUSE')) {
        throw error;
      }
    }
  }

  throw new Error(`No available port found starting at ${port}`);
}

function listenUiServerOnce(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address() as AddressInfo;
      resolve(address.port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeUiServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
