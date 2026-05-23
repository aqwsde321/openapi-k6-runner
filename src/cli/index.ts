#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { parse as parseDotEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { createWriteStream, realpathSync, type Dirent, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { isMap, Pair, parseDocument, Scalar, YAMLMap } from 'yaml';

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
  createModuleBaseUrlEnvName,
  findModuleBaseUrlEnvNameCollisions,
} from '../core/module-env.js';
import type { ApiCatalog, ApiCatalogOperation, ApiRegistry, Scenario } from '../core/types.js';
import {
  executeAstScenario,
  type ScenarioExecutionReporter,
  type ScenarioExecutionResult,
} from '../executor/scenario.executor.js';
import { syncOpenApiSnapshot } from '../openapi/openapi.catalog.js';
import { HTTP_METHOD_ORDER, parseOpenApiFile } from '../openapi/openapi.parser.js';
import { parseScenarioFile } from '../parser/scenario.parser.js';
import { initLoadTests, updateLoadTests } from '../scaffold/load-test.init.js';
import { validateScenarioAgainstOpenApi } from '../validator/scenario.validator.js';
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

export interface ValidateOptions {
  scenario: string;
  openapi?: string;
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

export interface RunOptions {
  scenario: string;
  write?: string;
  config?: string;
  module?: string;
  log?: boolean;
  trace?: boolean;
  report?: boolean;
  openDashboard?: boolean;
  k6Args?: string[];
}

export interface CatalogOptions {
  config?: string;
  module?: string;
  query?: string;
  method?: string;
  tag?: string;
  all?: boolean;
  json?: boolean;
}

export interface ModuleListOptions {
  config?: string;
  json?: boolean;
}

export interface ModuleAddOptions {
  name: string;
  openapi?: string;
  baseUrl?: string;
  snapshot?: string;
  catalog?: string;
  setDefault?: boolean;
  sync?: boolean;
  force?: boolean;
  config?: string;
}

export interface ModuleSetDefaultOptions {
  name: string;
  config?: string;
}

export interface ModuleRemoveOptions {
  name: string;
  config?: string;
  force?: boolean;
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

export interface UpdateOptions {
  config?: string;
  module?: string;
}

export interface GenerateResult {
  outputPath: string;
  scenarioPath: string;
  openapiPath: string;
  openapiPaths?: Record<string, string>;
  baseUrl: string;
  moduleName?: string;
  moduleNames?: string[];
}

export interface ValidateResult {
  scenarioPath: string;
  openapiPath: string;
  openapiPaths?: Record<string, string>;
  scenarioName: string;
  stepCount: number;
  warnings: string[];
  moduleName?: string;
  moduleNames?: string[];
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
  openapiPaths?: Record<string, string>;
  moduleName?: string;
  moduleNames?: string[];
}

export interface RunResult {
  outputPath: string;
  scenarioPath: string;
  openapiPath: string;
  openapiPaths?: Record<string, string>;
  moduleName?: string;
  moduleNames?: string[];
  logPath?: string;
  reportPath?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface CatalogResult {
  catalogPath: string;
  source: string;
  generatedAt: string;
  totalOperationCount: number;
  operations: ApiCatalogOperation[];
  tagCounts: Array<{ tag: string; count: number }>;
  warnings: string[];
  filters: CatalogFilters;
  moduleName?: string;
}

export interface ModuleListResult {
  configPath: string;
  defaultModule?: string;
  modules: ModuleListItem[];
}

export interface ModuleListItem {
  name: string;
  isDefault: boolean;
  openapi?: string;
  baseUrl?: string;
  snapshot?: string;
  catalog?: string;
}

export interface ModuleAddResult {
  configPath: string;
  moduleName: string;
  openapi: string;
  snapshot: string;
  catalog: string;
  baseUrl?: string;
  defaultModule?: string;
  synced?: {
    snapshotPath: string;
    catalogPath: string;
    operationCount: number;
  };
}

export interface ModuleSetDefaultResult {
  configPath: string;
  defaultModule: string;
}

export interface ModuleRemoveResult {
  configPath: string;
  moduleName: string;
  removedDefault: boolean;
  defaultModule?: string;
  references: ModuleScenarioReference[];
}

export interface InitResult {
  directoryPath: string;
  configPath: string;
  runScriptPath: string;
  scenarioPath: string;
  readmePath: string;
}

export interface UpdateResult {
  directoryPath: string;
  configPath: string;
  envExamplePath: string;
  gitignorePath: string;
  runScriptPath: string;
  readmePath: string;
}

interface CatalogFilters {
  query?: string;
  method?: string;
  tag?: string;
  all?: boolean;
}

interface CatalogCommandContext {
  cwd: string;
  config: LoadTestConfig | undefined;
  moduleName: string | undefined;
  openapi: string | undefined;
  options: CatalogOptions;
}

interface ScenarioOpenApiContext {
  registrySource: ApiRegistry | Map<string, ApiRegistry>;
  defaultModuleName?: string;
  openapiPath: string;
  openapiPaths?: Record<string, string>;
  baseUrl?: string;
  moduleBaseUrls?: Record<string, string>;
  moduleName?: string;
  moduleNames?: string[];
}

interface ScenarioModuleUse {
  moduleName: string;
  stepId: string;
  explicit: boolean;
}

interface ModuleScenarioReference {
  scenarioPath: string;
  stepId: string;
}

interface K6RunResult {
  logPath?: string;
  reportPath?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
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
    throw new Error(formatMissingConfigValueError(config.path, configFieldLabel, commandName));
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
    throw new Error(formatMissingConfigValueError(config.path, configFieldLabel, commandName));
  }

  throw new Error(message);
}

function isConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value.trim().toUpperCase() !== TODO_VALUE;
}

function formatMissingConfigValueError(
  configPath: string,
  configFieldLabel: string,
  commandName: string,
): string {
  return [
    `${configPath}: ${configFieldLabel} is not configured.`,
    '',
    'Edit:',
    `  ${configPath}`,
    '',
    'Set:',
    `  ${configFieldLabel}`,
    '',
    'After editing:',
    '  rerun the command',
  ].join('\n');
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
    : resolveScenarioName(scenario);

  return path.join(resolveLoadTestDir(cwd, config), 'generated', `${scenarioName}.k6.js`);
}

function resolveScenarioName(scenario: string): string {
  return path.basename(scenario, path.extname(scenario));
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

function normalizeModuleNameInput(value: string): string {
  const moduleName = value.trim();

  if (!/^[A-Za-z0-9_-]+$/.test(moduleName)) {
    throw new Error(
      `module must contain only letters, numbers, "_" or "-": ${JSON.stringify(value)}`,
    );
  }

  return moduleName;
}

function normalizeRequiredOptionValue(value: string | undefined, optionName: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${optionName} must not be empty`);
  }

  return normalized;
}

function normalizeOptionalOptionValue(value: string | undefined, optionName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeRequiredOptionValue(value, optionName);
}

function normalizeConfigPathReference(cwd: string, configDir: string, value: string): string {
  const trimmed = value.trim();

  if (!trimmed || isHttpUrl(trimmed) || path.isAbsolute(trimmed)) {
    return trimmed;
  }

  const relativePath = path.relative(configDir, path.resolve(cwd, trimmed));
  return normalizeCommandPath(relativePath || '.');
}

async function loadRequiredConfigForModuleCommand(
  cwd: string,
  configPath: string | undefined,
): Promise<LoadTestConfig> {
  const config = await loadOptionalConfig(cwd, configPath, true);

  if (config === undefined) {
    throw new Error(`${DEFAULT_CONFIG_PATH} was not found. Run openapi-k6 init or pass --config.`);
  }

  return config;
}

function resolveEffectiveDefaultModule(config: LoadTestConfig): string | undefined {
  if (config.defaultModule !== undefined) {
    return config.defaultModule;
  }

  if (config.modules.size === 1) {
    const [moduleName] = config.modules.keys();
    return moduleName;
  }

  return undefined;
}

async function writeModuleConfigEntry(
  config: LoadTestConfig,
  moduleName: string,
  moduleConfig: {
    openapi: string;
    baseUrl?: string;
    snapshot: string;
    catalog: string;
  },
  setDefault: boolean,
): Promise<void> {
  await updateConfigDocument(config.path, (_document, root) => {
    const modules = root.get('modules', true);

    if (!isMap(modules)) {
      throw new Error(`${config.path}: modules must be an object`);
    }

    const moduleNode = createModuleConfigNode(moduleConfig);

    if (modules.has(moduleName)) {
      modules.set(moduleName, moduleNode);
    } else {
      modules.add(new Pair(new Scalar(moduleName), moduleNode));
    }

    if (setDefault) {
      root.set('defaultModule', moduleName);
    }
  });
}

function createModuleConfigNode(moduleConfig: {
  openapi: string;
  baseUrl?: string;
  snapshot: string;
  catalog: string;
}): YAMLMap<Scalar<string>, Scalar<string>> {
  const moduleNode = new YAMLMap<Scalar<string>, Scalar<string>>();

  if (moduleConfig.baseUrl !== undefined) {
    moduleNode.add(createCommentedScalarPair(
      'baseUrl',
      moduleConfig.baseUrl,
      ' module 전용 API base URL입니다.\n 없으면 root baseUrl 또는 OpenAPI servers[0].url을 사용합니다.',
    ));
  }

  moduleNode.add(createCommentedScalarPair(
    'openapi',
    moduleConfig.openapi,
    ' sync가 읽을 OpenAPI URL 또는 파일 경로입니다.\n 예: https://api.example.com/v3/api-docs',
  ));
  moduleNode.add(createCommentedScalarPair(
    'snapshot',
    moduleConfig.snapshot,
    ' sync가 저장하고 generate가 읽을 OpenAPI snapshot 경로입니다.\n 상대 경로는 이 config.yaml 위치 기준입니다.',
  ));
  moduleNode.add(createCommentedScalarPair(
    'catalog',
    moduleConfig.catalog,
    ' scenario 작성자가 endpoint를 고를 때 참고할 catalog 경로입니다.\n generate 입력은 catalog가 아니라 snapshot입니다.',
  ));

  return moduleNode;
}

function createCommentedScalarPair(
  key: string,
  value: string,
  commentBefore: string,
): Pair<Scalar<string>, Scalar<string>> {
  const keyNode = new Scalar(key);

  keyNode.commentBefore = commentBefore;

  return new Pair(keyNode, new Scalar(value));
}

async function writeDefaultModuleConfig(config: LoadTestConfig, moduleName: string): Promise<void> {
  await updateConfigDocument(config.path, (_document, root) => {
    root.set('defaultModule', moduleName);
  });
}

async function removeModuleConfigEntry(
  config: LoadTestConfig,
  moduleName: string,
  defaultModule: string | undefined,
): Promise<void> {
  await updateConfigDocument(config.path, (_document, root) => {
    const modules = root.get('modules', true);

    if (!isMap(modules)) {
      throw new Error(`${config.path}: modules must be an object`);
    }

    modules.delete(moduleName);

    if (defaultModule === undefined) {
      root.delete('defaultModule');
    } else {
      root.set('defaultModule', defaultModule);
    }
  });
}

async function updateConfigDocument(
  configPath: string,
  update: (
    document: ReturnType<typeof parseDocument>,
    root: ReturnType<typeof parseConfigDocumentRoot>,
  ) => void,
): Promise<void> {
  const raw = await fs.readFile(configPath, 'utf8');
  const document = parseDocument(raw);
  const root = parseConfigDocumentRoot(configPath, document);

  update(document, root);

  await fs.writeFile(configPath, ensureTrailingNewline(document.toString({ lineWidth: 0 })), 'utf8');
}

function parseConfigDocumentRoot(
  configPath: string,
  document: ReturnType<typeof parseDocument>,
) {
  if (document.errors.length > 0) {
    const message = document.errors[0]?.message ?? 'unknown YAML parse error';
    throw new Error(`${configPath}: failed to parse config: ${message}`);
  }

  const root = document.contents;

  if (!isMap(root)) {
    throw new Error(`${configPath}: config must be an object`);
  }

  return root;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function resolveDefaultAfterModuleRemoval(
  config: LoadTestConfig,
  moduleName: string,
): string | undefined {
  if (config.defaultModule !== moduleName) {
    return config.defaultModule;
  }

  const remainingModules = [...config.modules.keys()].filter((name) => name !== moduleName);
  return remainingModules.length === 1 ? remainingModules[0] : undefined;
}

async function findScenarioModuleReferences(
  config: LoadTestConfig,
  moduleName: string,
): Promise<ModuleScenarioReference[]> {
  const scenarioDir = path.join(config.dir, 'scenarios');
  const scenarioFiles = await listScenarioFiles(scenarioDir);
  const references: ModuleScenarioReference[] = [];

  for (const scenarioPath of scenarioFiles) {
    const scenario = await parseScenarioFile(scenarioPath);

    for (const step of scenario.steps) {
      if (step.api.module === moduleName) {
        references.push({
          scenarioPath,
          stepId: step.id,
        });
      }
    }
  }

  return references;
}

async function listScenarioFiles(directoryPath: string): Promise<string[]> {
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
      files.push(...await listScenarioFiles(entryPath));
    } else if (entry.isFile() && isScenarioFile(entry.name)) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function isScenarioFile(fileName: string): boolean {
  return ['.yaml', '.yml', '.json'].includes(path.extname(fileName).toLowerCase());
}

function assertModuleOptionHasConfig(
  config: LoadTestConfig | undefined,
  moduleName: string | undefined,
): void {
  if (config === undefined && moduleName !== undefined) {
    throw new Error('--module requires --config');
  }
}

async function loadScenarioOpenApiContext(options: {
  cwd: string;
  config: LoadTestConfig | undefined;
  scenario: Scenario;
  cliOpenapi?: string;
  cliModuleName?: string;
  commandName: 'generate' | 'validate' | 'test' | 'run';
  requireBaseUrl: boolean;
  runtimeEnv?: Record<string, string | undefined>;
}): Promise<ScenarioOpenApiContext> {
  const explicitModuleUses = collectExplicitModuleUses(options.scenario);

  if (options.cliOpenapi !== undefined && explicitModuleUses.length > 0) {
    const firstUse = explicitModuleUses[0];
    throw new Error(
      `step "${firstUse.stepId}": api.module "${firstUse.moduleName}" cannot be used with --openapi; use --config modules.<name>.snapshot`,
    );
  }

  if (options.config === undefined) {
    if (options.cliModuleName !== undefined) {
      throw new Error('--module requires --config');
    }

    if (explicitModuleUses.length > 0) {
      const firstUse = explicitModuleUses[0];
      throw new Error(`step "${firstUse.stepId}": api.module "${firstUse.moduleName}" requires --config`);
    }

    const openapiPath = resolveConfiguredOpenApiInput(
      options.cwd,
      undefined,
      options.cliOpenapi,
      undefined,
      '--openapi is required unless --config provides modules.<name>.snapshot',
      'modules.<name>.snapshot',
      options.commandName,
    );
    const registry = await parseOpenApiFile(openapiPath);
    const baseUrl = options.requireBaseUrl
      ? await resolveStandaloneBaseUrl(options.cwd, registry)
      : undefined;

    return {
      registrySource: registry,
      openapiPath,
      ...(baseUrl === undefined ? {} : { baseUrl }),
    };
  }

  if (options.cliOpenapi !== undefined) {
    const moduleConfig = resolveConfigModule(options.config, options.cliModuleName);
    const openapiPath = resolveOpenApiInput(options.cwd, options.cliOpenapi);
    const registry = await parseOpenApiFile(openapiPath);
    const baseUrl = options.requireBaseUrl
      ? await resolveScenarioModuleBaseUrl({
          cwd: options.cwd,
          config: options.config,
          moduleConfig,
          registry,
          runtimeEnv: options.runtimeEnv,
        })
      : undefined;

    return {
      registrySource: registry,
      defaultModuleName: moduleConfig.name,
      openapiPath,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      moduleName: moduleConfig.name,
    };
  }

  const fallbackModule = resolveFallbackModuleForScenario(
    options.config,
    options.cliModuleName,
    options.scenario,
  );
  const moduleUses = collectRequiredModuleUses(options.scenario, fallbackModule?.name);
  const moduleNames = [...moduleUses.keys()];
  if (options.requireBaseUrl) {
    assertNoModuleBaseUrlEnvNameCollisions(moduleNames);
  }
  const registries = new Map<string, ApiRegistry>();
  const openapiPaths: Record<string, string> = {};
  const moduleBaseUrls: Record<string, string> = {};

  for (const moduleName of moduleNames) {
    const moduleUse = moduleUses.get(moduleName);
    const stepId = moduleUse?.stepId ?? '<unknown>';
    const moduleConfig = resolveScenarioModuleConfig(options.config, moduleName, stepId);
    const snapshotPath = resolveScenarioModuleSnapshotPath(
      options.config,
      moduleConfig,
      moduleUse,
      options.commandName,
    );
    const registry = await parseOpenApiFile(snapshotPath);

    registries.set(moduleName, registry);
    openapiPaths[moduleName] = snapshotPath;

    if (options.requireBaseUrl) {
      moduleBaseUrls[moduleName] = await resolveScenarioModuleBaseUrl({
        cwd: options.cwd,
        config: options.config,
        moduleConfig,
        registry,
        runtimeEnv: options.runtimeEnv,
      });
    }
  }

  const firstModuleName = moduleNames[0];
  const singleModuleName = moduleNames.length === 1 ? firstModuleName : undefined;

  return {
    registrySource: registries,
    ...(fallbackModule === undefined ? {} : { defaultModuleName: fallbackModule.name }),
    openapiPath: openapiPaths[firstModuleName] ?? '',
    ...(moduleNames.length <= 1 ? {} : { openapiPaths }),
    ...(options.requireBaseUrl ? { baseUrl: moduleBaseUrls[firstModuleName] } : {}),
    ...(options.requireBaseUrl && moduleNames.length > 1 ? { moduleBaseUrls } : {}),
    ...(singleModuleName === undefined ? { moduleNames } : { moduleName: singleModuleName }),
  };
}

function collectExplicitModuleUses(scenario: Scenario): ScenarioModuleUse[] {
  return scenario.steps.flatMap((step) =>
    step.api.module === undefined
      ? []
      : [{ moduleName: step.api.module, stepId: step.id, explicit: true }]);
}

function resolveFallbackModuleForScenario(
  config: LoadTestConfig,
  moduleName: string | undefined,
  scenario: Scenario,
): LoadTestModuleConfig | undefined {
  const hasUnqualifiedStep = scenario.steps.some((step) => step.api.module === undefined);

  if (hasUnqualifiedStep || moduleName !== undefined) {
    return resolveConfigModule(config, moduleName);
  }

  return undefined;
}

function collectRequiredModuleUses(
  scenario: Scenario,
  fallbackModuleName: string | undefined,
): Map<string, ScenarioModuleUse> {
  const uses = new Map<string, ScenarioModuleUse>();

  for (const step of scenario.steps) {
    const moduleName = step.api.module ?? fallbackModuleName;

    if (moduleName === undefined) {
      throw new Error(`step "${step.id}": api.module is required because no fallback module was selected`);
    }

    if (!uses.has(moduleName)) {
      uses.set(moduleName, {
        moduleName,
        stepId: step.id,
        explicit: step.api.module !== undefined,
      });
    } else if (step.api.module !== undefined) {
      uses.set(moduleName, {
        moduleName,
        stepId: step.id,
        explicit: true,
      });
    }
  }

  return uses;
}

function assertNoModuleBaseUrlEnvNameCollisions(moduleNames: string[]): void {
  const [collision] = findModuleBaseUrlEnvNameCollisions(moduleNames);

  if (collision !== undefined) {
    throw new Error(
      `module base URL env name collision: modules ${collision.moduleNames.map((name) => JSON.stringify(name)).join(', ')} all map to ${collision.envName}`,
    );
  }
}

function resolveScenarioModuleConfig(
  config: LoadTestConfig,
  moduleName: string,
  stepId: string,
): LoadTestModuleConfig {
  const moduleConfig = config.modules.get(moduleName);

  if (!moduleConfig) {
    const available = [...config.modules.keys()].join(', ');
    throw new Error(
      `${config.path}: step "${stepId}": api.module "${moduleName}" was not found. Available modules: ${available}`,
    );
  }

  return moduleConfig;
}

function resolveScenarioModuleSnapshotPath(
  config: LoadTestConfig,
  moduleConfig: LoadTestModuleConfig,
  moduleUse: ScenarioModuleUse | undefined,
  commandName: string,
): string {
  if (isConfiguredValue(moduleConfig.snapshot)) {
    return resolveConfigFilePath(config, moduleConfig.snapshot);
  }

  if (moduleUse?.explicit !== true) {
    throw new Error(formatMissingConfigValueError(
      config.path,
      `modules.${moduleConfig.name}.snapshot`,
      commandName,
    ));
  }

  throw new Error(formatMissingScenarioModuleSnapshotError(
    config.path,
    moduleConfig.name,
    moduleUse.stepId,
    commandName,
  ));
}

function formatMissingScenarioModuleSnapshotError(
  configPath: string,
  moduleName: string,
  stepId: string,
  commandName: string,
): string {
  const configFieldLabel = `modules.${moduleName}.snapshot`;

  return [
    `${configPath}: step "${stepId}": ${configFieldLabel} is not configured.`,
    '',
    'Edit:',
    `  ${configPath}`,
    '',
    'Set:',
    `  ${configFieldLabel}`,
    '',
    'After editing:',
    `  rerun openapi-k6 ${commandName}`,
  ].join('\n');
}

async function resolveStandaloneBaseUrl(cwd: string, registry: ApiRegistry): Promise<string> {
  const baseUrl =
    (await loadBaseUrl(cwd)) ??
    registry.defaultServerUrl;

  if (!baseUrl) {
    throw new Error('baseUrl is not configured and OpenAPI servers[0].url is missing.');
  }

  return baseUrl;
}

async function resolveScenarioModuleBaseUrl(options: {
  cwd: string;
  config: LoadTestConfig;
  moduleConfig: LoadTestModuleConfig;
  registry: ApiRegistry;
  runtimeEnv?: Record<string, string | undefined>;
}): Promise<string> {
  const baseUrl = options.runtimeEnv === undefined
    ? normalizeConfiguredValue(options.moduleConfig.baseUrl) ??
      normalizeConfiguredValue(options.config.baseUrl) ??
      (await loadBaseUrl(options.cwd)) ??
      options.registry.defaultServerUrl
    : normalizeConfiguredValue(options.runtimeEnv[createModuleBaseUrlEnvName(options.moduleConfig.name)]) ??
      normalizeConfiguredValue(options.runtimeEnv.BASE_URL) ??
      normalizeConfiguredValue(options.moduleConfig.baseUrl) ??
      normalizeConfiguredValue(options.config.baseUrl) ??
      options.registry.defaultServerUrl;

  if (!baseUrl) {
    throw new Error(
      `baseUrl is not configured for module "${options.moduleConfig.name}" and OpenAPI servers[0].url is missing.`,
    );
  }

  return baseUrl;
}

export async function runGenerateCommand(
  options: GenerateOptions,
  context: CliContext = {},
): Promise<GenerateResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, options.openapi === undefined);
  assertModuleOptionHasConfig(config, options.module);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const scenario = await parseScenarioFile(scenarioPath);
  const openApiContext = await loadScenarioOpenApiContext({
    cwd,
    config,
    scenario,
    cliOpenapi: options.openapi,
    cliModuleName: options.module,
    commandName: 'generate',
    requireBaseUrl: true,
  });

  const ast = buildAst(scenario, openApiContext.registrySource, {
    defaultModuleName: openApiContext.defaultModuleName,
  });
  const outputPath = resolveOutputPath(cwd, config, options.scenario, options.write);
  const script = generateK6Script(ast, {
    baseUrl: openApiContext.baseUrl,
    moduleBaseUrls: openApiContext.moduleBaseUrls,
    fileRootDir: resolveLoadTestDir(cwd, config),
    outputPath,
  });
  const result: GenerateResult = {
    outputPath,
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    baseUrl: openApiContext.baseUrl ?? '',
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
  };

  await fs.mkdir(path.dirname(result.outputPath), { recursive: true });
  await fs.writeFile(result.outputPath, script, 'utf8');

  return result;
}

export async function runRunCommand(
  options: RunOptions,
  context: CliContext = {},
): Promise<RunResult> {
  const cwd = resolveCwd(context);
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const config = await loadOptionalConfig(cwd, options.config, true);
  assertModuleOptionHasConfig(config, options.module);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const scenario = await parseScenarioFile(scenarioPath);
  const loadTestDir = resolveLoadTestDir(cwd, config);
  const loadTestEnv = await loadLoadTestEnv(loadTestDir);
  const runtimeEnv = {
    ...loadTestEnv,
    ...(context.env ?? process.env),
  };
  const openApiContext = await loadScenarioOpenApiContext({
    cwd,
    config,
    scenario,
    cliModuleName: options.module,
    commandName: 'run',
    requireBaseUrl: true,
    runtimeEnv,
  });
  const validation = validateScenarioAgainstOpenApi(
    scenario,
    openApiContext.registrySource,
    { defaultModuleName: openApiContext.defaultModuleName },
  );
  const ast = buildAst(scenario, openApiContext.registrySource, {
    defaultModuleName: openApiContext.defaultModuleName,
  });
  const outputPath = resolveOutputPath(cwd, config, options.scenario, options.write);
  const script = generateK6Script(ast, {
    baseUrl: openApiContext.baseUrl,
    moduleBaseUrls: openApiContext.moduleBaseUrls,
    fileRootDir: loadTestDir,
    outputPath,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, script, 'utf8');

  writeRunValidationWarnings(stdout, validation.warnings);
  writeLine(stdout, `Generated ${outputPath}`);

  const k6Result = await runK6Script({
    cwd,
    loadTestDir,
    scenarioName: isScenarioName(options.scenario) ? options.scenario : resolveScenarioName(options.scenario),
    scriptPath: outputPath,
    runtimeEnv,
    k6Args: options.k6Args ?? [],
    log: options.log === true,
    trace: options.trace === true,
    report: options.report === true,
    openDashboard: options.openDashboard === true,
    stdout,
    stderr,
  });

  return {
    outputPath,
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
    ...(k6Result.logPath === undefined ? {} : { logPath: k6Result.logPath }),
    ...(k6Result.reportPath === undefined ? {} : { reportPath: k6Result.reportPath }),
    exitCode: k6Result.exitCode,
    signal: k6Result.signal,
  };
}

export async function runValidateCommand(
  options: ValidateOptions,
  context: CliContext = {},
): Promise<ValidateResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, options.openapi === undefined);
  assertModuleOptionHasConfig(config, options.module);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const scenario = await parseScenarioFile(scenarioPath);
  const openApiContext = await loadScenarioOpenApiContext({
    cwd,
    config,
    scenario,
    cliOpenapi: options.openapi,
    cliModuleName: options.module,
    commandName: 'validate',
    requireBaseUrl: false,
  });
  const validation = validateScenarioAgainstOpenApi(
    scenario,
    openApiContext.registrySource,
    { defaultModuleName: openApiContext.defaultModuleName },
  );

  return {
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    scenarioName: validation.scenarioName,
    stepCount: validation.stepCount,
    warnings: validation.warnings,
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
  };
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

export async function runCatalogCommand(
  options: CatalogOptions,
  context: CliContext = {},
): Promise<CatalogResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, true);
  const moduleConfig = selectConfigModule(config, options.module);
  const moduleName = moduleConfig?.name ?? '<none>';
  const catalogPath = resolveConfiguredFilePath(
    cwd,
    config,
    undefined,
    moduleConfig?.catalog,
    'modules.<name>.catalog is required to search catalog',
    `modules.${moduleName}.catalog`,
    'catalog',
  );
  const catalog = await readCatalogFile(catalogPath, {
    cwd,
    config,
    moduleName: moduleConfig?.name,
    openapi: moduleConfig?.openapi,
    options,
  });
  const filters = normalizeCatalogFilters(options);
  const shouldList = shouldListCatalogOperations(filters);
  const operations = shouldList
    ? sortCatalogOperations(filterCatalogOperations(catalog.operations, filters))
    : [];

  return {
    catalogPath,
    source: catalog.source,
    generatedAt: catalog.generatedAt,
    totalOperationCount: catalog.operations.length,
    operations,
    tagCounts: countCatalogTags(catalog.operations),
    warnings: shouldList ? findDuplicateOperationWarnings(operations) : [],
    filters,
    ...(moduleConfig === undefined ? {} : { moduleName: moduleConfig.name }),
  };
}

export async function runModuleListCommand(
  options: ModuleListOptions,
  context: CliContext = {},
): Promise<ModuleListResult> {
  const cwd = resolveCwd(context);
  const config = await loadRequiredConfigForModuleCommand(cwd, options.config);
  const defaultModule = resolveEffectiveDefaultModule(config);

  return {
    configPath: config.path,
    ...(defaultModule === undefined ? {} : { defaultModule }),
    modules: [...config.modules.values()].map((moduleConfig) => ({
      name: moduleConfig.name,
      isDefault: moduleConfig.name === defaultModule,
      ...(moduleConfig.openapi === undefined ? {} : { openapi: moduleConfig.openapi }),
      ...(moduleConfig.baseUrl === undefined ? {} : { baseUrl: moduleConfig.baseUrl }),
      ...(moduleConfig.snapshot === undefined ? {} : { snapshot: moduleConfig.snapshot }),
      ...(moduleConfig.catalog === undefined ? {} : { catalog: moduleConfig.catalog }),
    })),
  };
}

async function resolveOpenApiForModuleAdd(options: {
  cwd: string;
  config: LoadTestConfig;
  moduleName: string;
  openapi: string | undefined;
  baseUrl: string | undefined;
  stdout: WritableLike;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const explicitOpenApi = normalizeOptionalOptionValue(options.openapi, '--openapi');

  if (explicitOpenApi !== undefined) {
    return normalizeConfigPathReference(options.cwd, options.config.dir, explicitOpenApi);
  }

  if (options.baseUrl === undefined) {
    throw new Error('--openapi is required unless --base-url is provided for OpenAPI auto-discovery.');
  }

  const baseUrl = normalizeBaseUrlInput(options.baseUrl);

  if (!isHttpUrl(baseUrl)) {
    throw new Error('--base-url must be an http(s) URL to discover OpenAPI. Pass --openapi for file paths.');
  }

  const result = await resolveOpenApiForInit(
    options.cwd,
    buildDefaultOpenApiUrl(baseUrl),
    baseUrl,
    options.stdout,
    options.fetchImpl,
  );

  if (!result.ok) {
    throw new Error([
      `OpenAPI auto-discovery failed for module "${options.moduleName}": ${result.message}`,
      '',
      'Pass --openapi <path-or-url> explicitly or check --base-url.',
    ].join('\n'));
  }

  return normalizeConfigPathReference(options.cwd, options.config.dir, result.openapi);
}

export async function runModuleAddCommand(
  options: ModuleAddOptions,
  context: CliContext = {},
): Promise<ModuleAddResult> {
  const cwd = resolveCwd(context);
  const stdout = context.stdout ?? process.stdout;
  const config = await loadRequiredConfigForModuleCommand(cwd, options.config);
  const moduleName = normalizeModuleNameInput(options.name);

  if (config.modules.has(moduleName) && options.force !== true) {
    throw new Error(`${config.path}: module "${moduleName}" already exists. Use --force to update it.`);
  }

  const baseUrl = normalizeOptionalOptionValue(options.baseUrl, '--base-url');
  const openapi = await resolveOpenApiForModuleAdd({
    cwd,
    config,
    moduleName,
    openapi: options.openapi,
    baseUrl,
    stdout,
    fetchImpl: context.fetch ?? fetch,
  });
  const snapshot = normalizeOptionalOptionValue(options.snapshot, '--snapshot') ??
    `openapi/${moduleName}.openapi.json`;
  const catalog = normalizeOptionalOptionValue(options.catalog, '--catalog') ??
    `openapi/${moduleName}.catalog.json`;
  let synced: ModuleAddResult['synced'];

  if (options.sync === true) {
    const syncResult = await syncOpenApiSnapshot({
      openapi: resolveConfigFilePath(config, openapi),
      write: resolveConfigFilePath(config, snapshot),
      catalog: resolveConfigFilePath(config, catalog),
    });

    synced = {
      snapshotPath: syncResult.snapshotPath,
      catalogPath: syncResult.catalogPath,
      operationCount: syncResult.operationCount,
    };
  }

  await writeModuleConfigEntry(
    config,
    moduleName,
    {
      openapi,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      snapshot,
      catalog,
    },
    options.setDefault === true,
  );

  const defaultModule = options.setDefault === true
    ? moduleName
    : resolveEffectiveDefaultModule(config);

  return {
    configPath: config.path,
    moduleName,
    openapi,
    snapshot,
    catalog,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(defaultModule === undefined ? {} : { defaultModule }),
    ...(synced === undefined ? {} : { synced }),
  };
}

export async function runModuleSetDefaultCommand(
  options: ModuleSetDefaultOptions,
  context: CliContext = {},
): Promise<ModuleSetDefaultResult> {
  const cwd = resolveCwd(context);
  const config = await loadRequiredConfigForModuleCommand(cwd, options.config);
  const moduleName = normalizeModuleNameInput(options.name);

  if (!config.modules.has(moduleName)) {
    const available = [...config.modules.keys()].join(', ');
    throw new Error(`${config.path}: module "${moduleName}" was not found. Available modules: ${available}`);
  }

  await writeDefaultModuleConfig(config, moduleName);

  return {
    configPath: config.path,
    defaultModule: moduleName,
  };
}

export async function runModuleRemoveCommand(
  options: ModuleRemoveOptions,
  context: CliContext = {},
): Promise<ModuleRemoveResult> {
  const cwd = resolveCwd(context);
  const config = await loadRequiredConfigForModuleCommand(cwd, options.config);
  const moduleName = normalizeModuleNameInput(options.name);

  if (!config.modules.has(moduleName)) {
    const available = [...config.modules.keys()].join(', ');
    throw new Error(`${config.path}: module "${moduleName}" was not found. Available modules: ${available}`);
  }

  if (config.modules.size === 1) {
    throw new Error(`${config.path}: cannot remove the last module "${moduleName}".`);
  }

  const removedDefault = config.defaultModule === moduleName;

  if (removedDefault && options.force !== true) {
    throw new Error(`${config.path}: module "${moduleName}" is defaultModule. Use --force to remove it.`);
  }

  const references = await findScenarioModuleReferences(config, moduleName);

  if (references.length > 0 && options.force !== true) {
    throw new Error(formatModuleScenarioReferenceError(cwd, moduleName, references));
  }

  const defaultModule = resolveDefaultAfterModuleRemoval(config, moduleName);
  await removeModuleConfigEntry(config, moduleName, defaultModule);

  return {
    configPath: config.path,
    moduleName,
    removedDefault,
    ...(defaultModule === undefined ? {} : { defaultModule }),
    references,
  };
}

export async function runTestCommand(
  options: TestOptions,
  context: CliContext = {},
): Promise<TestResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, true);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const scenario = await parseScenarioFile(scenarioPath);
  const loadTestDir = resolveLoadTestDir(cwd, config);
  const loadTestEnv = await loadLoadTestEnv(loadTestDir);
  const runtimeEnv = {
    ...loadTestEnv,
    ...(context.env ?? process.env),
  };
  const openApiContext = await loadScenarioOpenApiContext({
    cwd,
    config,
    scenario,
    cliModuleName: options.module,
    commandName: 'test',
    requireBaseUrl: true,
    runtimeEnv,
  });

  const ast = buildAst(scenario, openApiContext.registrySource, {
    defaultModuleName: openApiContext.defaultModuleName,
  });
  const result = await executeAstScenario(ast, {
    baseUrl: openApiContext.baseUrl ?? '',
    moduleBaseUrls: openApiContext.moduleBaseUrls,
    fileRootDir: loadTestDir,
    env: runtimeEnv,
    fetch: context.fetch,
    reporter: context.testReporter,
  });

  return {
    ...result,
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
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

export async function runUpdateCommand(
  options: UpdateOptions,
  context: CliContext = {},
): Promise<UpdateResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, true);
  const moduleConfig = selectConfigModule(config, options.module);

  if (config === undefined) {
    throw new Error(`${DEFAULT_CONFIG_PATH} was not found. Run openapi-k6 init or pass --config.`);
  }

  return updateLoadTests({
    cwd,
    directory: path.relative(cwd, config.dir) || '.',
    module: moduleConfig?.name,
    includeModuleOption: options.module !== undefined,
    snapshot: moduleConfig?.snapshot,
    catalog: moduleConfig?.catalog,
  });
}

function writeRunValidationWarnings(stdout: WritableLike, warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  writeLine(stdout, 'Warnings:');

  for (const warning of warnings) {
    writeLine(stdout, `  - ${warning}`);
  }

  writeLine(stdout, '');
}

async function runK6Script(options: {
  cwd: string;
  loadTestDir: string;
  scenarioName: string;
  scriptPath: string;
  runtimeEnv: Record<string, string | undefined>;
  k6Args: string[];
  log: boolean;
  trace: boolean;
  report: boolean;
  openDashboard: boolean;
  stdout: WritableLike;
  stderr: WritableLike;
}): Promise<K6RunResult> {
  const env = toProcessEnv(options.runtimeEnv);
  const logsDir = path.join(options.loadTestDir, 'logs');
  const logPath = options.log ? path.join(logsDir, `${options.scenarioName}.log`) : undefined;
  let reportPath: string | undefined;

  if (options.trace) {
    env.OPENAPI_K6_TRACE = '1';
  }

  if (options.report) {
    env.K6_WEB_DASHBOARD = 'true';
    env.K6_WEB_DASHBOARD_PERIOD = env.K6_WEB_DASHBOARD_PERIOD ?? '1s';
    env.K6_WEB_DASHBOARD_EXPORT = env.K6_WEB_DASHBOARD_EXPORT ??
      path.join(logsDir, `${options.scenarioName}-report.html`);
    reportPath = env.K6_WEB_DASHBOARD_EXPORT;
    await fs.mkdir(resolveChildOutputDir(options.cwd, reportPath), { recursive: true });
    writeLine(options.stdout, `Writing k6 HTML report to ${reportPath}`);
  }

  if (options.openDashboard) {
    env.K6_WEB_DASHBOARD = 'true';
    env.K6_WEB_DASHBOARD_OPEN = 'true';
  }

  if (logPath !== undefined) {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    writeLine(options.stdout, `Writing k6 output to ${logPath}`);
  }

  const result = await spawnK6({
    cwd: options.cwd,
    env,
    args: ['run', ...options.k6Args, options.scriptPath],
    logPath,
    stdout: options.stdout,
    stderr: options.stderr,
  });

  return {
    ...(logPath === undefined ? {} : { logPath }),
    ...(reportPath === undefined ? {} : { reportPath }),
    exitCode: result.exitCode,
    signal: result.signal,
  };
}

function toProcessEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

function resolveChildOutputDir(cwd: string, filePath: string): string {
  const directory = path.dirname(filePath);
  return path.isAbsolute(directory) ? directory : path.resolve(cwd, directory);
}

async function spawnK6(options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  args: string[];
  logPath?: string;
  stdout: WritableLike;
  stderr: WritableLike;
}): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise((resolve, reject) => {
    const logStream = options.logPath === undefined ? undefined : createWriteStream(options.logPath);
    const child = spawn('k6', options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      void closeLogStream(logStream).finally(() => reject(formatK6SpawnError(error)));
    };

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      options.stdout.write(text);
      logStream?.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      options.stderr.write(text);
      logStream?.write(chunk);
    });
    child.on('error', rejectOnce);
    logStream?.on('error', rejectOnce);
    child.on('close', (exitCode, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      void closeLogStream(logStream)
        .then(() => resolve({ exitCode, signal }))
        .catch(reject);
    });
  });
}

async function closeLogStream(stream: WriteStream | undefined): Promise<void> {
  if (stream === undefined || stream.closed || stream.destroyed) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject);
    stream.end(() => resolve());
  });
}

function formatK6SpawnError(error: unknown): Error {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  ) {
    return new Error('k6 executable was not found. Install k6 and make sure it is available on PATH.');
  }

  return error instanceof Error ? error : new Error(String(error));
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
  command: 'sync' | 'validate' | 'test' | 'generate',
  configPath: string,
  moduleName: string | undefined,
  cwd: string,
): string {
  const defaultConfigPath = path.join(cwd, DEFAULT_CONFIG_PATH);
  const parts = ['npx', '--yes', 'openapi-k6', command];

  if (command === 'validate' || command === 'test' || command === 'generate') {
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
  writeLine(stdout, `  ${initNextCommand('validate', result.configPath, moduleName, cwd)}`);
  writeLine(stdout, `  ${initNextCommand('test', result.configPath, moduleName, cwd)}`);
  writeLine(stdout, `  ${initNextCommand('generate', result.configPath, moduleName, cwd)}`);
  writeLine(stdout, `  ${formatRunScriptCommand(cwd, result.runScriptPath)} smoke --log`);
}

function writeUpdateSummary(
  stdout: WritableLike,
  result: UpdateResult,
  cwd: string,
): void {
  writeLine(stdout, `${initStatusSymbol(stdout, 'success')} Updated load-tests scaffold metadata in ${formatDisplayPath(cwd, result.directoryPath)}`);
  writeLine(stdout, `  kept config  ${formatDisplayPath(cwd, result.configPath)}`);
  writeLine(stdout, `  guide        ${formatDisplayPath(cwd, result.readmePath)}`);
  writeLine(stdout, `  runner       ${formatDisplayPath(cwd, result.runScriptPath)}`);
  writeLine(stdout, `  env example  ${formatDisplayPath(cwd, result.envExamplePath)}`);
  writeLine(stdout, `  gitignore    ${formatDisplayPath(cwd, result.gitignorePath)}`);
  writeLine(stdout, '  kept scenarios, snapshots, generated scripts, logs, and .env unchanged');
}

function writeValidateSummary(stdout: WritableLike, result: ValidateResult, cwd: string): void {
  writeLine(stdout, `Validated ${formatDisplayPath(cwd, result.scenarioPath)}`);

  if (result.openapiPaths !== undefined) {
    writeLine(stdout, '  openapi');

    for (const [moduleName, openapiPath] of Object.entries(result.openapiPaths)) {
      writeLine(stdout, `    ${moduleName}  ${formatDisplayPath(cwd, openapiPath)}`);
    }
  } else {
    writeLine(stdout, `  openapi  ${formatDisplayPath(cwd, result.openapiPath)}`);
  }

  if (result.moduleName !== undefined) {
    writeLine(stdout, `  module   ${result.moduleName}`);
  } else if (result.moduleNames !== undefined) {
    writeLine(stdout, `  modules  ${result.moduleNames.join(', ')}`);
  }

  writeLine(stdout, `  scenario ${result.scenarioName}`);
  writeLine(stdout, `  steps    ${result.stepCount}`);

  if (result.warnings.length > 0) {
    writeLine(stdout, '');
    writeLine(stdout, 'Warnings:');

    for (const warning of result.warnings) {
      writeLine(stdout, `  - ${warning}`);
    }
  }
}

async function readCatalogFile(
  catalogPath: string,
  context: CatalogCommandContext,
): Promise<ApiCatalog> {
  let raw: string;

  try {
    raw = await fs.readFile(catalogPath, 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      throw new Error(formatMissingCatalogFileError(catalogPath, context));
    }

    throw error;
  }

  try {
    return parseCatalog(JSON.parse(raw), catalogPath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${catalogPath}: failed to parse catalog JSON: ${error.message}`);
    }

    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}

function formatMissingCatalogFileError(
  catalogPath: string,
  context: CatalogCommandContext,
): string {
  const openApiSetupLines = formatCatalogOpenApiSetupLines(context);

  return [
    `${catalogPath} was not found.`,
    '',
    ...openApiSetupLines,
    openApiSetupLines.length > 0 ? 'Then run:' : 'Run this first:',
    `  ${formatCatalogSyncCommand(context)}`,
    '',
    'Then retry:',
    `  ${formatCatalogRetryCommand(context)}`,
  ].join('\n');
}

function formatCatalogOpenApiSetupLines(context: CatalogCommandContext): string[] {
  if (isConfiguredValue(context.openapi)) {
    return [];
  }

  const configPath = context.config?.path ?? path.join(context.cwd, DEFAULT_CONFIG_PATH);
  const moduleName = context.moduleName ?? '<name>';

  return [
    'Configure OpenAPI source first:',
    `  ${configPath}`,
    '',
    'Set:',
    `  modules.${moduleName}.openapi`,
    '',
  ];
}

function formatCatalogSyncCommand(context: CatalogCommandContext): string {
  return formatCatalogCommand('sync', context, {});
}

function formatCatalogRetryCommand(context: CatalogCommandContext): string {
  return formatCatalogCommand('catalog', context, {
    query: context.options.query,
    method: context.options.method,
    tag: context.options.tag,
    all: context.options.all,
    json: context.options.json,
  });
}

function formatCatalogCommand(
  command: 'sync' | 'catalog',
  context: CatalogCommandContext,
  filters: {
    query?: string;
    method?: string;
    tag?: string;
    all?: boolean;
    json?: boolean;
  },
): string {
  const defaultConfigPath = path.join(context.cwd, DEFAULT_CONFIG_PATH);
  const parts = ['npx', '--yes', 'openapi-k6', command];

  if (context.config !== undefined && path.resolve(context.config.path) !== defaultConfigPath) {
    parts.push('--config', formatDisplayPath(context.cwd, context.config.path));
  }

  if (context.moduleName !== undefined && (context.options.module !== undefined || context.moduleName !== 'default')) {
    parts.push('--module', context.moduleName);
  }

  if (filters.query !== undefined) {
    parts.push('--query', filters.query);
  }

  if (filters.method !== undefined) {
    parts.push('--method', filters.method);
  }

  if (filters.tag !== undefined) {
    parts.push('--tag', filters.tag);
  }

  if (filters.all === true) {
    parts.push('--all');
  }

  if (filters.json === true) {
    parts.push('--json');
  }

  return parts.map(shellQuote).join(' ');
}

function parseCatalog(value: unknown, catalogPath: string): ApiCatalog {
  const catalog = expectCatalogRecord(value, `${catalogPath}: catalog must be an object`);
  const generatedAt = expectCatalogString(catalog.generatedAt, `${catalogPath}: generatedAt must be a string`);
  const source = expectCatalogString(catalog.source, `${catalogPath}: source must be a string`);

  if (!Array.isArray(catalog.operations)) {
    throw new Error(`${catalogPath}: operations must be an array`);
  }

  return {
    generatedAt,
    source,
    operations: catalog.operations.map((operation, index) =>
      parseCatalogOperation(operation, `${catalogPath}: operations[${index}]`)),
  };
}

function parseCatalogOperation(value: unknown, label: string): ApiCatalogOperation {
  const operation = expectCatalogRecord(value, `${label} must be an object`);
  const method = expectCatalogString(operation.method, `${label}.method must be a string`);
  const endpointPath = expectCatalogString(operation.path, `${label}.path must be a string`);
  const tags = Array.isArray(operation.tags)
    ? operation.tags.flatMap((tag) => typeof tag === 'string' ? [tag] : [])
    : [];

  return {
    method: method.toUpperCase(),
    path: endpointPath,
    tags,
    parameters: Array.isArray(operation.parameters) ? operation.parameters : [],
    hasRequestBody: operation.hasRequestBody === true,
    ...(typeof operation.operationId === 'string' ? { operationId: operation.operationId } : {}),
    ...(typeof operation.summary === 'string' ? { summary: operation.summary } : {}),
    ...(typeof operation.description === 'string' ? { description: operation.description } : {}),
    ...(Array.isArray(operation.requestBodyContentTypes)
      ? {
          requestBodyContentTypes: operation.requestBodyContentTypes.flatMap((contentType) =>
            typeof contentType === 'string' ? [contentType] : []),
        }
      : {}),
  };
}

function expectCatalogRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function expectCatalogString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }

  return value;
}

function normalizeCatalogFilters(options: CatalogOptions): CatalogFilters {
  const query = normalizeCatalogTextFilter(options.query);
  const method = normalizeCatalogMethodFilter(options.method);
  const tag = normalizeCatalogTextFilter(options.tag);

  return {
    ...(query === undefined ? {} : { query }),
    ...(method === undefined ? {} : { method }),
    ...(tag === undefined ? {} : { tag }),
    ...(options.all === true ? { all: true } : {}),
  };
}

function normalizeCatalogTextFilter(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeCatalogMethodFilter(value: string | undefined): string | undefined {
  const method = normalizeCatalogTextFilter(value)?.toUpperCase();

  if (method === undefined) {
    return undefined;
  }

  const supportedMethods = new Set(HTTP_METHOD_ORDER.map((item) => item.toUpperCase()));

  if (!supportedMethods.has(method)) {
    throw new Error(`--method must be one of ${[...supportedMethods].join(', ')}`);
  }

  return method;
}

function shouldListCatalogOperations(filters: CatalogFilters): boolean {
  return filters.all === true ||
    filters.query !== undefined ||
    filters.method !== undefined ||
    filters.tag !== undefined;
}

function filterCatalogOperations(
  operations: ApiCatalogOperation[],
  filters: CatalogFilters,
): ApiCatalogOperation[] {
  return operations.filter((operation) => {
    if (filters.method !== undefined && operation.method.toUpperCase() !== filters.method) {
      return false;
    }

    if (
      filters.tag !== undefined &&
      !operation.tags.some((tag) => tag.toLowerCase() === filters.tag?.toLowerCase())
    ) {
      return false;
    }

    if (filters.query !== undefined && !matchesCatalogQuery(operation, filters.query)) {
      return false;
    }

    return true;
  });
}

function matchesCatalogQuery(operation: ApiCatalogOperation, query: string): boolean {
  const normalizedQuery = query.toLowerCase();

  return catalogSearchValues(operation).some((value) =>
    value.toLowerCase().includes(normalizedQuery));
}

function catalogSearchValues(operation: ApiCatalogOperation): string[] {
  return [
    operation.method,
    operation.path,
    operation.operationId,
    ...operation.tags,
    operation.summary,
    operation.description,
    ...(operation.requestBodyContentTypes ?? []),
    ...readCatalogParameterLabels(operation.parameters),
  ].flatMap((value) => value === undefined ? [] : [value]);
}

function readCatalogParameterLabels(parameters: unknown[]): string[] {
  return parameters.flatMap((parameter) => {
    if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) {
      return [];
    }

    const record = parameter as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : undefined;
    const location = typeof record.in === 'string' ? record.in : undefined;

    if (name === undefined && location === undefined) {
      return [];
    }

    return [`${location ?? 'param'} ${name ?? '<unnamed>'}`];
  });
}

function sortCatalogOperations(operations: ApiCatalogOperation[]): ApiCatalogOperation[] {
  return [...operations].sort((left, right) =>
    compareCatalogMethod(left.method, right.method) ||
    left.path.localeCompare(right.path) ||
    (left.operationId ?? '').localeCompare(right.operationId ?? ''));
}

function compareCatalogMethod(left: string, right: string): number {
  const methodOrder = new Map(HTTP_METHOD_ORDER.map((method, index) => [method.toUpperCase(), index]));
  const leftIndex = methodOrder.get(left.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = methodOrder.get(right.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;

  return leftIndex - rightIndex;
}

function countCatalogTags(operations: ApiCatalogOperation[]): Array<{ tag: string; count: number }> {
  const tagCounts = new Map<string, number>();

  for (const operation of operations) {
    for (const tag of operation.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
}

function findDuplicateOperationWarnings(operations: ApiCatalogOperation[]): string[] {
  const counts = new Map<string, number>();

  for (const operation of operations) {
    const key = `${operation.method.toUpperCase()} ${operation.path}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => `duplicate operation key: ${key} (${count} entries)`);
}

function writeCatalogOutput(
  stdout: WritableLike,
  result: CatalogResult,
  cwd: string,
  json: boolean | undefined,
): void {
  if (json === true) {
    writeLine(stdout, JSON.stringify(formatCatalogJson(result), null, 2));
    return;
  }

  if (shouldListCatalogOperations(result.filters)) {
    writeCatalogOperations(stdout, result, cwd);
    return;
  }

  writeCatalogSummary(stdout, result, cwd);
}

function formatCatalogJson(result: CatalogResult): Record<string, unknown> {
  return {
    catalogPath: result.catalogPath,
    ...(result.moduleName === undefined ? {} : { moduleName: result.moduleName }),
    source: result.source,
    generatedAt: result.generatedAt,
    totalOperationCount: result.totalOperationCount,
    operationCount: result.operations.length,
    filters: result.filters,
    tagCounts: result.tagCounts,
    warnings: result.warnings,
    operations: result.operations,
  };
}

function writeCatalogSummary(stdout: WritableLike, result: CatalogResult, cwd: string): void {
  writeLine(stdout, `Catalog: ${formatDisplayPath(cwd, result.catalogPath)}`);

  if (result.moduleName !== undefined) {
    writeLine(stdout, `Module: ${result.moduleName}`);
  }

  writeLine(stdout, `Operations: ${result.totalOperationCount}`);
  writeLine(stdout, '');
  writeLine(stdout, 'Tags:');

  if (result.tagCounts.length === 0) {
    writeLine(stdout, '  (none)');
  } else {
    const width = Math.max(...result.tagCounts.map(({ tag }) => tag.length));

    for (const { tag, count } of result.tagCounts) {
      writeLine(stdout, `  ${tag.padEnd(width)}  ${count}`);
    }
  }

  writeLine(stdout, '');
  writeLine(stdout, 'Use filters:');
  writeLine(stdout, '  openapi-k6 catalog --query login');
  writeLine(stdout, '  openapi-k6 catalog --tag auth');
  writeLine(stdout, '  openapi-k6 catalog --method POST');
  writeLine(stdout, '  openapi-k6 catalog --all');
}

function writeModuleListOutput(
  stdout: WritableLike,
  result: ModuleListResult,
  cwd: string,
  json: boolean | undefined,
): void {
  if (json === true) {
    writeLine(stdout, JSON.stringify(formatModuleListJson(result), null, 2));
    return;
  }

  writeLine(stdout, `Config: ${formatDisplayPath(cwd, result.configPath)}`);
  writeLine(stdout, `Default: ${result.defaultModule ?? '(none)'}`);
  writeLine(stdout, '');
  writeLine(stdout, 'Modules:');

  for (const moduleConfig of result.modules) {
    writeLine(stdout, `  ${moduleConfig.isDefault ? '*' : '-'} ${moduleConfig.name}`);

    if (moduleConfig.baseUrl !== undefined) {
      writeLine(stdout, `      baseUrl   ${moduleConfig.baseUrl}`);
    }

    if (moduleConfig.openapi !== undefined) {
      writeLine(stdout, `      openapi   ${moduleConfig.openapi}`);
    }

    if (moduleConfig.snapshot !== undefined) {
      writeLine(stdout, `      snapshot  ${moduleConfig.snapshot}`);
    }

    if (moduleConfig.catalog !== undefined) {
      writeLine(stdout, `      catalog   ${moduleConfig.catalog}`);
    }
  }
}

function formatModuleListJson(result: ModuleListResult): Record<string, unknown> {
  return {
    configPath: result.configPath,
    ...(result.defaultModule === undefined ? {} : { defaultModule: result.defaultModule }),
    modules: result.modules,
  };
}

function writeModuleAddSummary(stdout: WritableLike, result: ModuleAddResult, cwd: string): void {
  writeLine(stdout, `Module ${result.moduleName} saved in ${formatDisplayPath(cwd, result.configPath)}`);
  writeLine(stdout, `  openapi   ${result.openapi}`);

  if (result.baseUrl !== undefined) {
    writeLine(stdout, `  baseUrl   ${result.baseUrl}`);
  }

  writeLine(stdout, `  snapshot  ${result.snapshot}`);
  writeLine(stdout, `  catalog   ${result.catalog}`);

  if (result.defaultModule === result.moduleName) {
    writeLine(stdout, '  default   yes');
  }

  if (result.synced !== undefined) {
    writeLine(stdout, '');
    writeLine(stdout, `Synced ${formatDisplayPath(cwd, result.synced.snapshotPath)}`);
    writeLine(stdout, `Catalog ${formatDisplayPath(cwd, result.synced.catalogPath)} (${result.synced.operationCount} operations)`);
  }

  writeModuleAddNextSteps(stdout, result, cwd);
}

function writeModuleAddNextSteps(stdout: WritableLike, result: ModuleAddResult, cwd: string): void {
  writeLine(stdout, '');
  writeLine(stdout, 'Next');

  if (result.synced === undefined) {
    writeLine(stdout, `  ${formatModuleCommand('sync', result.configPath, result.moduleName, cwd)}`);
  }

  writeLine(stdout, `  ${formatModuleCommand('catalog', result.configPath, result.moduleName, cwd, ['--all'])}`);
  writeLine(stdout, `  ${formatModuleListCommand(result.configPath, cwd)}`);
  writeLine(stdout, `  add api.module: ${result.moduleName} to scenario steps that use this module`);
}

function writeModuleSetDefaultSummary(
  stdout: WritableLike,
  result: ModuleSetDefaultResult,
  cwd: string,
): void {
  writeLine(stdout, `Default module set to ${result.defaultModule} in ${formatDisplayPath(cwd, result.configPath)}`);
}

function writeModuleRemoveSummary(stdout: WritableLike, result: ModuleRemoveResult, cwd: string): void {
  writeLine(stdout, `Module ${result.moduleName} removed from ${formatDisplayPath(cwd, result.configPath)}`);

  if (result.removedDefault) {
    writeLine(stdout, `  default   ${result.defaultModule ?? '(none)'}`);
  }

  if (result.references.length > 0) {
    writeLine(stdout, '');
    writeLine(stdout, 'Forced removal; scenario references still exist:');

    for (const reference of result.references) {
      writeLine(stdout, `  ${formatDisplayPath(cwd, reference.scenarioPath)} step "${reference.stepId}"`);
    }
  }
}

function formatModuleScenarioReferenceError(
  cwd: string,
  moduleName: string,
  references: ModuleScenarioReference[],
): string {
  return [
    `module "${moduleName}" is referenced by scenarios.`,
    '',
    ...references.map((reference) =>
      `  ${formatDisplayPath(cwd, reference.scenarioPath)} step "${reference.stepId}"`),
    '',
    'Use --force to remove the config entry anyway.',
  ].join('\n');
}

function formatModuleCommand(
  command: 'sync' | 'catalog',
  configPath: string,
  moduleName: string,
  cwd: string,
  extraArgs: string[] = [],
): string {
  const defaultConfigPath = path.join(cwd, DEFAULT_CONFIG_PATH);
  const parts = ['npx', '--yes', 'openapi-k6', command];

  if (path.resolve(configPath) !== defaultConfigPath) {
    parts.push('--config', formatDisplayPath(cwd, configPath));
  }

  parts.push('--module', moduleName);
  parts.push(...extraArgs);

  return parts.map(shellQuote).join(' ');
}

function formatModuleListCommand(configPath: string, cwd: string): string {
  const defaultConfigPath = path.join(cwd, DEFAULT_CONFIG_PATH);
  const parts = ['npx', '--yes', 'openapi-k6', 'module', 'list'];

  if (path.resolve(configPath) !== defaultConfigPath) {
    parts.push('--config', formatDisplayPath(cwd, configPath));
  }

  return parts.map(shellQuote).join(' ');
}

function writeCatalogOperations(stdout: WritableLike, result: CatalogResult, cwd: string): void {
  writeLine(stdout, `Catalog: ${formatDisplayPath(cwd, result.catalogPath)}`);

  if (result.moduleName !== undefined) {
    writeLine(stdout, `Module: ${result.moduleName}`);
  }

  if (result.filters.query !== undefined) {
    writeLine(stdout, `Query: ${result.filters.query}`);
  }

  if (result.filters.method !== undefined) {
    writeLine(stdout, `Method: ${result.filters.method}`);
  }

  if (result.filters.tag !== undefined) {
    writeLine(stdout, `Tag: ${result.filters.tag}`);
  }

  writeLine(stdout, `Operations: ${result.operations.length}`);

  if (result.warnings.length > 0) {
    writeLine(stdout, '');
    writeLine(stdout, 'Warnings:');

    for (const warning of result.warnings) {
      writeLine(stdout, `  ${warning}`);
    }
  }

  if (result.operations.length === 0) {
    writeLine(stdout, '');
    writeLine(stdout, 'No operations matched.');
    return;
  }

  for (const operation of result.operations) {
    writeLine(stdout, '');
    writeLine(stdout, `${operation.method.padEnd(6)} ${operation.path}`);
    writeCatalogOperationDetail(stdout, operation);
  }
}

function writeCatalogOperationDetail(stdout: WritableLike, operation: ApiCatalogOperation): void {
  if (operation.operationId !== undefined) {
    writeLine(stdout, `  operationId: ${operation.operationId}`);
  }

  writeLine(stdout, `  tags: ${operation.tags.length === 0 ? '-' : operation.tags.join(', ')}`);
  writeLine(stdout, `  body: ${formatCatalogBody(operation)}`);

  const parameters = readCatalogParameterLabels(operation.parameters);

  if (parameters.length > 0) {
    writeLine(stdout, `  parameters: ${parameters.join(', ')}`);
  }

  if (operation.summary !== undefined) {
    writeLine(stdout, `  summary: ${operation.summary}`);
  }
}

function formatCatalogBody(operation: ApiCatalogOperation): string {
  if (!operation.hasRequestBody) {
    return 'no';
  }

  if (!operation.requestBodyContentTypes || operation.requestBodyContentTypes.length === 0) {
    return 'yes';
  }

  return `yes (${operation.requestBodyContentTypes.join(', ')})`;
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
    .version('0.4.0')
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
    .command('update')
    .description('Update existing load-tests scaffold files without touching config or scenarios.')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .action(async (options: UpdateOptions) => {
      const result = await runUpdateCommand(options, context);
      writeUpdateSummary(stdout, result, resolveCwd(context));
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
    .command('run')
    .description('Validate, generate, and run a scenario with k6.')
    .requiredOption('-s, --scenario <path-or-name>', 'Scenario DSL file path or load-tests scenario name')
    .option('-w, --write <path>', 'Output k6 script path (defaults to load-tests/generated/<scenario>.k6.js)')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--log', 'Save k6 output to load-tests/logs/<scenario>.log')
    .option('--trace', 'Print OpenAPI step start/end logs from the generated k6 script')
    .option('--report', 'Export k6 Web Dashboard HTML to load-tests/logs/<scenario>-report.html')
    .option('--open-dashboard', 'Open the k6 Web Dashboard while the test is running')
    .argument('[k6Args...]', 'k6 run options after --')
    .action(async (k6Args: string[], options: RunOptions) => {
      const result = await runRunCommand({ ...options, k6Args }, context);

      if (result.exitCode !== 0 || result.signal !== null) {
        throw new CommanderError(
          result.exitCode ?? 1,
          'openapi-k6.k6.failed',
          result.signal === null ? 'k6 run failed' : `k6 run failed with signal ${result.signal}`,
        );
      }
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
    .command('catalog')
    .description('Search the configured endpoint catalog for scenario YAML authoring.')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('-q, --query <text>', 'Search operationId, path, tags, summary, description, or parameters')
    .option('--method <method>', 'Filter by HTTP method')
    .option('--tag <tag>', 'Filter by exact tag')
    .option('--all', 'List all operations instead of only the summary')
    .option('--json', 'Print JSON output')
    .action(async (options: CatalogOptions) => {
      const result = await runCatalogCommand(options, context);
      writeCatalogOutput(stdout, result, resolveCwd(context), options.json);
    });

  const moduleCommand = program
    .command('module')
    .description('Manage OpenAPI modules in load-tests/config.yaml.');

  moduleCommand
    .command('list')
    .description('List configured OpenAPI modules.')
    .option('--config <path>', 'Load test config file path')
    .option('--json', 'Print JSON output')
    .action(async (options: ModuleListOptions) => {
      const result = await runModuleListCommand(options, context);
      writeModuleListOutput(stdout, result, resolveCwd(context), options.json);
    });

  moduleCommand
    .command('add')
    .description('Add or update an OpenAPI module in config.')
    .argument('<name>', 'Module name')
    .option('-o, --openapi <path-or-url>', 'OpenAPI spec file path or URL; auto-discovered from --base-url when omitted')
    .option('--base-url <url>', 'Module-specific API base URL')
    .option('--snapshot <path>', 'OpenAPI snapshot path in config')
    .option('--catalog <path>', 'Endpoint catalog path in config')
    .option('--set-default', 'Set this module as defaultModule')
    .option('--sync', 'Create snapshot and catalog before saving config')
    .option('--force', 'Update an existing module')
    .option('--config <path>', 'Load test config file path')
    .action(async (name: string, options: Omit<ModuleAddOptions, 'name'>) => {
      const result = await runModuleAddCommand({ ...options, name }, context);
      writeModuleAddSummary(stdout, result, resolveCwd(context));
    });

  moduleCommand
    .command('set-default')
    .description('Set defaultModule in config.')
    .argument('<name>', 'Module name')
    .option('--config <path>', 'Load test config file path')
    .action(async (name: string, options: Omit<ModuleSetDefaultOptions, 'name'>) => {
      const result = await runModuleSetDefaultCommand({ ...options, name }, context);
      writeModuleSetDefaultSummary(stdout, result, resolveCwd(context));
    });

  moduleCommand
    .command('remove')
    .description('Remove an OpenAPI module from config without deleting snapshot or catalog files.')
    .argument('<name>', 'Module name')
    .option('--config <path>', 'Load test config file path')
    .option('--force', 'Remove even if the module is defaultModule or referenced by scenarios')
    .action(async (name: string, options: Omit<ModuleRemoveOptions, 'name'>) => {
      const result = await runModuleRemoveCommand({ ...options, name }, context);
      writeModuleRemoveSummary(stdout, result, resolveCwd(context));
    });

  program
    .command('validate')
    .description('Validate a scenario YAML against the configured OpenAPI snapshot without calling the API.')
    .requiredOption('-s, --scenario <path-or-name>', 'Scenario DSL file path or load-tests scenario name')
    .option('-o, --openapi <path>', 'OpenAPI spec file path')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .action(async (options: ValidateOptions) => {
      const result = await runValidateCommand(options, context);
      writeValidateSummary(stdout, result, resolveCwd(context));
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

function resolveEntryPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

const entryPath = process.argv[1] ? resolveEntryPath(process.argv[1]) : '';

if (fileURLToPath(import.meta.url) === entryPath) {
  void main();
}
