import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { loadTestConfig, resolveConfigModule, type LoadTestConfig } from '../../config/load-test.config.js';
import type { ScenarioExecutionReporter } from '../../executor/scenario.executor.js';
import { DEFAULT_WORKSPACE_DIR } from '../../scaffold/load-test.init.js';
import { UI_HTML } from './html.js';
import { streamUiRunEvents, type UiRunRecord } from './run-state.js';
import { startUiRun } from './run-command.js';
import { checkUiServers } from './server-checks.js';
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
