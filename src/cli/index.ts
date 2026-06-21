#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { parse as parseDotEnv } from 'dotenv';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, realpathSync, type Dirent, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  loadTestConfig,
  resolveConfigFilePath,
  resolveConfigModule,
  type LoadTestConfig,
  type LoadTestModuleConfig,
} from '../config/load-test.config.js';
import {
  removeModuleConfigEntry,
  resolveDefaultAfterModuleRemoval,
  writeDefaultModuleConfig,
  writeModuleConfigEntry,
} from '../config/load-test.config.writer.js';
import {
  createModuleBaseUrlEnvName,
  findModuleBaseUrlEnvNameCollisions,
} from '../core/module-env.js';
import type {
  ApiRegistry,
  Scenario,
} from '../core/types.js';
import {
  executeAstScenario,
  type ScenarioExecutionReporter,
  type ScenarioExecutionResult,
} from '../executor/scenario.executor.js';
import { syncOpenApiSnapshot } from '../openapi/openapi.catalog.js';
import { parseOpenApiFile } from '../openapi/openapi.parser.js';
import { parseScenarioFile } from '../parser/scenario.parser.js';
import {
  CURRENT_SCAFFOLD_VERSION,
  DEFAULT_WORKSPACE_DIR,
  SCAFFOLD_METADATA_FILENAME,
  initLoadTests,
  updateLoadTests,
} from '../scaffold/load-test.init.js';
import {
  prepareGeneratedK6Script,
  validateAndBuildAst,
  validateScenarioOpenApi,
  type ScenarioOpenApiContext,
  type ValidatedAstPlan,
} from './scenario-script.js';
import { applyScenarioVarOverrides } from './scenario-var-overrides.js';
import {
  countCatalogTags,
  filterCatalogOperations,
  findDuplicateOperationWarnings,
  normalizeCatalogFilters,
  readCatalogFile,
  shouldListCatalogOperations,
  sortCatalogOperations,
  writeCatalogOutput,
  type CatalogResult,
} from './catalog.js';
import { createCliProgram } from './program.js';
import { runUiServerCommand } from './ui/server.js';

export type { CatalogResult } from './catalog.js';

type WritableLike = {
  write(chunk: string): unknown;
  isTTY?: boolean;
};

type ReadableLike = NodeJS.ReadableStream & {
  isTTY?: boolean;
};

const LEGACY_DEFAULT_LOAD_TEST_DIR = 'load-tests';
const DEFAULT_LOAD_TEST_DIR = DEFAULT_WORKSPACE_DIR;
const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;
const LEGACY_DEFAULT_CONFIG_PATH = `${LEGACY_DEFAULT_LOAD_TEST_DIR}/config.yaml`;
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
const CLI_VERSION = CURRENT_SCAFFOLD_VERSION;
const CODEX_SKILL_NAME = 'openapi-k6-scenario';

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
  varFile?: string[];
  var?: string[];
}

export interface ValidateOptions {
  scenario: string;
  openapi?: string;
  config?: string;
  module?: string;
  varFile?: string[];
  var?: string[];
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
  varFile?: string[];
  var?: string[];
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
  varFile?: string[];
  var?: string[];
}

export interface UiOptions {
  config?: string;
  module?: string;
  host?: string;
  port?: string;
}

export interface CatalogOptions {
  config?: string;
  module?: string;
  query?: string;
  method?: string;
  tag?: string;
  all?: boolean;
  sync?: boolean;
  ai?: boolean;
  snippet?: boolean;
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
  sync?: boolean;
  input?: boolean;
  noInput?: boolean;
}

export interface UpdateOptions {
  config?: string;
  module?: string;
}

export interface InstallSkillOptions {
  agent?: string;
  targetDir?: string;
  force?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

export interface DoctorOptions {
  config?: string;
  json?: boolean;
}

export interface GenerateResult {
  outputPath: string;
  scenarioPath: string;
  openapiPath: string;
  openapiPaths?: Record<string, string>;
  baseUrl: string;
  warnings: string[];
  moduleName?: string;
  moduleNames?: string[];
  scaffoldWarnings?: string[];
  scaffoldUpdateCommand?: string;
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
  scaffoldWarnings?: string[];
  scaffoldUpdateCommand?: string;
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
  scaffoldWarnings?: string[];
  scaffoldUpdateCommand?: string;
}

export interface RunResult {
  outputPath: string;
  scenarioPath: string;
  openapiPath: string;
  openapiPaths?: Record<string, string>;
  moduleName?: string;
  moduleNames?: string[];
  scaffoldWarnings?: string[];
  scaffoldUpdateCommand?: string;
  logPath?: string;
  reportPath?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface UiResult {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
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
  metadataPath: string;
  synced?: SyncResult;
}

export interface UpdateResult {
  directoryPath: string;
  configPath: string;
  envExamplePath: string;
  gitignorePath: string;
  runScriptPath: string;
  readmePath: string;
  metadataPath: string;
  migratedFrom?: string;
}

export interface InstallSkillResult {
  sourceDir: string;
  targetDir: string;
  dryRun: boolean;
  installed: boolean;
  replaced: boolean;
  alreadyInstalled: boolean;
}

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface DoctorResult {
  configPath?: string;
  checks: DoctorCheck[];
  passed: boolean;
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

function resolvePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function resolveSkillTargetDir(cwd: string, targetDir: string | undefined): string {
  if (targetDir !== undefined) {
    return path.isAbsolute(targetDir) ? targetDir : path.resolve(cwd, targetDir);
  }

  return path.join(homedir(), '.codex', 'skills', CODEX_SKILL_NAME);
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
  if (isScenarioKey(value)) {
    const explicitPath = path.resolve(cwd, value);

    if (hasScenarioKeySeparator(value) && existsSync(explicitPath)) {
      return explicitPath;
    }

    return path.join(resolveLoadTestDir(cwd, config), 'scenarios', `${normalizeScenarioKey(value)}.yaml`);
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

  const scenarioName = resolveScenarioOutputStem(cwd, config, scenario);

  return resolveGeneratedK6Path(resolveLoadTestDir(cwd, config), scenarioName);
}

function resolveScenarioOutputStem(cwd: string, config: LoadTestConfig | undefined, scenario: string): string {
  if (isScenarioKey(scenario)) {
    const explicitPath = path.resolve(cwd, scenario);

    if (hasScenarioKeySeparator(scenario) && existsSync(explicitPath)) {
      return resolveScenarioOutputStemFromPath(cwd, config, explicitPath);
    }

    return normalizeScenarioKey(scenario);
  }

  return resolveScenarioOutputStemFromPath(cwd, config, path.resolve(cwd, scenario));
}

function resolveScenarioOutputStemFromPath(cwd: string, config: LoadTestConfig | undefined, scenarioPath: string): string {
  const scenarioDir = path.join(resolveLoadTestDir(cwd, config), 'scenarios');
  const relative = path.relative(scenarioDir, scenarioPath);

  if (isLocalRelativePath(relative) && isScenarioFile(relative)) {
    return formatScenarioKey(relative);
  }

  return resolveScenarioName(scenarioPath);
}

function resolveGeneratedK6Path(loadTestDir: string, scenarioKey: string): string {
  const parts = scenarioKey.split('/');
  const scriptName = `${parts.pop() ?? scenarioKey}.k6.js`;
  return path.join(loadTestDir, 'generated', ...parts, scriptName);
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

async function readScaffoldWarnings(
  cwd: string,
  config: LoadTestConfig | undefined,
): Promise<string[]> {
  if (config === undefined) {
    return [];
  }

  const metadataPath = path.join(resolveLoadTestDir(cwd, config), SCAFFOLD_METADATA_FILENAME);

  try {
    const raw = await fs.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(raw) as { scaffoldVersion?: unknown };
    const scaffoldVersion = typeof metadata.scaffoldVersion === 'string'
      ? metadata.scaffoldVersion
      : undefined;

    if (scaffoldVersion === undefined) {
      return [
        `${formatDisplayPath(cwd, metadataPath)} does not contain scaffoldVersion.`,
      ];
    }

    if (compareSemver(scaffoldVersion, CURRENT_SCAFFOLD_VERSION) < 0) {
      return [
        `${formatDisplayPath(cwd, resolveLoadTestDir(cwd, config))} workspace was generated by openapi-k6 ${scaffoldVersion}. Current CLI is ${CURRENT_SCAFFOLD_VERSION}.`,
      ];
    }

    return [];
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return [
        `${formatDisplayPath(cwd, metadataPath)} was not found. This workspace may have been created by an older openapi-k6 scaffold.`,
      ];
    }

    if (error instanceof SyntaxError) {
      return [
        `${formatDisplayPath(cwd, metadataPath)} is not valid JSON.`,
      ];
    }

    throw error;
  }
}

function compareSemver(left: string, right: string): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    const delta = leftParts[index] - rightParts[index];

    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function parseSemver(value: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);

  if (match === null) {
    return [0, 0, 0];
  }

  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
}

function formatScaffoldUpdateCommand(cwd: string, config: LoadTestConfig): string {
  const defaultConfigPath = path.resolve(cwd, DEFAULT_CONFIG_PATH);
  const parts = ['npx', '--yes', 'openapi-k6', 'update'];

  if (path.resolve(config.path) !== defaultConfigPath) {
    parts.push('--config', formatDisplayPath(cwd, config.path));
  }

  return parts.map(shellQuote).join(' ');
}

function resolveScaffoldUpdateCommand(
  cwd: string,
  config: LoadTestConfig | undefined,
  warnings: string[],
): string | undefined {
  if (config === undefined || warnings.length === 0) {
    return undefined;
  }

  return formatScaffoldUpdateCommand(cwd, config);
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

async function findScenarioModuleReferences(
  config: LoadTestConfig,
  moduleName: string,
): Promise<ModuleScenarioReference[]> {
  const scenarioDir = path.join(config.dir, 'scenarios');
  const scenarioFiles = await listScenarioFiles(scenarioDir);
  const references: ModuleScenarioReference[] = [];

  for (const scenarioPath of scenarioFiles) {
    const scenario = await parseScenarioFile(scenarioPath, {
      scenarioRootDir: scenarioDir,
    });

    for (const step of scenario.steps) {
      if (
        step.api.module === moduleName ||
        (step.api.module === undefined && config.defaultModule === moduleName)
      ) {
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
      if (entry.name === 'partials' || entry.name === 'fixtures') {
        continue;
      }

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
  const scenario = await applyScenarioVarOverrides(
    cwd,
    await parseWorkspaceScenarioFile(cwd, config, scenarioPath),
    options,
  );
  const openApiContext = await loadScenarioOpenApiContext({
    cwd,
    config,
    scenario,
    cliOpenapi: options.openapi,
    cliModuleName: options.module,
    commandName: 'generate',
    requireBaseUrl: true,
  });
  const scaffoldWarnings = await readScaffoldWarnings(cwd, config);
  const scaffoldUpdateCommand = resolveScaffoldUpdateCommand(cwd, config, scaffoldWarnings);
  const outputPath = resolveOutputPath(cwd, config, options.scenario, options.write);
  const generated = prepareGeneratedK6Script({
    scenario,
    outputPath,
    openApiContext,
    fileRootDir: resolveLoadTestDir(cwd, config),
  });
  const result: GenerateResult = {
    outputPath: generated.outputPath,
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    baseUrl: openApiContext.baseUrl ?? '',
    warnings: generated.warnings,
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
    ...(scaffoldWarnings.length === 0 ? {} : { scaffoldWarnings }),
    ...(scaffoldUpdateCommand === undefined ? {} : { scaffoldUpdateCommand }),
  };

  await fs.mkdir(path.dirname(result.outputPath), { recursive: true });
  await fs.writeFile(result.outputPath, generated.script, 'utf8');

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
  const scenario = await applyScenarioVarOverrides(
    cwd,
    await parseWorkspaceScenarioFile(cwd, config, scenarioPath),
    options,
  );
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
  const validatedAst = validateAndBuildAst(scenario, openApiContext);
  const scaffoldWarnings = await readScaffoldWarnings(cwd, config);
  const scaffoldUpdateCommand = resolveScaffoldUpdateCommand(cwd, config, scaffoldWarnings);
  const outputPath = resolveOutputPath(cwd, config, options.scenario, options.write);
  const generated = prepareGeneratedK6Script({
    scenario,
    outputPath,
    openApiContext,
    fileRootDir: loadTestDir,
    validatedAst,
  });

  await fs.mkdir(path.dirname(generated.outputPath), { recursive: true });
  await fs.writeFile(generated.outputPath, generated.script, 'utf8');

  writeValidationWarnings(stdout, generated.warnings);
  writeScaffoldUpdateNotice(stdout, scaffoldWarnings, scaffoldUpdateCommand);
  writeLine(stdout, `Generated ${generated.outputPath}`);

  const k6Result = await runK6Script({
    cwd,
    loadTestDir,
    scenarioName: resolveScenarioOutputStem(cwd, config, options.scenario),
    scriptPath: generated.outputPath,
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
    outputPath: generated.outputPath,
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
    ...(scaffoldWarnings.length === 0 ? {} : { scaffoldWarnings }),
    ...(scaffoldUpdateCommand === undefined ? {} : { scaffoldUpdateCommand }),
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
  const scenario = await applyScenarioVarOverrides(
    cwd,
    await parseWorkspaceScenarioFile(cwd, config, scenarioPath),
    options,
  );
  const openApiContext = await loadScenarioOpenApiContext({
    cwd,
    config,
    scenario,
    cliOpenapi: options.openapi,
    cliModuleName: options.module,
    commandName: 'validate',
    requireBaseUrl: false,
  });
  const validation = validateScenarioOpenApi(scenario, openApiContext);
  const scaffoldWarnings = await readScaffoldWarnings(cwd, config);
  const scaffoldUpdateCommand = resolveScaffoldUpdateCommand(cwd, config, scaffoldWarnings);

  return {
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    scenarioName: validation.scenarioName,
    stepCount: validation.stepCount,
    warnings: [...validation.warnings, ...scaffoldWarnings],
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
    ...(scaffoldWarnings.length === 0 ? {} : { scaffoldWarnings }),
    ...(scaffoldUpdateCommand === undefined ? {} : { scaffoldUpdateCommand }),
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

  const synced = options.sync === true
    ? await runSyncCommand({
        config: options.config,
        module: options.module,
      }, context)
    : undefined;
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
  const shouldList = shouldListCatalogOperations(filters) ||
    options.ai === true ||
    options.snippet === true;
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
    ...(synced === undefined ? {} : { synced }),
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
  const scenario = await applyScenarioVarOverrides(
    cwd,
    await parseWorkspaceScenarioFile(cwd, config, scenarioPath),
    options,
  );
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
  const validatedAst = validateAndBuildAst(scenario, openApiContext);
  const scaffoldWarnings = await readScaffoldWarnings(cwd, config);
  const scaffoldUpdateCommand = resolveScaffoldUpdateCommand(cwd, config, scaffoldWarnings);

  const result = await executeAstScenario(validatedAst.ast, {
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
    ...(scaffoldWarnings.length === 0 ? {} : { scaffoldWarnings }),
    ...(scaffoldUpdateCommand === undefined ? {} : { scaffoldUpdateCommand }),
  };
}

export async function runUiCommand(
  options: UiOptions,
  context: CliContext = {},
): Promise<UiResult> {
  return runUiServerCommand(options, context, { runCli });
}

export async function runInitCommand(
  options: InitOptions,
  context: CliContext = {},
): Promise<InitResult> {
  const cwd = resolveCwd(context);
  const resolvedOptions = await resolveInitOptionsInteractively(options, context, cwd);

  const result = await initLoadTests({
    cwd,
    directory: resolvedOptions.dir,
    module: resolvedOptions.module,
    baseUrl: resolvedOptions.baseUrl,
    openapi: resolvedOptions.openapi,
    smokePath: resolvedOptions.smokePath,
    force: resolvedOptions.force,
  });

  if (resolvedOptions.sync !== true) {
    return result;
  }

  const synced = await runSyncCommand({
    config: result.configPath,
    module: resolvedOptions.module,
  }, context);

  return {
    ...result,
    synced,
  };
}

export async function runUpdateCommand(
  options: UpdateOptions,
  context: CliContext = {},
): Promise<UpdateResult> {
  const cwd = resolveCwd(context);
  const migratedFrom = await migrateLegacyDefaultWorkspaceForUpdate(cwd, options);
  const config = await loadOptionalConfig(cwd, options.config, true);
  const moduleConfig = selectConfigModule(config, options.module);

  if (config === undefined) {
    throw new Error(`${DEFAULT_CONFIG_PATH} was not found. Run openapi-k6 init or pass --config.`);
  }

  const result = await updateLoadTests({
    cwd,
    directory: path.relative(cwd, config.dir) || '.',
    module: moduleConfig?.name,
    includeModuleOption: options.module !== undefined,
    snapshot: moduleConfig?.snapshot,
    catalog: moduleConfig?.catalog,
  });

  return {
    ...result,
    ...(migratedFrom === undefined ? {} : { migratedFrom }),
  };
}

async function migrateLegacyDefaultWorkspaceForUpdate(
  cwd: string,
  options: UpdateOptions,
): Promise<string | undefined> {
  if (options.config !== undefined) {
    return undefined;
  }

  const defaultDirectoryPath = path.join(cwd, DEFAULT_LOAD_TEST_DIR);
  const defaultConfigPath = path.join(cwd, DEFAULT_CONFIG_PATH);

  if (await pathExists(defaultConfigPath)) {
    return undefined;
  }

  const legacyDirectoryPath = path.join(cwd, LEGACY_DEFAULT_LOAD_TEST_DIR);
  const legacyConfigPath = path.join(cwd, LEGACY_DEFAULT_CONFIG_PATH);

  if (!(await pathExists(legacyConfigPath))) {
    return undefined;
  }

  if (await pathExists(defaultDirectoryPath)) {
    throw new Error(
      `${DEFAULT_LOAD_TEST_DIR} already exists. Move it aside or pass --config ${LEGACY_DEFAULT_CONFIG_PATH} to update the legacy workspace in place.`,
    );
  }

  await fs.rename(legacyDirectoryPath, defaultDirectoryPath);

  return legacyDirectoryPath;
}

export async function runInstallSkillCommand(
  options: InstallSkillOptions,
  context: CliContext = {},
): Promise<InstallSkillResult> {
  const agent = options.agent ?? 'codex';

  if (agent !== 'codex') {
    throw new Error(`Unsupported agent: ${agent}. Only "codex" is currently supported.`);
  }

  const cwd = resolveCwd(context);
  const sourceDir = path.join(resolvePackageRoot(), 'skills', CODEX_SKILL_NAME);
  const targetDir = resolveSkillTargetDir(cwd, options.targetDir);

  if (!(await pathExists(sourceDir))) {
    throw new Error(`Bundled skill not found: ${sourceDir}`);
  }

  const alreadyInstalled = await pathExists(targetDir);

  if (options.dryRun === true) {
    return {
      sourceDir,
      targetDir,
      dryRun: true,
      installed: false,
      replaced: false,
      alreadyInstalled,
    };
  }

  if (alreadyInstalled && options.force !== true) {
    return {
      sourceDir,
      targetDir,
      dryRun: false,
      installed: false,
      replaced: false,
      alreadyInstalled: true,
    };
  }

  if (alreadyInstalled) {
    await fs.rm(targetDir, { recursive: true, force: true });
  }

  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });

  return {
    sourceDir,
    targetDir,
    dryRun: false,
    installed: true,
    replaced: alreadyInstalled,
    alreadyInstalled,
  };
}

export async function runDoctorCommand(
  options: DoctorOptions,
  context: CliContext = {},
): Promise<DoctorResult> {
  const cwd = resolveCwd(context);
  const configPath = path.resolve(cwd, options.config ?? DEFAULT_CONFIG_PATH);
  const checks: DoctorCheck[] = [];
  let config: LoadTestConfig | undefined;

  try {
    config = await loadOptionalConfig(cwd, options.config, true);
    if (config === undefined) {
      throw new Error(`${DEFAULT_CONFIG_PATH} was not found. Run openapi-k6 init or pass --config.`);
    }
    checks.push({
      name: 'config',
      status: 'pass',
      message: `${formatDisplayPath(cwd, config.path)} loaded`,
    });
  } catch (error) {
    checks.push({
      name: 'config',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (config !== undefined) {
    const loadTestEnv = await loadLoadTestEnv(path.dirname(config.path));
    const runtimeEnv = {
      ...loadTestEnv,
      ...(context.env ?? process.env),
    };
    checks.push(...await collectDoctorConfigChecks(cwd, config, runtimeEnv));
    checks.push(collectDoctorScaffoldCheck(cwd, config, await readScaffoldWarnings(cwd, config)));
  }

  checks.push(collectDoctorK6Check(context));

  return {
    configPath,
    checks,
    passed: checks.every((check) => check.status !== 'fail'),
  };
}

async function collectDoctorConfigChecks(
  cwd: string,
  config: LoadTestConfig,
  runtimeEnv: NodeJS.ProcessEnv,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const moduleNames = [...config.modules.keys()];
  const collisions = findModuleBaseUrlEnvNameCollisions(moduleNames);
  const modules = [...config.modules.values()];

  checks.push({
    name: 'modules',
    status: 'pass',
    message: `${moduleNames.length} configured (${moduleNames.join(', ')})`,
  });

  checks.push(collectDoctorModuleSummary(config, modules));

  if (collisions.length === 0) {
    checks.push({
      name: 'module-env',
      status: 'pass',
      message: 'module BASE_URL env names are unique',
    });
  } else {
    checks.push(...collisions.map((collision) => ({
      name: 'module-env',
      status: 'fail' as const,
      message: `modules ${collision.moduleNames.map((name) => JSON.stringify(name)).join(', ')} all map to ${collision.envName}`,
    })));
  }

  for (const moduleConfig of modules) {
    checks.push(checkOptionalOpenApi(moduleConfig));
    checks.push(await checkDoctorModuleBaseUrl(cwd, config, moduleConfig, runtimeEnv));
    checks.push(await checkConfiguredFile(cwd, config, moduleConfig, 'snapshot'));
    checks.push(await checkConfiguredFile(cwd, config, moduleConfig, 'catalog'));
  }

  return checks;
}

function collectDoctorModuleSummary(config: LoadTestConfig, modules: LoadTestModuleConfig[]): DoctorCheck {
  const moduleBaseUrls = modules.filter((moduleConfig) => normalizeConfiguredValue(moduleConfig.baseUrl) !== undefined).length;
  const snapshots = modules.filter((moduleConfig) => isConfiguredValue(moduleConfig.snapshot)).length;
  const rootBaseUrl = normalizeConfiguredValue(config.baseUrl) === undefined ? 'root baseUrl not configured' : 'root baseUrl configured';

  return {
    name: 'modules.summary',
    status: 'pass',
    message: `${moduleBaseUrls} module baseUrls · ${snapshots} snapshots configured · ${rootBaseUrl}`,
  };
}

function checkOptionalOpenApi(moduleConfig: LoadTestModuleConfig): DoctorCheck {
  if (!isConfiguredValue(moduleConfig.openapi)) {
    return {
      name: `modules.${moduleConfig.name}.openapi`,
      status: 'warn',
      message: 'not configured; sync needs modules.<name>.openapi or --openapi',
    };
  }

  return {
    name: `modules.${moduleConfig.name}.openapi`,
    status: 'pass',
    message: moduleConfig.openapi,
  };
}

async function checkDoctorModuleBaseUrl(
  cwd: string,
  config: LoadTestConfig,
  moduleConfig: LoadTestModuleConfig,
  runtimeEnv: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  const name = `modules.${moduleConfig.name}.baseUrl`;
  const moduleEnvName = createModuleBaseUrlEnvName(moduleConfig.name);
  const moduleEnv = normalizeConfiguredValue(runtimeEnv[moduleEnvName]);

  if (moduleEnv !== undefined) {
    return { name, status: 'pass', message: `${moduleEnv} (${moduleEnvName})` };
  }

  const rootEnv = normalizeConfiguredValue(runtimeEnv.BASE_URL);

  if (rootEnv !== undefined) {
    return { name, status: 'pass', message: `${rootEnv} (BASE_URL)` };
  }

  const moduleBaseUrl = normalizeConfiguredValue(moduleConfig.baseUrl);

  if (moduleBaseUrl !== undefined) {
    return { name, status: 'pass', message: `${moduleBaseUrl} (modules.${moduleConfig.name}.baseUrl)` };
  }

  const rootBaseUrl = normalizeConfiguredValue(config.baseUrl);

  if (rootBaseUrl !== undefined) {
    return { name, status: 'pass', message: `${rootBaseUrl} (baseUrl)` };
  }

  if (isConfiguredValue(moduleConfig.snapshot)) {
    const snapshotPath = resolveConfigFilePath(config, moduleConfig.snapshot);

    try {
      const registry = await parseOpenApiFile(snapshotPath);

      if (registry.defaultServerUrl !== undefined) {
        return {
          name,
          status: 'pass',
          message: `${registry.defaultServerUrl} (modules.${moduleConfig.name}.snapshot servers[0].url)`,
        };
      }

      return {
        name,
        status: 'fail',
        message: 'baseUrl is not configured and snapshot servers[0].url is missing',
      };
    } catch (error) {
      return {
        name,
        status: 'fail',
        message: `baseUrl is not configured; snapshot fallback could not be checked: ${formatDisplayPath(cwd, snapshotPath)} (${error instanceof Error ? error.message : String(error)})`,
      };
    }
  }

  return {
    name,
    status: 'fail',
    message: `baseUrl is not configured; set ${moduleEnvName}, BASE_URL, modules.${moduleConfig.name}.baseUrl, baseUrl, or snapshot servers[0].url`,
  };
}

async function checkConfiguredFile(
  cwd: string,
  config: LoadTestConfig,
  moduleConfig: LoadTestModuleConfig,
  field: 'snapshot' | 'catalog',
): Promise<DoctorCheck> {
  const value = moduleConfig[field];
  const name = `modules.${moduleConfig.name}.${field}`;

  if (!isConfiguredValue(value)) {
    return {
      name,
      status: 'fail',
      message: `${name} is not configured`,
    };
  }

  const filePath = resolveConfigFilePath(config, value);

  try {
    await fs.access(filePath);
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return {
        name,
        status: 'fail',
        message: `${formatDisplayPath(cwd, filePath)} was not found`,
      };
    }

    throw error;
  }

  return {
    name,
    status: 'pass',
    message: formatDisplayPath(cwd, filePath),
  };
}

function collectDoctorScaffoldCheck(
  cwd: string,
  config: LoadTestConfig,
  warnings: string[],
): DoctorCheck {
  if (warnings.length === 0) {
    return {
      name: 'scaffold',
      status: 'pass',
      message: `${formatDisplayPath(cwd, path.join(resolveLoadTestDir(cwd, config), SCAFFOLD_METADATA_FILENAME))} is current`,
    };
  }

  return {
    name: 'scaffold',
    status: 'warn',
    message: `${warnings.join(' ')} Run ${formatScaffoldUpdateCommand(cwd, config)}`,
  };
}

function collectDoctorK6Check(context: CliContext): DoctorCheck {
  const result = spawnSync('k6', ['version'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(context.env ?? {}),
    },
  });

  if (result.error !== undefined) {
    return {
      name: 'k6',
      status: 'warn',
      message: 'k6 was not found on PATH; install k6 before using openapi-k6 run or run.sh',
    };
  }

  if (result.status !== 0) {
    return {
      name: 'k6',
      status: 'warn',
      message: `k6 version check exited with ${result.status ?? 'unknown'}`,
    };
  }

  return {
    name: 'k6',
    status: 'pass',
    message: (result.stdout || result.stderr).trim().split('\n')[0] || 'k6 found',
  };
}

function writeValidationWarnings(stdout: WritableLike, warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  writeLine(stdout, 'Warnings:');

  for (const warning of warnings) {
    writeLine(stdout, `  - ${warning}`);
  }

  writeLine(stdout, '');
}

function writeScaffoldUpdateNotice(
  stdout: WritableLike,
  warnings: string[],
  updateCommand: string | undefined,
): void {
  if (warnings.length === 0) {
    return;
  }

  writeLine(stdout, 'Scaffold update available:');

  for (const warning of warnings) {
    writeLine(stdout, `  reason   ${warning}`);
  }

  if (updateCommand !== undefined) {
    writeLine(stdout, `  command  ${updateCommand}`);
  }

  writeLine(stdout, '  keeps    config, scenarios, .env, snapshots, generated scripts, and logs unchanged');
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
  command: 'catalog' | 'sync' | 'validate' | 'test' | 'generate',
  configPath: string,
  moduleName: string | undefined,
  cwd: string,
): string {
  const defaultConfigPath = path.join(cwd, DEFAULT_CONFIG_PATH);
  const parts = ['npx', '--yes', 'openapi-k6', command];

  if (command === 'catalog') {
    parts.push('--query', '<검색어>', '--ai');
  }

  if (command === 'validate' || command === 'test' || command === 'generate') {
    parts.push('-s', '<scenario-key>');
  }

  if (path.resolve(configPath) !== defaultConfigPath) {
    parts.push('--config', formatDisplayPath(cwd, configPath));
  }

  if (moduleName !== undefined && moduleName !== 'default') {
    parts.push('--module', moduleName);
  }

  return parts
    .map((part) => part === '<scenario-key>' || part === '<검색어>' ? part : shellQuote(part))
    .join(' ');
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
  writeLine(stdout, `  metadata  ${formatDisplayPath(cwd, result.metadataPath)}`);

  if (result.synced !== undefined) {
    writeLine(stdout, '');
    writeLine(stdout, `Synced ${formatDisplayPath(cwd, result.synced.snapshotPath)}`);
    writeLine(stdout, `Catalog ${formatDisplayPath(cwd, result.synced.catalogPath)} (${result.synced.operationCount} operations)`);
  }

  writeLine(stdout, '');
  writeLine(stdout, 'Next');

  if (result.synced === undefined) {
    writeLine(stdout, `  ${initNextCommand('sync', result.configPath, moduleName, cwd)}`);
  } else {
    writeLine(stdout, `  ${initNextCommand('catalog', result.configPath, moduleName, cwd)}`);
  }

  writeLine(stdout, `  ${initNextCommand('validate', result.configPath, moduleName, cwd)}`);
  writeLine(stdout, `  ${initNextCommand('test', result.configPath, moduleName, cwd)}`);
  writeLine(stdout, `  ${initNextCommand('generate', result.configPath, moduleName, cwd)}`);
  writeLine(stdout, `  ${formatRunScriptCommand(cwd, result.runScriptPath)} <scenario-key> --log`);
}

function writeSyncSummary(
  stdout: WritableLike,
  result: SyncResult,
  options: SyncOptions,
  cwd: string,
): void {
  writeLine(stdout, `Synced ${result.snapshotPath}`);
  writeLine(stdout, `Catalog ${result.catalogPath} (${result.operationCount} operations)`);
  writeLine(stdout, '');
  writeLine(stdout, 'Next');

  if (result.moduleName === undefined) {
    writeLine(stdout, `  configure ${DEFAULT_CONFIG_PATH}, then run openapi-k6 catalog --query <검색어> --ai`);
    return;
  }

  const configPath = path.resolve(cwd, options.config ?? DEFAULT_CONFIG_PATH);

  writeLine(stdout, `  ${initNextCommand('catalog', configPath, result.moduleName, cwd)}`);
  writeLine(stdout, `  ${initNextCommand('validate', configPath, result.moduleName, cwd)}`);
  writeLine(stdout, `  ${initNextCommand('test', configPath, result.moduleName, cwd)}`);
}

function writeUpdateSummary(
  stdout: WritableLike,
  result: UpdateResult,
  cwd: string,
): void {
  if (result.migratedFrom !== undefined) {
    writeLine(stdout, `${initStatusSymbol(stdout, 'success')} Moved ${formatDisplayPath(cwd, result.migratedFrom)} to ${formatDisplayPath(cwd, result.directoryPath)}`);
  }

  writeLine(stdout, `${initStatusSymbol(stdout, 'success')} Updated openapi-k6 workspace metadata in ${formatDisplayPath(cwd, result.directoryPath)}`);
  writeLine(stdout, `  kept config  ${formatDisplayPath(cwd, result.configPath)}`);
  writeLine(stdout, `  guide        ${formatDisplayPath(cwd, result.readmePath)}`);
  writeLine(stdout, `  runner       ${formatDisplayPath(cwd, result.runScriptPath)}`);
  writeLine(stdout, `  env example  ${formatDisplayPath(cwd, result.envExamplePath)}`);
  writeLine(stdout, `  gitignore    ${formatDisplayPath(cwd, result.gitignorePath)}`);
  writeLine(stdout, `  metadata     ${formatDisplayPath(cwd, result.metadataPath)}`);
  writeLine(stdout, '  kept existing scenarios, snapshots, generated scripts, logs, and .env unchanged');
}

function writeInstallSkillSummary(
  stdout: WritableLike,
  result: InstallSkillResult,
  cwd: string,
): void {
  writeLine(stdout, 'openapi-k6 Codex skill');
  writeLine(stdout, `  source  ${formatDisplayPath(cwd, result.sourceDir)}`);
  writeLine(stdout, `  target  ${formatDisplayPath(cwd, result.targetDir)}`);

  if (result.dryRun) {
    writeLine(stdout, `${initStatusSymbol(stdout, 'success')} Dry run complete; no files were written.`);
    return;
  }

  if (result.alreadyInstalled && !result.installed) {
    writeLine(stdout, `${initStatusSymbol(stdout, 'success')} Skill already installed.`);
    writeLine(stdout, '  use --force to replace the existing installed skill');
    return;
  }

  if (result.replaced) {
    writeLine(stdout, `${initStatusSymbol(stdout, 'success')} Replaced openapi-k6-scenario skill for Codex.`);
  } else {
    writeLine(stdout, `${initStatusSymbol(stdout, 'success')} Installed openapi-k6-scenario skill for Codex.`);
  }

  writeLine(stdout, '  use it with: $openapi-k6-scenario 회원 로그인 시나리오');
}

function writeDoctorOutput(
  stdout: WritableLike,
  result: DoctorResult,
  cwd: string,
  json: boolean | undefined,
): void {
  if (json === true) {
    writeLine(stdout, JSON.stringify(result, null, 2));
    return;
  }

  writeLine(stdout, `Doctor ${formatDisplayPath(cwd, result.configPath ?? DEFAULT_CONFIG_PATH)}`);

  for (const check of result.checks) {
    const status = check.status === 'pass'
      ? 'success'
      : check.status === 'fail'
        ? 'failure'
        : 'warning';
    writeLine(stdout, `  ${initStatusSymbol(stdout, status)} ${check.name}: ${check.message}`);
  }
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

  const scaffoldWarningSet = new Set(result.scaffoldWarnings ?? []);
  const validationWarnings = result.warnings.filter((warning) => !scaffoldWarningSet.has(warning));
  const scaffoldWarnings = result.scaffoldWarnings ?? [];

  if (validationWarnings.length > 0 || scaffoldWarnings.length > 0) {
    writeLine(stdout, '');
  }

  writeValidationWarnings(stdout, validationWarnings);
  writeScaffoldUpdateNotice(stdout, scaffoldWarnings, result.scaffoldUpdateCommand);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return false;
    }

    throw error;
  }
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

function collectRepeatedOption(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export function createProgram(context: CliContext = {}): Command {
  return createCliProgram(context, {
    cliVersion: CLI_VERSION,
    defaultLoadTestDir: DEFAULT_LOAD_TEST_DIR,
    defaultConfigPath: DEFAULT_CONFIG_PATH,
    codexSkillName: CODEX_SKILL_NAME,
    resolveCwd,
    runInitCommand,
    writeInitSummary,
    runUpdateCommand,
    writeUpdateSummary,
    runInstallSkillCommand,
    writeInstallSkillSummary,
    runDoctorCommand,
    writeDoctorOutput,
    runUiCommand,
    runGenerateCommand,
    writeValidationWarnings,
    writeScaffoldUpdateNotice,
    writeLine,
    runRunCommand,
    runSyncCommand,
    writeSyncSummary,
    runCatalogCommand,
    writeCatalogOutput,
    runModuleListCommand,
    writeModuleListOutput,
    runModuleAddCommand,
    writeModuleAddSummary,
    runModuleSetDefaultCommand,
    writeModuleSetDefaultSummary,
    runModuleRemoveCommand,
    writeModuleRemoveSummary,
    runValidateCommand,
    writeValidateSummary,
    shouldUseColor,
    shouldUseLiveOutput,
    collectRepeatedOption,
    runTestCommand,
  });
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
