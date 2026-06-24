import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

import { loadTestConfig, resolveConfigModule, type LoadTestConfig } from '../../config/load-test.config.js';
import type { ScenarioExecutionReporter, ScenarioInputProvider } from '../../executor/scenario.executor.js';
import { DEFAULT_WORKSPACE_DIR } from '../../scaffold/load-test.init.js';
import { streamUiRunEvents, submitUiRunInput, type UiRunRecord } from './run-state.js';
import { startUiRun } from './run-command.js';
import { checkUiServers } from './server-checks.js';
import {
  closeUiServer,
  listenUiServer,
  normalizeUiHost,
  parseUiPort,
  readUiJsonBody,
  writeUiHtml,
  writeUiJson,
} from './server-http.js';
import {
  listUiScenarios,
  readUiScenarioDetail,
} from './scenarios.js';

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
  inputProvider?: ScenarioInputProvider;
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

function writeLine(stream: WritableLike, message: string): void {
  stream.write(`${message}\n`);
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

interface UiState {
  cwd: string;
  options: UiOptions;
  context: CliContext;
  config: LoadTestConfig;
  runCli: (argv: string[], context: CliContext) => Promise<void>;
  runs: Map<string, UiRunRecord>;
  nextRunId: number;
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
    const run = state.runs.get(runId);

    if (run === undefined) {
      writeUiJson(response, 404, { error: `run ${JSON.stringify(runId)} was not found` });
      return;
    }

    streamUiRunEvents(run, response);
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname.startsWith('/api/runs/') && requestUrl.pathname.endsWith('/input')) {
    const runId = requestUrl.pathname.slice('/api/runs/'.length, -'/input'.length);
    const run = state.runs.get(runId);

    if (run === undefined) {
      writeUiJson(response, 404, { error: `run ${JSON.stringify(runId)} was not found` });
      return;
    }

    const body = await readUiJsonBody(request);
    writeUiJson(response, 200, submitUiRunInput(run, body));
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/check-servers') {
    writeUiJson(response, 200, await checkUiServers({
      cwd: state.cwd,
      config: state.config,
      env: state.context.env,
      fetch: state.context.fetch,
    }));
    return;
  }

  writeUiJson(response, 404, { error: 'Not found' });
}
