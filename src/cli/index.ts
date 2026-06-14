#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { parse as parseDotEnv } from 'dotenv';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, realpathSync, type Dirent, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { isMap, Pair, parse as parseYaml, parseDocument, Scalar, YAMLMap } from 'yaml';

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
import { collectTemplateReferences } from '../core/template.js';
import type {
  ApiCatalog,
  ApiCatalogExtractCandidate,
  ApiCatalogOperation,
  ApiCatalogRequestBodyFieldHint,
  ApiCatalogRequestBodyHint,
  ApiRegistry,
  ASTScenario,
  Scenario,
} from '../core/types.js';
import {
  executeAstScenario,
  type ScenarioExecutionReporter,
  type ScenarioExecutionResult,
} from '../executor/scenario.executor.js';
import { syncOpenApiSnapshot } from '../openapi/openapi.catalog.js';
import { HTTP_METHOD_ORDER, parseOpenApiFile } from '../openapi/openapi.parser.js';
import { parseScenarioFile } from '../parser/scenario.parser.js';
import {
  CURRENT_SCAFFOLD_VERSION,
  DEFAULT_WORKSPACE_DIR,
  SCAFFOLD_METADATA_FILENAME,
  initLoadTests,
  updateLoadTests,
} from '../scaffold/load-test.init.js';
import {
  validateScenarioAgainstOpenApi,
  type ScenarioValidationResult,
} from '../validator/scenario.validator.js';
import {
  createAnsiHtmlState,
  renderAnsiChunkToHtml,
  type AnsiHtmlState,
} from './ansi-html.js';
import { createScenarioConsoleReporter } from './test.reporter.js';

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
const VAR_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED_VAR_NAMES = new Set(['__proto__']);
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
  synced?: SyncResult;
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
  partialExamplePath: string;
  dataFixtureExamplePath: string;
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
  partialExamplePath: string;
  dataFixtureExamplePath: string;
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

interface GeneratedK6ScriptPlan {
  outputPath: string;
  script: string;
  warnings: string[];
}

interface ValidatedAstPlan {
  ast: ASTScenario;
  validation: ScenarioValidationResult;
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

async function applyScenarioVarOverrides(
  cwd: string,
  scenario: Scenario,
  options: Pick<GenerateOptions, 'varFile' | 'var'>,
): Promise<Scenario> {
  const fileVars = await loadScenarioVarFiles(cwd, normalizeRepeatedOption(options.varFile));
  const inlineVars = parseInlineScenarioVars(normalizeRepeatedOption(options.var));
  const mergedVars = {
    ...(scenario.vars ?? {}),
    ...fileVars,
    ...inlineVars,
  };

  if (Object.keys(mergedVars).length === 0 && scenario.vars === undefined) {
    return scenario;
  }

  return {
    ...scenario,
    vars: mergedVars,
  };
}

async function loadScenarioVarFiles(
  cwd: string,
  values: string[],
): Promise<Record<string, unknown>> {
  const vars: Record<string, unknown> = {};

  for (const value of values) {
    const filePath = path.resolve(cwd, value);
    Object.assign(vars, await loadScenarioVarFile(filePath));
  }

  return vars;
}

async function loadScenarioVarFile(filePath: string): Promise<Record<string, unknown>> {
  let source: string;
  let document: unknown;

  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      throw new Error(`${filePath}: var file was not found`);
    }

    throw error;
  }

  try {
    document = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${filePath}: failed to parse var file: ${message}`);
  }

  return parseScenarioVarsRecord(document, `${filePath}: var file`);
}

function parseInlineScenarioVars(values: string[]): Record<string, unknown> {
  const vars: Record<string, unknown> = {};

  for (const value of values) {
    const separatorIndex = value.indexOf('=');

    if (separatorIndex <= 0) {
      throw new Error(`--var must use name=value syntax: ${JSON.stringify(value)}`);
    }

    const name = value.slice(0, separatorIndex).trim();
    const rawValue = value.slice(separatorIndex + 1);

    validateScenarioVarName(name, '--var');
    vars[name] = parseInlineScenarioVarValue(name, rawValue);
  }

  return vars;
}

function parseInlineScenarioVarValue(name: string, value: string): unknown {
  if (value === '') {
    return '';
  }

  try {
    return parseYaml(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse --var ${name}: ${message}`);
  }
}

function parseScenarioVarsRecord(value: unknown, pathLabel: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an object`);
  }

  const vars = value as Record<string, unknown>;

  for (const key of Object.keys(vars)) {
    validateScenarioVarName(key, `${pathLabel}.${key}`);
  }

  return { ...vars };
}

function validateScenarioVarName(name: string, pathLabel: string): void {
  if (!name.trim()) {
    throw new Error(`${pathLabel}: variable name must not be empty`);
  }

  if (!VAR_NAME_PATTERN.test(name)) {
    throw new Error(`${pathLabel} must match ${VAR_NAME_PATTERN.source} for {{vars.NAME}} references`);
  }

  if (RESERVED_VAR_NAMES.has(name)) {
    throw new Error(`${pathLabel} is reserved and cannot be referenced as {{vars.${name}}}`);
  }
}

function normalizeRepeatedOption(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value : [];
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
  const generated = prepareGeneratedK6Script({
    cwd,
    config,
    scenario,
    scenarioInput: options.scenario,
    write: options.write,
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

function prepareGeneratedK6Script(options: {
  cwd: string;
  config: LoadTestConfig | undefined;
  scenario: Scenario;
  scenarioInput: string;
  write: string | undefined;
  openApiContext: ScenarioOpenApiContext;
  fileRootDir: string;
  validatedAst?: ValidatedAstPlan;
}): GeneratedK6ScriptPlan {
  const validatedAst = options.validatedAst
    ?? validateAndBuildAst(options.scenario, options.openApiContext);
  const outputPath = resolveOutputPath(options.cwd, options.config, options.scenarioInput, options.write);
  const script = generateK6Script(validatedAst.ast, {
    baseUrl: options.openApiContext.baseUrl,
    moduleBaseUrls: options.openApiContext.moduleBaseUrls,
    fileRootDir: options.fileRootDir,
    outputPath,
  });

  return {
    outputPath,
    script,
    warnings: validatedAst.validation.warnings,
  };
}

function validateAndBuildAst(
  scenario: Scenario,
  openApiContext: ScenarioOpenApiContext,
): ValidatedAstPlan {
  const validation = validateScenarioAgainstOpenApi(
    scenario,
    openApiContext.registrySource,
    { defaultModuleName: openApiContext.defaultModuleName },
  );
  const ast = buildAst(scenario, openApiContext.registrySource, {
    defaultModuleName: openApiContext.defaultModuleName,
  });

  return { ast, validation };
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
  const generated = prepareGeneratedK6Script({
    cwd,
    config,
    scenario,
    scenarioInput: options.scenario,
    write: options.write,
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
  const validation = validateScenarioAgainstOpenApi(
    scenario,
    openApiContext.registrySource,
    { defaultModuleName: openApiContext.defaultModuleName },
  );
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
  clients: Set<ServerResponse>;
  ansiHtmlState: AnsiHtmlState;
}

interface UiRunChunk {
  stream: 'stdout' | 'stderr';
  chunk: string;
  html: string;
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
    module?: string;
    operationId?: string;
    method?: string;
    path?: string;
    condition?: string;
    extract?: string[];
  }>;
}> {
  const scenarioPath = resolveUiScenarioPath(state, scenarioOption);
  const scenario = await parseWorkspaceScenarioFile(state.cwd, state.config, scenarioPath);
  const analysis = analyzeUiScenario(scenario);

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
    steps: scenario.steps.map((step) => ({
      id: step.id,
      ...(step.api.module === undefined ? {} : { module: step.api.module }),
      ...(step.api.operationId === undefined ? {} : { operationId: step.api.operationId }),
      ...(step.api.method === undefined ? {} : { method: step.api.method }),
      ...(step.api.path === undefined ? {} : { path: step.api.path }),
      ...(step.condition === undefined ? {} : { condition: step.condition }),
      ...(step.extract === undefined ? {} : { extract: Object.keys(step.extract) }),
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

  appendUiRunChunk(run, 'stdout', `\u001b[90m$ openapi-k6 ${args.map(shellQuote).join(' ')}\u001b[0m\n`);
  const stdout = createUiRunWritable(run, 'stdout');
  const stderr = createUiRunWritable(run, 'stderr');
  const testReporter = payload.command === 'test'
    ? createUiScenarioReporter(stdout, state.context.testReporter)
    : state.context.testReporter;

  try {
    await runCli(args, {
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

function createUiScenarioReporter(
  stdout: WritableLike,
  injectedReporter: ScenarioExecutionReporter | undefined,
): ScenarioExecutionReporter {
  const uiReporter = createScenarioConsoleReporter(stdout, {
    color: true,
    live: false,
  });

  return injectedReporter === undefined
    ? uiReporter
    : teeScenarioReporters(uiReporter, injectedReporter);
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

const UI_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>openapi-k6 UI</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --panel-2: #f0f3f8;
      --line: #d9dee8;
      --text: #17202f;
      --muted: #667085;
      --accent: #0f766e;
      --accent-2: #155eef;
      --danger: #b42318;
      --ok-bg: #e7f8ef;
      --ok: #067647;
      --bad-bg: #fff0ee;
      --bad: #b42318;
      --warn-bg: #fff7e6;
      --warn: #a15c07;
      --focus: rgba(21, 94, 239, 0.18);
      --hover: #f7f9fc;
      --shadow: 0 8px 24px rgba(16, 24, 40, 0.06);
      --terminal: #101828;
      --terminal-line: #243047;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 72px;
      padding: 12px 22px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.9);
      position: sticky;
      top: 0;
      z-index: 2;
      backdrop-filter: blur(10px);
    }
    h1 { margin: 0; font-size: 18px; letter-spacing: 0; }
    .subtitle { color: var(--muted); font-size: 13px; }
    .brand { min-width: 220px; }
    .header-meta {
      justify-content: flex-end;
      max-width: 820px;
      min-width: 0;
    }
    main {
      display: grid;
      grid-template-columns: minmax(260px, 320px) minmax(420px, 1fr) minmax(420px, 0.95fr);
      gap: 16px;
      padding: 16px;
      height: calc(100vh - 72px);
    }
    .panel {
      min-height: 0;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .panel-head {
      padding: 14px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: #fbfcfe;
    }
    .panel-title { margin: 0; font-size: 14px; font-weight: 700; }
    .panel-body { padding: 14px; overflow: auto; min-height: 0; }
    input, button {
      font: inherit;
      border-radius: 6px;
    }
    input {
      width: 100%;
      padding: 9px 10px;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--text);
    }
    button {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--text);
      padding: 8px 11px;
      cursor: pointer;
      font-weight: 650;
      white-space: nowrap;
    }
    button:hover:not(:disabled) {
      background: var(--hover);
      border-color: #b8c0cc;
    }
    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }
    button.primary:hover:not(:disabled) { background: #0b665f; }
    button.blue {
      border-color: var(--accent-2);
      background: var(--accent-2);
      color: #fff;
    }
    button.blue:hover:not(:disabled) { background: #104bc5; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    button:focus-visible,
    input:focus-visible,
    summary:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
    }
    .scenario-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
    }
    .scenario-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .scenario-group-title {
      padding: 4px 2px 0;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.2;
      text-transform: uppercase;
    }
    .scenario-item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fff;
      display: block;
      text-align: left;
      width: 100%;
      min-width: 0;
      white-space: normal;
      overflow: hidden;
      transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
    }
    .scenario-item:hover { background: var(--hover); }
    .scenario-item.active {
      border-color: var(--accent);
      background: #f8fdfa;
      box-shadow: inset 3px 0 0 var(--accent);
    }
    .scenario-item-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      align-items: start;
      gap: 8px;
    }
    .scenario-name {
      display: block;
      min-width: 0;
      font-weight: 750;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .scenario-path, .muted {
      min-width: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.3;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .scenario-item .scenario-path,
    .scenario-item .muted {
      display: block;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .stack { display: flex; flex-direction: column; gap: 12px; }
    .section {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fbfcfe;
    }
    #scenarioSummary.section {
      border: 0;
      border-radius: 0;
      padding: 2px 2px 8px;
      background: transparent;
    }
    .section h3 {
      margin: 0 0 8px;
      font-size: 13px;
    }
    details.section {
      padding: 0;
    }
    details.section summary {
      cursor: pointer;
      list-style: none;
      padding: 12px;
      font-size: 13px;
      font-weight: 750;
    }
    details.section summary:hover {
      background: var(--hover);
    }
    details.section summary::-webkit-details-marker { display: none; }
    details.section summary::after {
      content: "Show";
      float: right;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }
    details.section[open] summary {
      border-bottom: 1px solid var(--line);
    }
    details.section[open] summary::after {
      content: "Hide";
    }
    .section-content {
      padding: 12px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      max-width: 100%;
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--panel-2);
      font-size: 12px;
      color: #344054;
      font-weight: 650;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .pill.ok { background: var(--ok-bg); color: var(--ok); }
    .pill.bad { background: var(--bad-bg); color: var(--bad); }
    .pill.warn { background: var(--warn-bg); color: var(--warn); }
    .hint {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      min-width: 220px;
    }
    .hint.warn { color: var(--warn); }
    .hint.bad { color: var(--bad); }
    .steps {
      display: grid;
      gap: 8px;
    }
    .step {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .step-title {
      min-width: 0;
      font-weight: 750;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .actions {
      display: flex;
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    .actions > .button-row {
      display: grid;
      grid-template-columns: repeat(3, max-content);
      gap: 8px;
    }
    .terminal {
      margin: 0;
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 14px;
      background: var(--terminal);
      color: #f3f7ff;
      font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      white-space: pre-wrap;
      border-top: 1px solid var(--terminal-line);
      tab-size: 2;
    }
    .terminal .ansi-bold { font-weight: 800; }
    .terminal .ansi-dim { opacity: 0.68; }
    .terminal .ansi-grey { color: #98a2b3; }
    .terminal .ansi-cyan { color: #67e8f9; }
    .terminal .ansi-green { color: #86efac; }
    .terminal .ansi-yellow { color: #fde68a; }
    .terminal .ansi-red { color: #fda4af; }
    .server-grid { display: grid; gap: 8px; }
    .server {
      display: grid;
      grid-template-columns: minmax(64px, 90px) minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px;
      min-width: 0;
    }
    .server > strong {
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .server-lines {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .server-lines div {
      overflow-wrap: anywhere;
    }
    .empty {
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 18px;
      text-align: center;
    }
    @media (max-width: 1100px) {
      main {
        height: auto;
        grid-template-columns: 1fr;
      }
      header { align-items: flex-start; flex-direction: column; gap: 10px; }
      .header-meta { justify-content: flex-start; }
      .terminal { min-height: 360px; }
    }
    @media (max-height: 560px) and (min-width: 1101px) {
      main {
        height: auto;
        min-height: calc(100vh - 72px);
      }
      .panel { min-height: 300px; }
      .terminal { min-height: 220px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>openapi-k6 UI</h1>
      <div class="subtitle">Scenario validate/test runner</div>
    </div>
    <div class="row header-meta">
      <span id="configPath" class="pill">loading</span>
      <button id="refreshBtn">Refresh</button>
    </div>
  </header>
  <main>
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Scenarios</h2>
        <span id="scenarioCount" class="pill">0</span>
      </div>
      <div class="panel-body">
        <input id="searchInput" placeholder="Search scenarios">
        <div id="scenarioList" class="scenario-list"></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title" id="detailTitle">Scenario</h2>
        <span id="detailStatus" class="pill">not run</span>
      </div>
      <div class="panel-body stack">
        <div id="scenarioSummary" class="section">
          <div class="empty">Choose a scenario from the left.</div>
        </div>
        <details class="section">
          <summary>Target status</summary>
          <div class="section-content">
            <div class="row" style="margin-bottom: 8px;">
              <button id="checkServersBtn">Check servers</button>
              <span id="serverCheckedAt" class="muted"></span>
            </div>
            <div id="serverList" class="server-grid"></div>
          </div>
        </details>
        <details class="section">
          <summary>Scenario details</summary>
          <div id="detailBody" class="section-content empty">Choose a scenario from the left.</div>
        </details>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Run Output</h2>
        <span id="runStatus" class="pill">idle</span>
      </div>
      <div class="actions">
        <div class="button-row">
          <button id="validateBtn" class="blue" disabled>Validate</button>
          <button id="testBtn" class="primary" disabled>Test</button>
          <button id="clearBtn">Clear</button>
        </div>
        <span id="runHint" class="hint">Select a scenario to start.</span>
      </div>
      <pre id="output" class="terminal">Select a scenario and run validate/test.</pre>
    </section>
  </main>
  <script>
    const state = {
      scenarios: [],
      selected: null,
      detail: null,
      lastRun: new Map(),
      serverSummary: { checked: false, failedServers: 0, missingSnapshots: 0 }
    };

    const els = {
      configPath: document.getElementById('configPath'),
      scenarioCount: document.getElementById('scenarioCount'),
      scenarioList: document.getElementById('scenarioList'),
      searchInput: document.getElementById('searchInput'),
      refreshBtn: document.getElementById('refreshBtn'),
      detailTitle: document.getElementById('detailTitle'),
      detailStatus: document.getElementById('detailStatus'),
      scenarioSummary: document.getElementById('scenarioSummary'),
      detailBody: document.getElementById('detailBody'),
      checkServersBtn: document.getElementById('checkServersBtn'),
      serverCheckedAt: document.getElementById('serverCheckedAt'),
      serverList: document.getElementById('serverList'),
      validateBtn: document.getElementById('validateBtn'),
      testBtn: document.getElementById('testBtn'),
      clearBtn: document.getElementById('clearBtn'),
      output: document.getElementById('output'),
      runStatus: document.getElementById('runStatus'),
      runHint: document.getElementById('runHint')
    };

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function resetOutput() {
      els.output.innerHTML = '';
    }

    function appendOutputChunk(chunk) {
      els.output.insertAdjacentHTML('beforeend', chunk.html !== undefined ? chunk.html : escapeHtml(chunk.chunk || ''));
      els.output.scrollTop = els.output.scrollHeight;
    }

    function statusTone(value) {
      const normalized = String(value).toLowerCase();
      if (normalized.includes('passed') || normalized.includes('reachable') || normalized.includes('ready') || normalized.includes('present')) return ' ok';
      if (normalized.includes('failed') || normalized.includes('missing') || normalized.includes('error')) return ' bad';
      if (normalized.includes('running') || normalized.includes('checking') || normalized.includes('warning') || normalized.includes('unknown')) return ' warn';
      return '';
    }

    function setStatus(el, value) {
      el.textContent = value;
      el.className = 'pill' + statusTone(value);
    }

    function setHint(message, tone) {
      els.runHint.textContent = message;
      els.runHint.className = 'hint' + (tone ? ' ' + tone : '');
    }

    function updateRunHint() {
      if (!state.selected) {
        setHint('Select a scenario to start.', '');
      } else if (state.serverSummary.missingSnapshots > 0) {
        setHint('Snapshot missing. Run openapi-k6 sync before validate/test.', 'bad');
      } else if (state.serverSummary.failedServers > 0) {
        setHint('Some servers are unreachable. Validate can run; test may fail.', 'warn');
      } else if (state.serverSummary.checked) {
        setHint('Ready for validate/test.', '');
      } else {
        setHint('Check servers before test if the backend status is unclear.', 'warn');
      }

      els.validateBtn.title = state.serverSummary.missingSnapshots > 0
        ? 'OpenAPI snapshot is missing. Run openapi-k6 sync first.'
        : '';
      els.testBtn.title = state.serverSummary.failedServers > 0
        ? 'One or more target servers are unreachable.'
        : els.validateBtn.title;
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, options);
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || response.statusText);
      }
      return json;
    }

    async function loadScenarios() {
      const data = await fetchJson('/api/scenarios');
      state.scenarios = data.scenarios;
      els.configPath.textContent = data.configPath;
      renderScenarioList();
      if (!state.selected && state.scenarios.length > 0) {
        await selectScenario(state.scenarios[0].id);
      }
      updateRunHint();
    }

    function renderScenarioList() {
      const query = els.searchInput.value.trim().toLowerCase();
      const items = state.scenarios.filter((scenario) => {
        return !query ||
          scenario.name.toLowerCase().includes(query) ||
          scenario.path.toLowerCase().includes(query) ||
          scenario.group.toLowerCase().includes(query);
      });
      els.scenarioCount.textContent = String(items.length);
      const groups = [];
      for (const scenario of items) {
        let group = groups.find((candidate) => candidate.name === scenario.group);
        if (!group) {
          group = { name: scenario.group, scenarios: [] };
          groups.push(group);
        }
        group.scenarios.push(scenario);
      }
      els.scenarioList.innerHTML = groups.map((group) => {
        return '<div class="scenario-group">' +
          '<div class="scenario-group-title">' + escapeHtml(group.name) + '</div>' +
          group.scenarios.map(renderScenarioItem).join('') +
          '</div>';
      }).join('');

      for (const item of els.scenarioList.querySelectorAll('.scenario-item')) {
        item.addEventListener('click', () => selectScenario(item.getAttribute('data-id')));
      }
    }

    function renderScenarioItem(scenario) {
        const status = state.lastRun.get(scenario.id) || (scenario.error ? 'failed' : 'not run');
        return '<button class="scenario-item ' + (state.selected === scenario.id ? 'active' : '') + '" data-id="' + escapeHtml(scenario.id) + '">' +
          '<div class="scenario-item-head"><span class="scenario-name">' + escapeHtml(scenario.name) + '</span><span class="pill ' + (status === 'passed' ? 'ok' : status === 'failed' ? 'bad' : '') + '">' + escapeHtml(status) + '</span></div>' +
          '<div class="scenario-path">' + escapeHtml(scenario.path) + '</div>' +
          '<div class="muted">' + (scenario.stepCount === undefined ? 'parse error' : scenario.stepCount + ' steps') + '</div>' +
          '</button>';
    }

    async function selectScenario(id) {
      state.selected = id;
      renderScenarioList();
      try {
        state.detail = await fetchJson('/api/scenario?scenario=' + encodeURIComponent(id));
        renderDetail();
        els.validateBtn.disabled = false;
        els.testBtn.disabled = false;
      } catch (error) {
        state.detail = null;
        els.detailTitle.textContent = 'Scenario error';
        els.scenarioSummary.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
        els.detailBody.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
        els.validateBtn.disabled = true;
        els.testBtn.disabled = true;
      }
      updateRunHint();
    }

    function renderDetail() {
      const detail = state.detail;
      els.detailTitle.textContent = detail.name;
      setStatus(els.detailStatus, state.lastRun.get(detail.id) || 'not run');
      const referencePills = []
        .concat(detail.modules.map((item) => '<span class="pill">module ' + escapeHtml(item) + '</span>'))
        .concat(detail.env.map((item) => '<span class="pill">env.' + escapeHtml(item) + '</span>'))
        .concat(detail.vars.map((item) => '<span class="pill">vars.' + escapeHtml(item) + '</span>'))
        .concat(detail.includes.map((item) => '<span class="pill">reuse ' + escapeHtml(item) + '</span>'));
      els.scenarioSummary.innerHTML =
        '<div class="stack" style="gap: 8px;">' +
          '<div><strong>' + escapeHtml(detail.name) + '</strong></div>' +
          '<div class="muted">' + escapeHtml(detail.path) + '</div>' +
          '<div class="row"><span class="pill">' + detail.stepCount + (detail.stepCount === 1 ? ' step' : ' steps') + '</span></div>' +
        '</div>';
      const steps = detail.steps.map((step) => {
        const api = step.operationId || ((step.method || '') + ' ' + (step.path || '')).trim();
        const extract = step.extract && step.extract.length ? '<div class="muted">extract: ' + escapeHtml(step.extract.join(', ')) + '</div>' : '';
        return '<div class="step"><div class="step-title">' + escapeHtml(step.id) + '</div><div class="muted">' + escapeHtml(api || 'api') + '</div>' + extract + '</div>';
      }).join('');
      const references = referencePills.length
        ? '<div><h3>References</h3><div class="row">' + referencePills.join('') + '</div></div>'
        : '<div class="muted">No env/vars/module/reuse references detected.</div>';
      els.detailBody.className = 'section-content stack';
      els.detailBody.innerHTML = references + '<div><h3>Steps</h3><div class="steps">' + steps + '</div></div>';
    }

    async function checkServers() {
      setStatus(els.runStatus, 'checking');
      els.serverList.innerHTML = '<div class="empty">Checking servers...</div>';
      try {
        const result = await fetchJson('/api/check-servers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        els.serverCheckedAt.textContent = new Date(result.checkedAt).toLocaleTimeString();
        state.serverSummary = summarizeServerResult(result);
        els.serverList.innerHTML = result.modules.map((module) => {
          const snapshot = module.snapshot || { status: 'missing', error: 'snapshot unknown' };
          const serverMeta = formatServerMeta(module);
          const snapshotMeta = formatSnapshotMeta(snapshot);
          return '<div class="server"><strong>' + escapeHtml(module.name) + '</strong><div class="server-lines"><div>' + escapeHtml(module.baseUrl || 'baseUrl not configured') + '</div><div class="muted">' + escapeHtml(serverMeta) + '</div><div class="muted">' + escapeHtml(snapshotMeta) + '</div></div><span class="pill' + statusTone(module.status) + '">' + escapeHtml(module.status) + '</span></div>';
        }).join('');
      } catch (error) {
        state.serverSummary = { checked: false, failedServers: 0, missingSnapshots: 0 };
        els.serverList.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
      } finally {
        setStatus(els.runStatus, 'idle');
        updateRunHint();
      }
    }

    function summarizeServerResult(result) {
      return {
        checked: true,
        failedServers: result.modules.filter((module) => module.status === 'failed' || module.status === 'unknown').length,
        missingSnapshots: result.modules.filter((module) => !module.snapshot || module.snapshot.status !== 'present').length
      };
    }

    function formatServerMeta(module) {
      const parts = [];
      if (module.source) parts.push(module.source);
      if (module.httpStatus) parts.push('HTTP ' + module.httpStatus);
      if (typeof module.durationMs === 'number') parts.push(module.durationMs + 'ms');
      if (module.error) parts.push(module.error);
      return parts.join(' · ') || 'baseUrl not configured';
    }

    function formatSnapshotMeta(snapshot) {
      const parts = ['snapshot: ' + snapshot.status];
      if (snapshot.path) parts.push(snapshot.path);
      if (snapshot.error) parts.push(snapshot.error);
      return parts.join(' · ');
    }

    async function runCommand(command) {
      if (!state.selected) return;
      setStatus(els.runStatus, 'running');
      resetOutput();
      const result = await fetchJson('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: command, scenario: state.selected })
      });
      const events = new EventSource('/api/runs/' + encodeURIComponent(result.runId) + '/events');
      events.addEventListener('chunk', (event) => {
        const data = JSON.parse(event.data);
        appendOutputChunk(data);
      });
      events.addEventListener('done', (event) => {
        const data = JSON.parse(event.data);
        state.lastRun.set(state.selected, data.status);
        setStatus(els.runStatus, data.status);
        setStatus(els.detailStatus, data.status);
        renderScenarioList();
        updateRunHint();
        events.close();
      });
      events.onerror = () => {
        events.close();
      };
    }

    els.refreshBtn.addEventListener('click', loadScenarios);
    els.searchInput.addEventListener('input', renderScenarioList);
    els.checkServersBtn.addEventListener('click', checkServers);
    els.validateBtn.addEventListener('click', () => runCommand('validate'));
    els.testBtn.addEventListener('click', () => runCommand('test'));
    els.clearBtn.addEventListener('click', () => { resetOutput(); setStatus(els.runStatus, 'idle'); });

    loadScenarios().then(checkServers).catch((error) => {
      els.scenarioList.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
    });
  </script>
</body>
</html>`;

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
    checks.push(...await collectDoctorConfigChecks(cwd, config));
    checks.push(collectDoctorScaffoldCheck(cwd, config, await readScaffoldWarnings(cwd, config)));
  }

  checks.push(collectDoctorK6Check(context));

  return {
    configPath,
    checks,
    passed: checks.every((check) => check.status !== 'fail'),
  };
}

async function collectDoctorConfigChecks(cwd: string, config: LoadTestConfig): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const moduleNames = [...config.modules.keys()];
  const collisions = findModuleBaseUrlEnvNameCollisions(moduleNames);

  checks.push({
    name: 'modules',
    status: 'pass',
    message: `${moduleNames.length} configured (${moduleNames.join(', ')})`,
  });

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

  for (const moduleConfig of config.modules.values()) {
    checks.push(checkOptionalOpenApi(moduleConfig));
    checks.push(await checkConfiguredFile(cwd, config, moduleConfig, 'snapshot'));
    checks.push(await checkConfiguredFile(cwd, config, moduleConfig, 'catalog'));
  }

  return checks;
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
  writeLine(stdout, `  partial   ${formatDisplayPath(cwd, result.partialExamplePath)}`);
  writeLine(stdout, `  fixture   ${formatDisplayPath(cwd, result.dataFixtureExamplePath)}`);
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
  writeLine(stdout, `  partial      ${formatDisplayPath(cwd, result.partialExamplePath)}`);
  writeLine(stdout, `  fixture      ${formatDisplayPath(cwd, result.dataFixtureExamplePath)}`);
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
    ...parseCatalogRequestBodyHint(operation.requestBodyHint),
    ...parseCatalogExtractCandidates(operation.responseExtractCandidates),
  };
}

function parseCatalogRequestBodyHint(
  value: unknown,
): Pick<ApiCatalogOperation, 'requestBodyHint'> | Record<string, never> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;

  if (typeof record.contentType !== 'string') {
    return {};
  }

  if (record.source !== 'example' && record.source !== 'schema') {
    return {};
  }

  const requestBodyHint: ApiCatalogRequestBodyHint = {
    contentType: record.contentType,
    source: record.source,
    example: record.example,
    ...parseCatalogRequestBodyFieldHints(record.fields),
  };

  return { requestBodyHint };
}

function parseCatalogRequestBodyFieldHints(
  value: unknown,
): Pick<ApiCatalogRequestBodyHint, 'fields'> | Record<string, never> {
  if (!Array.isArray(value)) {
    return {};
  }

  const fields: ApiCatalogRequestBodyFieldHint[] = value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (typeof record.path !== 'string') {
      return [];
    }

    return [{
      path: record.path,
      required: record.required === true,
      ...(typeof record.type === 'string' ? { type: record.type } : {}),
      ...(typeof record.placeholder === 'string' ? { placeholder: record.placeholder } : {}),
      ...(typeof record.env === 'string' ? { env: record.env } : {}),
    }];
  });

  return fields.length === 0 ? {} : { fields };
}

function parseCatalogExtractCandidates(
  value: unknown,
): Pick<ApiCatalogOperation, 'responseExtractCandidates'> | Record<string, never> {
  if (!Array.isArray(value)) {
    return {};
  }

  const responseExtractCandidates: ApiCatalogExtractCandidate[] = value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (typeof record.name !== 'string' ||
      typeof record.from !== 'string' ||
      typeof record.status !== 'string') {
      return [];
    }

    return [{
      name: record.name,
      from: record.from,
      status: record.status,
      ...(typeof record.contentType === 'string' ? { contentType: record.contentType } : {}),
    }];
  });

  return responseExtractCandidates.length === 0 ? {} : { responseExtractCandidates };
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

interface CatalogParameterHint {
  location: string;
  name: string;
  required: boolean;
}

function readCatalogParameterLabels(parameters: unknown[]): string[] {
  return readCatalogParameterHints(parameters).map(({ location, name }) => `${location} ${name}`);
}

function readCatalogParameterHints(parameters: unknown[]): CatalogParameterHint[] {
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

    return [{
      location: location ?? 'param',
      name: name ?? '<unnamed>',
      required: record.required === true,
    }];
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
  options: Pick<CatalogOptions, 'ai' | 'json' | 'snippet'>,
): void {
  if (options.json === true) {
    writeLine(stdout, JSON.stringify(formatCatalogJson(result), null, 2));
    return;
  }

  if (options.ai === true) {
    writeCatalogSyncNotice(stdout, result, cwd, false);
    writeCatalogAiGuide(stdout, result, cwd);
    return;
  }

  if (options.snippet === true) {
    writeCatalogSyncNotice(stdout, result, cwd, true);
    writeCatalogSnippets(stdout, result, cwd);
    return;
  }

  writeCatalogSyncNotice(stdout, result, cwd, false);

  if (shouldListCatalogOperations(result.filters)) {
    writeCatalogOperations(stdout, result, cwd);
    return;
  }

  writeCatalogSummary(stdout, result, cwd);
}

function writeCatalogSyncNotice(
  stdout: WritableLike,
  result: CatalogResult,
  cwd: string,
  asComment: boolean,
): void {
  if (result.synced === undefined) {
    return;
  }

  const prefix = asComment ? '# ' : '';

  writeLine(stdout, `${prefix}Synced ${formatDisplayPath(cwd, result.synced.snapshotPath)}`);
  writeLine(stdout, `${prefix}Catalog ${formatDisplayPath(cwd, result.synced.catalogPath)} (${result.synced.operationCount} operations)`);
  writeLine(stdout, '');
}

function writeCatalogAiGuide(stdout: WritableLike, result: CatalogResult, cwd: string): void {
  writeLine(stdout, 'AI scenario authoring guide');
  writeLine(stdout, `Catalog: ${formatDisplayPath(cwd, result.catalogPath)}`);
  writeCatalogFilterSummary(stdout, result);

  if (result.operations.length === 0) {
    writeLine(stdout, '');
    writeLine(stdout, 'No operations matched.');
    writeLine(stdout, 'Try a broader --query, --tag, --method, or use --all.');
    return;
  }

  writeLine(stdout, '');
  writeLine(stdout, 'Rules for AI agents:');
  writeLine(stdout, '  - Use operationId first. If it is missing or ambiguous, use api.method and api.path.');
  writeLine(stdout, '  - Map path/query/header parameters to request.pathParams/request.query/request.headers.');
  writeLine(stdout, `  - Keep secrets in ${DEFAULT_LOAD_TEST_DIR}/.env and reference them as {{env.NAME}}.`);
  writeLine(stdout, '  - Fill request body values from the OpenAPI schema or real API contract before test.');
  writeLine(stdout, '  - Replace every <...> placeholder before validate/test.');
  writeLine(stdout, '  - Add extract only after checking the real response JSON path.');

  if (result.operations.length > 1) {
    writeLine(stdout, '');
    writeLine(stdout, 'Multiple operations matched.');
    writeLine(stdout, '  - Do not pick one arbitrarily.');
    writeLine(stdout, '  - Narrow with a more specific --query, --tag, --method, or operationId keyword.');
    writeLine(stdout, '  - If the user intent is ambiguous, ask which operation to use before writing scenario YAML.');
  }

  for (const [index, operation] of result.operations.entries()) {
    writeLine(stdout, '');
    writeLine(stdout, `Operation ${index + 1}: ${operation.operationId ?? `${operation.method} ${operation.path}`}`);
    writeLine(stdout, `  method: ${operation.method.toUpperCase()}`);
    writeLine(stdout, `  path: ${operation.path}`);

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

    writeCatalogAiScenarioMapping(stdout, operation);

    writeLine(stdout, '');
    writeLine(stdout, 'Suggested scenario step:');
    writeLine(stdout, '```yaml');

    for (const line of renderCatalogScenarioStepSnippet(operation, result.moduleName)) {
      writeLine(stdout, line);
    }

    writeLine(stdout, '```');
  }
}

function writeCatalogSnippets(stdout: WritableLike, result: CatalogResult, cwd: string): void {
  writeLine(stdout, `# Catalog: ${formatDisplayPath(cwd, result.catalogPath)}`);

  if (result.moduleName !== undefined) {
    writeLine(stdout, `# Module: ${result.moduleName}`);
  }

  if (result.operations.length === 0) {
    writeLine(stdout, '# No operations matched.');
    return;
  }

  for (const [index, operation] of result.operations.entries()) {
    if (index > 0) {
      writeLine(stdout, '');
    }

    for (const line of renderCatalogScenarioStepSnippet(operation, result.moduleName)) {
      writeLine(stdout, line);
    }
  }
}

function writeCatalogFilterSummary(stdout: WritableLike, result: CatalogResult): void {
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
}

function writeCatalogAiScenarioMapping(stdout: WritableLike, operation: ApiCatalogOperation): void {
  const parametersByRequestKey = [
    ['pathParams', readCatalogParametersByLocation(operation.parameters, 'path')],
    ['query', readCatalogParametersByLocation(operation.parameters, 'query')],
    ['headers', readCatalogParametersByLocation(operation.parameters, 'header')],
  ] as const;
  const extractCandidates = operation.responseExtractCandidates ?? [];
  const shouldPrint = operation.hasRequestBody ||
    extractCandidates.length > 0 ||
    parametersByRequestKey.some(([, parameters]) => parameters.length > 0);

  if (!shouldPrint) {
    return;
  }

  writeLine(stdout, '  scenario mapping:');

  for (const [requestKey, parameters] of parametersByRequestKey) {
    if (parameters.length === 0) {
      continue;
    }

    writeLine(stdout, `    request.${requestKey}:`);

    for (const parameter of parameters) {
      const requiredLabel = parameter.required ? 'required' : 'optional';
      writeLine(stdout, `      - ${parameter.name} (${requiredLabel})`);
    }
  }

  if (operation.hasRequestBody) {
    for (const line of formatCatalogAiBodyMappingLines(operation)) {
      writeLine(stdout, `    ${line}`);
    }
  }

  if (extractCandidates.length > 0) {
    writeLine(stdout, '    response extract candidates:');

    for (const candidate of extractCandidates) {
      for (const line of formatCatalogExtractCandidateMappingLines(candidate)) {
        writeLine(stdout, `      ${line}`);
      }
    }
  }
}

function readCatalogParametersByLocation(
  parameters: unknown[],
  location: string,
): CatalogParameterHint[] {
  return readCatalogParameterHints(parameters)
    .filter((parameter) => parameter.location.toLowerCase() === location);
}

function formatCatalogAiBodyMappingLines(operation: ApiCatalogOperation): string[] {
  if (isMultipartCatalogOperation(operation)) {
    const contentTypes = operation.requestBodyContentTypes?.join(', ') ?? 'multipart/form-data';
    return [`request.multipart: ${contentTypes}`];
  }

  if (operation.requestBodyHint !== undefined) {
    const lines = [
      [
        `request.body: ${operation.requestBodyHint.contentType}`,
        `${operation.requestBodyHint.source} example`,
      ].join('; '),
    ];
    const fieldHints = operation.requestBodyHint.fields ?? [];

    if (fieldHints.length > 0) {
      lines.push('  fields:');
      lines.push(...fieldHints.map((field) => `    - ${formatCatalogBodyFieldHint(field)}`));
      return lines;
    }

    const fields = formatCatalogBodyHintFields(operation.requestBodyHint.example);

    if (fields.length > 0) {
      lines[0] += `; fields: ${fields.join(', ')}`;
    }

    return lines;
  }

  return [`request.body: ${formatCatalogBody(operation)}`];
}

function formatCatalogBodyFieldHint(field: ApiCatalogRequestBodyFieldHint): string {
  return [
    `${field.path}: ${field.type ?? 'value'}`,
    field.required ? 'required' : 'optional',
    ...(field.placeholder === undefined ? [] : [`placeholder ${field.placeholder}`]),
    ...(field.env === undefined ? [] : [`env ${field.env}`]),
  ].join(', ');
}

function formatCatalogBodyHintFields(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value as Record<string, unknown>);
}

function formatCatalogExtractCandidateSource(candidate: ApiCatalogExtractCandidate): string {
  return [
    candidate.status,
    candidate.contentType,
  ].filter((value) => value !== undefined).join(' ');
}

function formatCatalogExtractCandidateMappingLines(
  candidate: ApiCatalogExtractCandidate,
): string[] {
  const lines = [
    `- ${candidate.name} <- ${candidate.from} (${formatCatalogExtractCandidateSource(candidate)})`,
    '  yaml:',
    '    extract:',
    `      ${formatYamlKey(candidate.name)}:`,
    `        from: ${candidate.from}`,
  ];
  const nextUse = formatCatalogExtractNextUse(candidate.name);

  if (nextUse !== undefined) {
    lines.push('  likely next use:');
    lines.push(`    ${nextUse}`);
  }

  return lines;
}

function formatCatalogExtractNextUse(candidateName: string): string | undefined {
  const normalized = candidateName.toLowerCase();

  if (normalized.includes('token')) {
    return `request.headers.Authorization: "Bearer {{${candidateName}}}"`;
  }

  if (normalized.endsWith('id') || normalized.endsWith('uuid')) {
    return `request.pathParams.${candidateName}: "{{${candidateName}}}"`;
  }

  return undefined;
}

function renderCatalogScenarioStepSnippet(
  operation: ApiCatalogOperation,
  moduleName: string | undefined,
): string[] {
  const lines = [
    `# ${operation.method.toUpperCase()} ${operation.path}`,
    `- id: ${formatYamlPlainValue(formatCatalogScenarioStepId(operation))}`,
    '  api:',
  ];

  if (moduleName !== undefined) {
    lines.push(`    module: ${formatYamlPlainValue(moduleName)}`);
  }

  if (operation.operationId !== undefined) {
    lines.push(`    operationId: ${formatYamlPlainValue(operation.operationId)}`);
  } else {
    lines.push(`    method: ${formatYamlPlainValue(operation.method.toUpperCase())}`);
    lines.push(`    path: ${formatYamlString(operation.path)}`);
  }

  const requestLines = renderCatalogRequestSnippet(operation);

  if (requestLines.length > 0) {
    lines.push('  request:');
    lines.push(...requestLines.map((line) => `    ${line}`));
  }

  lines.push('  condition: status < 300');
  lines.push(...renderCatalogExtractCandidateComments(operation));

  return lines;
}

function renderCatalogRequestSnippet(operation: ApiCatalogOperation): string[] {
  const lines: string[] = [];

  appendCatalogParameterGroup(lines, operation, 'pathParams', 'path');
  appendCatalogParameterGroup(lines, operation, 'query', 'query');
  appendCatalogParameterGroup(lines, operation, 'headers', 'header');

  if (operation.hasRequestBody) {
    if (isMultipartCatalogOperation(operation)) {
      lines.push('multipart:');
      lines.push('  fields: {}');
      lines.push('  files: {}');
    } else if (operation.requestBodyHint !== undefined) {
      appendCatalogYamlField(lines, 'body', operation.requestBodyHint.example, 0);
    } else {
      lines.push('body: {}');
    }
  }

  return lines;
}

function renderCatalogExtractCandidateComments(operation: ApiCatalogOperation): string[] {
  const candidates = operation.responseExtractCandidates ?? [];

  if (candidates.length === 0) {
    return [];
  }

  return [
    '  # extract candidates:',
    ...candidates.flatMap((candidate) => [
      `  #   ${formatYamlKey(candidate.name)}:`,
      `  #     from: ${candidate.from}`,
    ]),
  ];
}

function appendCatalogParameterGroup(
  lines: string[],
  operation: ApiCatalogOperation,
  requestKey: 'headers' | 'pathParams' | 'query',
  location: string,
): void {
  const parameters = readCatalogParameterHints(operation.parameters)
    .filter((parameter) => parameter.location.toLowerCase() === location);

  if (parameters.length === 0) {
    return;
  }

  lines.push(`${requestKey}:`);

  for (const parameter of parameters) {
    const optionalSuffix = parameter.required ? '' : ' # optional';
    lines.push(`  ${formatYamlKey(parameter.name)}: ${formatYamlString(`<${parameter.name}>`)}${optionalSuffix}`);
  }
}

function appendCatalogYamlField(lines: string[], key: string, value: unknown, indent: number): void {
  const prefix = ' '.repeat(indent);

  if (isYamlScalar(value)) {
    lines.push(`${prefix}${formatYamlKey(key)}: ${formatYamlScalar(value)}`);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${prefix}${formatYamlKey(key)}: []`);
      return;
    }

    lines.push(`${prefix}${formatYamlKey(key)}:`);
    appendCatalogYamlArray(lines, value, indent + 2);
    return;
  }

  if (!value || typeof value !== 'object') {
    lines.push(`${prefix}${formatYamlKey(key)}: ${formatYamlString('<value>')}`);
    return;
  }

  const entries = Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) {
    lines.push(`${prefix}${formatYamlKey(key)}: {}`);
    return;
  }

  lines.push(`${prefix}${formatYamlKey(key)}:`);

  for (const [childKey, childValue] of entries) {
    appendCatalogYamlField(lines, childKey, childValue, indent + 2);
  }
}

function appendCatalogYamlArray(lines: string[], value: unknown[], indent: number): void {
  const prefix = ' '.repeat(indent);

  for (const item of value) {
    if (isYamlScalar(item)) {
      lines.push(`${prefix}- ${formatYamlScalar(item)}`);
      continue;
    }

    if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(`${prefix}- []`);
      } else {
        lines.push(`${prefix}-`);
        appendCatalogYamlArray(lines, item, indent + 2);
      }
      continue;
    }

    if (!item || typeof item !== 'object') {
      lines.push(`${prefix}- ${formatYamlString('<value>')}`);
      continue;
    }

    const entries = Object.entries(item as Record<string, unknown>);

    if (entries.length === 0) {
      lines.push(`${prefix}- {}`);
      continue;
    }

    lines.push(`${prefix}-`);

    for (const [childKey, childValue] of entries) {
      appendCatalogYamlField(lines, childKey, childValue, indent + 2);
    }
  }
}

function formatCatalogScenarioStepId(operation: ApiCatalogOperation): string {
  const source = operation.operationId ?? `${operation.method}-${operation.path}`;
  const value = source
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return value || 'step';
}

function isMultipartCatalogOperation(operation: ApiCatalogOperation): boolean {
  return operation.requestBodyContentTypes
    ?.some((contentType) => contentType.toLowerCase().includes('multipart/form-data')) === true;
}

function formatYamlKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    ? value
    : formatYamlString(value);
}

function formatYamlPlainValue(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value)
    ? value
    : formatYamlString(value);
}

function isYamlScalar(value: unknown): value is string | number | boolean | null {
  return value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean';
}

function formatYamlScalar(value: string | number | boolean | null): string {
  if (typeof value === 'string') {
    return formatYamlString(value);
  }

  if (value === null) {
    return 'null';
  }

  return String(value);
}

function formatYamlString(value: string): string {
  return JSON.stringify(value);
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
    ...(result.synced === undefined ? {} : { synced: result.synced }),
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
  writeLine(stdout, '  openapi-k6 catalog --query <query>');
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

function collectRepeatedOption(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export function createProgram(context: CliContext = {}): Command {
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const program = new Command();

  program
    .name('openapi-k6')
    .description('Generate k6 scripts from OpenAPI specs and Scenario DSL files.')
    .version(CLI_VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (value) => stdout.write(value),
      writeErr: (value) => stderr.write(value),
    });

  program
    .command('init')
    .description('Create an openapi-k6 workspace in the target project.')
    .option('--dir <path>', 'openapi-k6 workspace directory path', DEFAULT_LOAD_TEST_DIR)
    .option('-m, --module <name>', 'Initial module name', 'default')
    .option('--base-url <url>', 'API base URL for generated k6 scripts')
    .option('--openapi <path-or-url>', 'OpenAPI spec file path or URL')
    .option('--smoke-path <path>', 'Smoke scenario GET endpoint path', '/health')
    .option('--force', 'Overwrite existing scaffold files')
    .option('--sync', 'Run sync after creating the scaffold')
    .option('--no-input', 'Do not prompt for missing init values')
    .action(async (options: InitOptions) => {
      const result = await runInitCommand(options, context);
      writeInitSummary(stdout, result, options, resolveCwd(context));
    });

  program
    .command('update')
    .description('Update existing openapi-k6 workspace files without touching config or scenarios.')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .action(async (options: UpdateOptions) => {
      const result = await runUpdateCommand(options, context);
      writeUpdateSummary(stdout, result, resolveCwd(context));
    });

  program
    .command('install-skill')
    .description('Install the bundled openapi-k6 Codex skill.')
    .option('--agent <agent>', 'Agent to install for (currently only codex)', 'codex')
    .option('--target-dir <path>', `Install to a custom skill directory instead of ~/.codex/skills/${CODEX_SKILL_NAME}`)
    .option('--force', 'Replace an existing installed skill')
    .option('--dry-run', 'Print source and target paths without writing files')
    .option('--yes', 'Accepted for agent-driven flows; install-skill does not prompt')
    .action(async (options: InstallSkillOptions) => {
      const result = await runInstallSkillCommand(options, context);
      writeInstallSkillSummary(stdout, result, resolveCwd(context));
    });

  program
    .command('doctor')
    .description('Check config, snapshots, catalogs, scaffold metadata, module env names, and k6 availability.')
    .option('--config <path>', 'Load test config file path')
    .option('--json', 'Print JSON output')
    .action(async (options: DoctorOptions) => {
      const result = await runDoctorCommand(options, context);
      writeDoctorOutput(stdout, result, resolveCwd(context), options.json);

      if (!result.passed) {
        throw new CommanderError(1, 'openapi-k6.doctor.failed', 'Doctor checks failed');
      }
    });

  program
    .command('ui')
    .description('Start a local web UI for selecting scenarios and running validate/test.')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--host <host>', 'Host to bind (defaults to 127.0.0.1)')
    .option('--port <port>', 'Port to bind (defaults to 3766 and tries nearby ports)')
    .action(async (options: UiOptions) => {
      await runUiCommand(options, context);
    });

  program
    .command('generate')
    .description('Generate a k6 script for the configured scenario.')
    .requiredOption('-s, --scenario <path-or-key>', 'Scenario DSL file path or openapi-k6 scenario key')
    .option('-o, --openapi <path>', 'OpenAPI spec file path')
    .option('-w, --write <path>', `Output k6 script path (defaults to ${DEFAULT_LOAD_TEST_DIR}/generated/<scenario-key>.k6.js)`)
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--var-file <path>', 'Load scenario vars from a YAML object file; repeatable', collectRepeatedOption)
    .option('--var <name=value>', 'Override one scenario var; repeatable and parsed as a YAML value', collectRepeatedOption)
    .action(async (options: GenerateOptions) => {
      const result = await runGenerateCommand(options, context);
      writeValidationWarnings(stdout, result.warnings);
      writeScaffoldUpdateNotice(stdout, result.scaffoldWarnings ?? [], result.scaffoldUpdateCommand);
      writeLine(stdout, `Generated ${result.outputPath}`);
    });

  program
    .command('run')
    .description('Validate, generate, and run a scenario with k6.')
    .requiredOption('-s, --scenario <path-or-key>', 'Scenario DSL file path or openapi-k6 scenario key')
    .option('-w, --write <path>', `Output k6 script path (defaults to ${DEFAULT_LOAD_TEST_DIR}/generated/<scenario-key>.k6.js)`)
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--var-file <path>', 'Load scenario vars from a YAML object file; repeatable', collectRepeatedOption)
    .option('--var <name=value>', 'Override one scenario var; repeatable and parsed as a YAML value', collectRepeatedOption)
    .option('--log', `Save k6 output to ${DEFAULT_LOAD_TEST_DIR}/logs/<scenario-key>.log`)
    .option('--trace', 'Print OpenAPI step start/end logs from the generated k6 script')
    .option('--report', `Export k6 Web Dashboard HTML to ${DEFAULT_LOAD_TEST_DIR}/logs/<scenario-key>-report.html`)
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
      writeSyncSummary(stdout, result, options, resolveCwd(context));
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
    .option('--sync', 'Run sync before reading the catalog')
    .option('--ai', 'Print AI-friendly scenario authoring guidance')
    .option('--snippet', 'Print scenario YAML step snippets')
    .option('--json', 'Print JSON output')
    .action(async (options: CatalogOptions) => {
      const result = await runCatalogCommand(options, context);
      writeCatalogOutput(stdout, result, resolveCwd(context), options);
    });

  const moduleCommand = program
    .command('module')
    .description(`Manage OpenAPI modules in ${DEFAULT_CONFIG_PATH}.`);

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
    .requiredOption('-s, --scenario <path-or-key>', 'Scenario DSL file path or openapi-k6 scenario key')
    .option('-o, --openapi <path>', 'OpenAPI spec file path')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--var-file <path>', 'Load scenario vars from a YAML object file; repeatable', collectRepeatedOption)
    .option('--var <name=value>', 'Override one scenario var; repeatable and parsed as a YAML value', collectRepeatedOption)
    .action(async (options: ValidateOptions) => {
      const result = await runValidateCommand(options, context);
      writeValidateSummary(stdout, result, resolveCwd(context));
    });

  program
    .command('test')
    .description('Run a scenario once with Node.js to validate API flow before generating k6.')
    .requiredOption('-s, --scenario <path-or-key>', 'Scenario DSL file path or openapi-k6 scenario key')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--var-file <path>', 'Load scenario vars from a YAML object file; repeatable', collectRepeatedOption)
    .option('--var <name=value>', 'Override one scenario var; repeatable and parsed as a YAML value', collectRepeatedOption)
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
      writeScaffoldUpdateNotice(stdout, result.scaffoldWarnings ?? [], result.scaffoldUpdateCommand);

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
