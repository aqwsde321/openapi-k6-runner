#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { parse as parseDotEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { buildAst } from '../compiler/ast.builder.js';
import { generateK6Script } from '../compiler/k6.generator.js';
import {
  loadTestConfig,
  resolveConfigFilePath,
  resolveConfigModule,
  type LoadTestConfig,
  type LoadTestModuleConfig,
} from '../config/load-test.config.js';
import {
  executeAstScenario,
  type ScenarioExecutionReporter,
  type ScenarioExecutionResult,
} from '../executor/scenario.executor.js';
import { syncOpenApiSnapshot } from '../openapi/openapi.catalog.js';
import { parseOpenApiFile } from '../openapi/openapi.parser.js';
import { parseScenarioFile } from '../parser/scenario.parser.js';
import { initLoadTests } from '../scaffold/load-test.init.js';
import { createScenarioConsoleReporter } from './test.reporter.js';

type WritableLike = {
  write(chunk: string): unknown;
  isTTY?: boolean;
};

type ReadableLike = NodeJS.ReadableStream & {
  isTTY?: boolean;
};

const DEFAULT_CONFIG_PATH = 'load-tests/config.yaml';
const DEFAULT_LOAD_TEST_DIR = 'load-tests';
const DEFAULT_INIT_BASE_URL = 'http://localhost:8080';
const DEFAULT_INIT_OPENAPI_PATH = '/v3/api-docs';
const OPENAPI_CHECK_TIMEOUT_MS = 5000;
const COMMON_OPENAPI_PATHS = [
  '/v3/api-docs',
  '/api-docs',
  '/openapi.json',
  '/swagger.json',
  '/swagger/v1/swagger.json',
];
const TODO_VALUE = 'TODO';

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

export interface GenerateOptions {
  scenario: string;
  openapi?: string;
  write?: string;
  config?: string;
  module?: string;
}

export interface SyncOptions {
  openapi?: string;
  write?: string;
  catalog?: string;
  config?: string;
  module?: string;
}

export interface TestOptions {
  scenario: string;
  config?: string;
  module?: string;
  color?: boolean;
}

export interface InitOptions {
  dir?: string;
  module?: string;
  baseUrl?: string;
  openapi?: string;
  smokePath?: string;
  force?: boolean;
  input?: boolean;
  noInput?: boolean;
}

export interface GenerateResult {
  outputPath: string;
  scenarioPath: string;
  openapiPath: string;
  baseUrl: string;
  moduleName?: string;
}

export interface SyncResult {
  snapshotPath: string;
  catalogPath: string;
  openapiPath: string;
  operationCount: number;
  moduleName?: string;
}

export interface TestResult extends ScenarioExecutionResult {
  scenarioPath: string;
  openapiPath: string;
  moduleName?: string;
}

export interface InitResult {
  directoryPath: string;
  configPath: string;
  runScriptPath: string;
  scenarioPath: string;
  readmePath: string;
}

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
}

function resolveOpenApiInput(cwd: string, value: string): string {
  if (isHttpUrl(value)) {
    return value;
  }

  return path.resolve(cwd, value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeBaseUrlInput(value: string): string {
  const trimmed = value.trim();

  if (!isHttpUrl(trimmed)) {
    return trimmed;
  }

  const url = new URL(trimmed);
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.search = '';
  url.hash = '';

  const normalized = url.toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function normalizeUrlPath(value: string): string {
  if (value === '' || value === '/') {
    return '/';
  }

  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

function joinUrlPath(basePath: string, suffixPath: string): string {
  const normalizedBasePath = normalizeUrlPath(basePath);
  const normalizedSuffixPath = normalizeUrlPath(suffixPath);

  if (normalizedBasePath === '/') {
    return normalizedSuffixPath;
  }

  return `${normalizedBasePath}${normalizedSuffixPath}`;
}

function buildDefaultOpenApiUrl(baseUrl: string): string {
  if (!isHttpUrl(baseUrl)) {
    return DEFAULT_INIT_OPENAPI_PATH;
  }

  const url = new URL(baseUrl);
  url.pathname = joinUrlPath(url.pathname, DEFAULT_INIT_OPENAPI_PATH);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function inferOpenApiContextPath(pathname: string): string {
  const swaggerUiIndex = pathname.indexOf('/swagger-ui/');

  if (swaggerUiIndex >= 0) {
    return pathname.slice(0, swaggerUiIndex) || '/';
  }

  if (pathname.endsWith('/swagger-ui.html')) {
    return pathname.slice(0, -'/swagger-ui.html'.length) || '/';
  }

  for (const openApiPath of COMMON_OPENAPI_PATHS) {
    if (pathname.endsWith(openApiPath)) {
      return pathname.slice(0, -openApiPath.length) || '/';
    }
  }

  const lastSlashIndex = pathname.lastIndexOf('/');
  return lastSlashIndex > 0 ? pathname.slice(0, lastSlashIndex) : '/';
}

function commonOpenApiUrlsFrom(sourceUrl: string, baseUrl: string | undefined): string[] {
  const source = new URL(sourceUrl);
  const bases = new Map<string, { origin: string; basePath: string }>();
  const addBase = (origin: string, basePath: string) => {
    const normalizedBasePath = normalizeUrlPath(basePath);
    bases.set(`${origin}${normalizedBasePath}`, { origin, basePath: normalizedBasePath });
  };

  addBase(source.origin, inferOpenApiContextPath(source.pathname));
  addBase(source.origin, '/');

  if (baseUrl !== undefined && isHttpUrl(baseUrl)) {
    const base = new URL(baseUrl);
    addBase(base.origin, base.pathname);
    addBase(base.origin, '/');
  }

  const candidates = new Set<string>();

  for (const { origin, basePath } of bases.values()) {
    for (const openApiPath of COMMON_OPENAPI_PATHS) {
      candidates.add(new URL(joinUrlPath(basePath, openApiPath), origin).toString());
    }
  }

  candidates.delete(source.toString());
  return [...candidates];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type OpenApiCheckResult = {
  ok: boolean;
  message: string;
};

function validateOpenApiDocument(value: unknown): OpenApiCheckResult {
  if (!isRecord(value)) {
    return { ok: false, message: 'response body is not an object' };
  }

  if (typeof value.swagger === 'string') {
    return { ok: false, message: 'Swagger 2.0 documents are not supported' };
  }

  if (typeof value.openapi !== 'string' || !value.openapi.startsWith('3.')) {
    return { ok: false, message: 'response is not an OpenAPI 3.x document' };
  }

  if (!isRecord(value.info)) {
    return { ok: false, message: 'OpenAPI info object is missing' };
  }

  if (!isRecord(value.paths)) {
    return { ok: false, message: 'OpenAPI paths object is missing' };
  }

  return { ok: true, message: `OpenAPI ${value.openapi}` };
}

async function checkOpenApiUrl(
  openapiUrl: string,
  fetchImpl: typeof fetch,
): Promise<OpenApiCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAPI_CHECK_TIMEOUT_MS);

  try {
    const response = await fetchImpl(openapiUrl, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status}` };
    }

    try {
      return validateOpenApiDocument(await response.json());
    } catch {
      const contentType = response.headers.get('content-type');
      return {
        ok: false,
        message: contentType === null
          ? 'response is not JSON'
          : `response is not JSON (${contentType})`,
      };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, message: `timed out after ${OPENAPI_CHECK_TIMEOUT_MS}ms` };
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkOpenApiFile(cwd: string, openapiPath: string): Promise<OpenApiCheckResult> {
  try {
    await parseOpenApiFile(resolveOpenApiInput(cwd, openapiPath));
    return { ok: true, message: 'OpenAPI file parsed' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

type OpenApiResolveResult =
  | { ok: true; openapi: string }
  | { ok: false; message: string };

async function resolveOpenApiForInit(
  cwd: string,
  openapiInput: string,
  baseUrl: string | undefined,
  stdout: WritableLike,
  fetchImpl: typeof fetch,
): Promise<OpenApiResolveResult> {
  writeLine(stdout, '');
  writeLine(stdout, 'OpenAPI discovery');

  if (!isHttpUrl(openapiInput)) {
    const fileCheck = await checkOpenApiFile(cwd, openapiInput);
    writeInitStatus(stdout, fileCheck.ok ? 'success' : 'failure', openapiInput, fileCheck.message);

    if (fileCheck.ok) {
      return { ok: true, openapi: openapiInput };
    }

    return { ok: false, message: fileCheck.message };
  }

  const directCheck = await checkOpenApiUrl(openapiInput, fetchImpl);
  writeInitStatus(stdout, directCheck.ok ? 'success' : 'failure', openapiInput, directCheck.message);

  if (directCheck.ok) {
    return { ok: true, openapi: openapiInput };
  }

  let lastMessage = directCheck.message;

  for (const candidate of commonOpenApiUrlsFrom(openapiInput, baseUrl)) {
    const candidateCheck = await checkOpenApiUrl(candidate, fetchImpl);
    writeInitStatus(stdout, candidateCheck.ok ? 'success' : 'failure', candidate, candidateCheck.message);

    if (candidateCheck.ok) {
      return { ok: true, openapi: candidate };
    }

    lastMessage = `${candidate}: ${candidateCheck.message}`;
  }

  return { ok: false, message: lastMessage };
}

function shouldPromptForInit(
  options: InitOptions,
  context: CliContext,
  stdin: ReadableLike,
  stdout: WritableLike,
): boolean {
  if (options.noInput === true || options.input === false) {
    return false;
  }

  if (options.baseUrl !== undefined && options.openapi !== undefined) {
    return false;
  }

  if (context.interactive !== undefined) {
    return context.interactive;
  }

  return stdin.isTTY === true && stdout.isTTY === true;
}

async function promptForBaseUrl(
  readline: ReturnType<typeof createInterface>,
  stdout: WritableLike,
): Promise<string> {
  while (true) {
    const answer = await readline.question(`API base URL [${DEFAULT_INIT_BASE_URL}]: `);
    const baseUrl = normalizeBaseUrlInput(answer.trim() || DEFAULT_INIT_BASE_URL);

    if (isHttpUrl(baseUrl)) {
      return baseUrl;
    }

    writeLine(stdout, 'baseUrl must be an http(s) URL.');
  }
}

async function promptForOpenApi(
  readline: ReturnType<typeof createInterface>,
  cwd: string,
  baseUrl: string | undefined,
  stdout: WritableLike,
  fetchImpl: typeof fetch,
): Promise<string> {
  let defaultOpenApi = buildDefaultOpenApiUrl(baseUrl ?? DEFAULT_INIT_BASE_URL);

  while (true) {
    const answer = await readline.question(`OpenAPI spec URL/file path or "skip" [${defaultOpenApi}]: `);
    const trimmed = answer.trim();

    if (trimmed.toLowerCase() === 'skip') {
      writeLine(stdout, `${initStatusSymbol(stdout, 'warning')} Saved ${defaultOpenApi} without checking. Edit config.yaml later if needed.`);
      return defaultOpenApi;
    }

    const candidate = trimmed || defaultOpenApi;
    const result = await resolveOpenApiForInit(cwd, candidate, baseUrl, stdout, fetchImpl);

    if (result.ok) {
      return result.openapi;
    }

    writeLine(stdout, '');
    writeLine(stdout, `${initStatusSymbol(stdout, 'failure')} OpenAPI check failed: ${result.message}`);
    writeLine(stdout, '  Enter another URL/file path, press Enter to retry, or type "skip" to save it and edit config.yaml later.');
    defaultOpenApi = candidate;
  }
}

async function autoResolveOpenApiForInit(
  cwd: string,
  baseUrl: string | undefined,
  stdout: WritableLike,
  fetchImpl: typeof fetch,
): Promise<OpenApiResolveResult> {
  const defaultOpenApi = buildDefaultOpenApiUrl(baseUrl ?? DEFAULT_INIT_BASE_URL);
  const result = await resolveOpenApiForInit(cwd, defaultOpenApi, baseUrl, stdout, fetchImpl);

  if (!result.ok) {
    writeLine(stdout, '');
    writeLine(stdout, `${initStatusSymbol(stdout, 'warning')} OpenAPI auto-discovery failed.`);
    writeLine(stdout, '  Enter an OpenAPI URL/file path, or type "skip" to save the default and edit config.yaml later.');
  }

  return result;
}

async function resolveInitOptionsInteractively(
  options: InitOptions,
  context: CliContext,
  cwd: string,
): Promise<InitOptions> {
  const stdin = context.stdin ?? process.stdin;
  const stdout = context.stdout ?? process.stdout;

  if (!shouldPromptForInit(options, context, stdin, stdout)) {
    return options;
  }

  const readline = createInterface({
    input: stdin,
    output: stdout as NodeJS.WritableStream,
    terminal: stdout.isTTY === true,
  });

  try {
    const baseUrl = options.baseUrl === undefined
      ? await promptForBaseUrl(readline, stdout)
      : normalizeBaseUrlInput(options.baseUrl);
    let openapi = options.openapi;

    if (openapi === undefined) {
      const fetchImpl = context.fetch ?? fetch;
      const automaticOpenApi = await autoResolveOpenApiForInit(cwd, baseUrl, stdout, fetchImpl);
      openapi = automaticOpenApi.ok
        ? automaticOpenApi.openapi
        : await promptForOpenApi(readline, cwd, baseUrl, stdout, fetchImpl);
    }

    return {
      ...options,
      baseUrl,
      openapi,
    };
  } finally {
    readline.close();
  }
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
    if (
      configPath === undefined &&
      useDefaultConfig &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw new Error(`${DEFAULT_CONFIG_PATH} was not found. Run openapi-k6 init or pass --config.`);
    }

    throw error;
  }
}

async function loadBaseUrl(cwd: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(cwd, '.env'), 'utf8');
    const parsed = parseDotEnv(raw);
    const baseUrl = parsed.BASE_URL?.trim();
    return baseUrl || undefined;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }

    throw error;
  }
}

async function loadLoadTestEnv(loadTestDir: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(loadTestDir, '.env'), 'utf8');
    return parseDotEnv(raw);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {};
    }

    throw error;
  }
}

function selectConfigModule(
  config: LoadTestConfig | undefined,
  moduleName: string | undefined,
): LoadTestModuleConfig | undefined {
  if (config === undefined) {
    if (moduleName !== undefined) {
      throw new Error('--module requires --config');
    }

    return undefined;
  }

  return resolveConfigModule(config, moduleName);
}

function resolveConfiguredOpenApiInput(
  cwd: string,
  config: LoadTestConfig | undefined,
  cliValue: string | undefined,
  configValue: string | undefined,
  message: string,
  configFieldLabel: string,
  commandName: string,
): string {
  if (cliValue !== undefined) {
    return resolveOpenApiInput(cwd, cliValue);
  }

  if (config !== undefined && isConfiguredValue(configValue)) {
    return resolveConfigFilePath(config, configValue);
  }

  if (config !== undefined) {
    throw new Error(
      `${config.path}: ${configFieldLabel} is not configured. Replace TODO before running ${commandName}.`,
    );
  }

  throw new Error(message);
}

function resolveConfiguredFilePath(
  cwd: string,
  config: LoadTestConfig | undefined,
  cliValue: string | undefined,
  configValue: string | undefined,
  message: string,
  configFieldLabel: string,
  commandName: string,
): string {
  if (cliValue !== undefined) {
    return path.resolve(cwd, cliValue);
  }

  if (config !== undefined && isConfiguredValue(configValue)) {
    return resolveConfigFilePath(config, configValue);
  }

  if (config !== undefined) {
    throw new Error(
      `${config.path}: ${configFieldLabel} is not configured. Replace TODO before running ${commandName}.`,
    );
  }

  throw new Error(message);
}

function isConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value.trim().toUpperCase() !== TODO_VALUE;
}

function normalizeConfiguredValue(value: string | undefined): string | undefined {
  return isConfiguredValue(value) ? value.trim() : undefined;
}

function resolveScenarioPath(cwd: string, config: LoadTestConfig | undefined, value: string): string {
  if (isScenarioName(value)) {
    return path.join(resolveLoadTestDir(cwd, config), 'scenarios', `${value}.yaml`);
  }

  return path.resolve(cwd, value);
}

function resolveOutputPath(
  cwd: string,
  config: LoadTestConfig | undefined,
  scenario: string,
  write: string | undefined,
): string {
  if (write !== undefined) {
    return path.resolve(cwd, write);
  }

  const scenarioName = isScenarioName(scenario)
    ? scenario
    : path.basename(scenario, path.extname(scenario));

  return path.join(resolveLoadTestDir(cwd, config), 'generated', `${scenarioName}.k6.js`);
}

function resolveLoadTestDir(cwd: string, config: LoadTestConfig | undefined): string {
  return config?.dir ?? path.resolve(cwd, DEFAULT_LOAD_TEST_DIR);
}

function isScenarioName(value: string): boolean {
  return !path.isAbsolute(value) &&
    !value.includes('/') &&
    !value.includes('\\') &&
    path.extname(value) === '';
}

export async function runGenerateCommand(
  options: GenerateOptions,
  context: CliContext = {},
): Promise<GenerateResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, options.openapi === undefined);
  const moduleConfig = selectConfigModule(config, options.module);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const moduleName = moduleConfig?.name ?? '<none>';
  const openapiPath = resolveConfiguredOpenApiInput(
    cwd,
    config,
    options.openapi,
    moduleConfig?.snapshot,
    '--openapi is required unless --config provides modules.<name>.snapshot',
    `modules.${moduleName}.snapshot`,
    'generate',
  );
  const scenario = await parseScenarioFile(scenarioPath);
  const registry = await parseOpenApiFile(openapiPath);
  const baseUrl =
    normalizeConfiguredValue(moduleConfig?.baseUrl) ??
    normalizeConfiguredValue(config?.baseUrl) ??
    (await loadBaseUrl(cwd)) ??
    registry.defaultServerUrl;

  if (!baseUrl) {
    throw new Error('baseUrl is not configured and OpenAPI servers[0].url is missing.');
  }

  const ast = buildAst(scenario, registry);
  const outputPath = resolveOutputPath(cwd, config, options.scenario, options.write);
  const script = generateK6Script(ast, {
    baseUrl,
    fileRootDir: resolveLoadTestDir(cwd, config),
    outputPath,
  });
  const result: GenerateResult = {
    outputPath,
    scenarioPath,
    openapiPath,
    baseUrl,
    ...(moduleConfig === undefined ? {} : { moduleName: moduleConfig.name }),
  };

  await fs.mkdir(path.dirname(result.outputPath), { recursive: true });
  await fs.writeFile(result.outputPath, script, 'utf8');

  return result;
}

export async function runSyncCommand(
  options: SyncOptions,
  context: CliContext = {},
): Promise<SyncResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(
    cwd,
    options.config,
    options.openapi === undefined || options.write === undefined || options.catalog === undefined,
  );
  const moduleConfig = selectConfigModule(config, options.module);
  const moduleName = moduleConfig?.name ?? '<none>';
  const openapiPath = resolveConfiguredOpenApiInput(
    cwd,
    config,
    options.openapi,
    moduleConfig?.openapi,
    '--openapi is required unless --config provides modules.<name>.openapi',
    `modules.${moduleName}.openapi`,
    'sync',
  );
  const snapshotPath = resolveConfiguredFilePath(
    cwd,
    config,
    options.write,
    moduleConfig?.snapshot,
    '--write is required unless --config provides modules.<name>.snapshot',
    `modules.${moduleName}.snapshot`,
    'sync',
  );
  const catalogPath = resolveConfiguredFilePath(
    cwd,
    config,
    options.catalog,
    moduleConfig?.catalog,
    '--catalog is required unless --config provides modules.<name>.catalog',
    `modules.${moduleName}.catalog`,
    'sync',
  );
  const result = await syncOpenApiSnapshot({
    openapi: openapiPath,
    write: snapshotPath,
    catalog: catalogPath,
  });

  return {
    openapiPath,
    snapshotPath: result.snapshotPath,
    catalogPath: result.catalogPath,
    operationCount: result.operationCount,
    ...(moduleConfig === undefined ? {} : { moduleName: moduleConfig.name }),
  };
}

export async function runTestCommand(
  options: TestOptions,
  context: CliContext = {},
): Promise<TestResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, true);
  const moduleConfig = selectConfigModule(config, options.module);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const moduleName = moduleConfig?.name ?? '<none>';
  const openapiPath = resolveConfiguredOpenApiInput(
    cwd,
    config,
    undefined,
    moduleConfig?.snapshot,
    'modules.<name>.snapshot is required to run test',
    `modules.${moduleName}.snapshot`,
    'test',
  );
  const scenario = await parseScenarioFile(scenarioPath);
  const registry = await parseOpenApiFile(openapiPath);
  const loadTestDir = resolveLoadTestDir(cwd, config);
  const loadTestEnv = await loadLoadTestEnv(loadTestDir);
  const runtimeEnv = {
    ...loadTestEnv,
    ...(context.env ?? process.env),
  };
  const baseUrl =
    normalizeConfiguredValue(runtimeEnv.BASE_URL) ??
    normalizeConfiguredValue(moduleConfig?.baseUrl) ??
    normalizeConfiguredValue(config?.baseUrl) ??
    registry.defaultServerUrl;

  if (!baseUrl) {
    throw new Error('baseUrl is not configured and OpenAPI servers[0].url is missing.');
  }

  const ast = buildAst(scenario, registry);
  const result = await executeAstScenario(ast, {
    baseUrl,
    fileRootDir: loadTestDir,
    env: runtimeEnv,
    fetch: context.fetch,
    reporter: context.testReporter,
  });

  return {
    ...result,
    scenarioPath,
    openapiPath,
    ...(moduleConfig === undefined ? {} : { moduleName: moduleConfig.name }),
  };
}

export async function runInitCommand(
  options: InitOptions,
  context: CliContext = {},
): Promise<InitResult> {
  const cwd = resolveCwd(context);
  const resolvedOptions = await resolveInitOptionsInteractively(options, context, cwd);

  return initLoadTests({
    cwd,
    directory: resolvedOptions.dir,
    module: resolvedOptions.module,
    baseUrl: resolvedOptions.baseUrl,
    openapi: resolvedOptions.openapi,
    smokePath: resolvedOptions.smokePath,
    force: resolvedOptions.force,
  });
}

function writeLine(stream: WritableLike, message: string): void {
  stream.write(`${message}\n`);
}

type InitStatus = 'success' | 'failure' | 'warning';

function shouldColorInitOutput(stream: WritableLike): boolean {
  return stream.isTTY === true && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';
}

function colorizeInit(stream: WritableLike, code: number, message: string): string {
  return shouldColorInitOutput(stream) ? `\u001b[${code}m${message}\u001b[0m` : message;
}

function initStatusSymbol(stream: WritableLike, status: InitStatus): string {
  if (status === 'success') {
    return colorizeInit(stream, 32, '✓');
  }

  if (status === 'failure') {
    return colorizeInit(stream, 31, '✗');
  }

  return colorizeInit(stream, 33, '!');
}

function writeInitStatus(
  stream: WritableLike,
  status: InitStatus,
  target: string,
  message: string,
): void {
  writeLine(stream, `  ${initStatusSymbol(stream, status)} ${target}  ${message}`);
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

function formatRunScriptCommand(cwd: string, runScriptPath: string): string {
  const displayPath = formatDisplayPath(cwd, runScriptPath);
  const runnablePath = displayPath.startsWith('/') || displayPath.startsWith('.')
    ? displayPath
    : `./${displayPath}`;

  return shellQuote(runnablePath);
}

function initNextCommand(
  command: 'sync' | 'test' | 'generate',
  configPath: string,
  moduleName: string | undefined,
  cwd: string,
): string {
  const defaultConfigPath = path.join(cwd, DEFAULT_CONFIG_PATH);
  const parts = ['npx', '--yes', 'openapi-k6', command];

  if (command === 'test' || command === 'generate') {
    parts.push('-s', 'smoke');
  }

  if (path.resolve(configPath) !== defaultConfigPath) {
    parts.push('--config', formatDisplayPath(cwd, configPath));
  }

  if (moduleName !== undefined && moduleName !== 'default') {
    parts.push('--module', moduleName);
  }

  return parts.map(shellQuote).join(' ');
}

function writeInitSummary(
  stdout: WritableLike,
  result: InitResult,
  options: InitOptions,
  cwd: string,
): void {
  const moduleName = options.module ?? 'default';

  writeLine(stdout, '');
  writeLine(stdout, `${initStatusSymbol(stdout, 'success')} Created ${formatDisplayPath(cwd, result.directoryPath)}`);
  writeLine(stdout, `  config    ${formatDisplayPath(cwd, result.configPath)}`);
  writeLine(stdout, `  scenario  ${formatDisplayPath(cwd, result.scenarioPath)}`);
  writeLine(stdout, `  runner    ${formatDisplayPath(cwd, result.runScriptPath)}`);
  writeLine(stdout, `  guide     ${formatDisplayPath(cwd, result.readmePath)}`);
  writeLine(stdout, '');
  writeLine(stdout, 'Next');
  writeLine(stdout, `  ${initNextCommand('sync', result.configPath, moduleName, cwd)}`);
  writeLine(stdout, `  ${initNextCommand('test', result.configPath, moduleName, cwd)}`);
  writeLine(stdout, `  ${initNextCommand('generate', result.configPath, moduleName, cwd)}`);
  writeLine(stdout, `  ${formatRunScriptCommand(cwd, result.runScriptPath)} smoke --log`);
}

function shouldUseColor(
  stream: WritableLike,
  env: Record<string, string | undefined>,
  colorOption: boolean | undefined,
): boolean {
  if (colorOption === false) {
    return false;
  }

  if (env.NO_COLOR !== undefined || env.TERM === 'dumb') {
    return false;
  }

  return stream.isTTY === true;
}

function shouldUseLiveOutput(
  stream: WritableLike,
  env: Record<string, string | undefined>,
): boolean {
  if (env.TERM === 'dumb') {
    return false;
  }

  return stream.isTTY === true;
}

export function createProgram(context: CliContext = {}): Command {
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const program = new Command();

  program
    .name('openapi-k6')
    .description('Generate k6 scripts from OpenAPI specs and Scenario DSL files.')
    .version('0.1.3')
    .exitOverride()
    .configureOutput({
      writeOut: (value) => stdout.write(value),
      writeErr: (value) => stderr.write(value),
    });

  program
    .command('init')
    .description('Create a load-tests scaffold in the target project.')
    .option('--dir <path>', 'Load test directory path', 'load-tests')
    .option('-m, --module <name>', 'Initial module name', 'default')
    .option('--base-url <url>', 'API base URL for generated k6 scripts')
    .option('--openapi <path-or-url>', 'OpenAPI spec file path or URL')
    .option('--smoke-path <path>', 'Smoke scenario GET endpoint path', '/health')
    .option('--force', 'Overwrite existing scaffold files')
    .option('--no-input', 'Do not prompt for missing init values')
    .action(async (options: InitOptions) => {
      const result = await runInitCommand(options, context);
      writeInitSummary(stdout, result, options, resolveCwd(context));
    });

  program
    .command('generate')
    .description('Generate a k6 script for the configured scenario.')
    .requiredOption('-s, --scenario <path-or-name>', 'Scenario DSL file path or load-tests scenario name')
    .option('-o, --openapi <path>', 'OpenAPI spec file path')
    .option('-w, --write <path>', 'Output k6 script path (defaults to load-tests/generated/<scenario>.k6.js)')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .action(async (options: GenerateOptions) => {
      const result = await runGenerateCommand(options, context);
      writeLine(stdout, `Generated ${result.outputPath}`);
    });

  program
    .command('sync')
    .description('Write an OpenAPI snapshot and endpoint catalog.')
    .option('-o, --openapi <path-or-url>', 'OpenAPI spec file path or URL')
    .option('-w, --write <path>', 'Output OpenAPI snapshot path')
    .option('-c, --catalog <path>', 'Output endpoint catalog path')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .action(async (options: SyncOptions) => {
      const result = await runSyncCommand(options, context);
      writeLine(stdout, `Synced ${result.snapshotPath}`);
      writeLine(stdout, `Catalog ${result.catalogPath} (${result.operationCount} operations)`);
    });

  program
    .command('test')
    .description('Run a scenario once with Node.js to validate API flow before generating k6.')
    .requiredOption('-s, --scenario <path-or-name>', 'Scenario DSL file path or load-tests scenario name')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--no-color', 'Disable ANSI color output')
    .action(async (options: TestOptions) => {
      const colorEnv = context.env ?? process.env;
      const testReporter = context.testReporter ?? createScenarioConsoleReporter(stdout, {
        color: shouldUseColor(stdout, colorEnv, options.color),
        live: shouldUseLiveOutput(stdout, colorEnv),
      });
      const result = await runTestCommand(options, {
        ...context,
        testReporter,
      });

      if (!result.passed) {
        throw new CommanderError(1, 'openapi-k6.test.failed', 'Scenario test failed');
      }
    });

  return program;
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  context: CliContext = {},
): Promise<void> {
  const program = createProgram(context);
  await program.parseAsync(argv, { from: 'user' });
}

async function main(): Promise<void> {
  try {
    await runCli();
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (fileURLToPath(import.meta.url) === entryPath) {
  void main();
}
