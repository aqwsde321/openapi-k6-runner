#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { parse as parseDotEnv } from 'dotenv';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, realpathSync, type WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
import type { Scenario } from '../core/types.js';
import {
  executeAstScenario,
  type ScenarioExecutionReporter,
  type ScenarioExecutionResult,
} from '../executor/scenario.executor.js';
import { syncOpenApiSnapshot } from '../openapi/openapi.catalog.js';
import { parseOpenApiFile } from '../openapi/openapi.parser.js';
import {
  CURRENT_SCAFFOLD_VERSION,
  SCAFFOLD_METADATA_FILENAME,
  initLoadTests,
  updateLoadTests,
} from '../scaffold/load-test.init.js';
import {
  prepareGeneratedK6Script,
  validateAndBuildAst,
  validateScenarioOpenApi,
} from './scenario-script.js';
import { loadScenarioOpenApiContext } from './scenario-openapi.js';
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
import {
  isConfiguredValue,
  normalizeConfiguredValue,
  resolveConfiguredFilePath,
  resolveConfiguredOpenApiInput,
} from './config-input.js';
import {
  formatDisplayPath,
  initStatusSymbol,
  shellQuote,
  writeLine,
  type WritableLike,
} from './display.js';
import {
  DEFAULT_LOAD_TEST_DIR,
  parseWorkspaceScenarioFile,
  resolveLoadTestDir,
  resolveOutputPath,
  resolveScenarioOutputStem,
  resolveScenarioPath,
} from './workspace-paths.js';
import {
  formatScaffoldUpdateCommand,
  readScaffoldWarnings,
  resolveScaffoldUpdateCommand,
} from './scaffold-status.js';
import { resolveInitOptionsInteractively } from './init-openapi.js';
import {
  runModuleAddCommand as runModuleAddCommandImpl,
  runModuleListCommand as runModuleListCommandImpl,
  runModuleRemoveCommand as runModuleRemoveCommandImpl,
  runModuleSetDefaultCommand as runModuleSetDefaultCommandImpl,
} from './module-command.js';

export type { CatalogResult } from './catalog.js';

type ReadableLike = NodeJS.ReadableStream & {
  isTTY?: boolean;
};

const LEGACY_DEFAULT_LOAD_TEST_DIR = 'load-tests';
const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;
const LEGACY_DEFAULT_CONFIG_PATH = `${LEGACY_DEFAULT_LOAD_TEST_DIR}/config.yaml`;
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

function assertModuleOptionHasConfig(
  config: LoadTestConfig | undefined,
  moduleName: string | undefined,
): void {
  if (config === undefined && moduleName !== undefined) {
    throw new Error('--module requires --config');
  }
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
  return runModuleListCommandImpl(options, context);
}

export async function runModuleAddCommand(
  options: ModuleAddOptions,
  context: CliContext = {},
): Promise<ModuleAddResult> {
  return runModuleAddCommandImpl(options, context);
}

export async function runModuleSetDefaultCommand(
  options: ModuleSetDefaultOptions,
  context: CliContext = {},
): Promise<ModuleSetDefaultResult> {
  return runModuleSetDefaultCommandImpl(options, context);
}

export async function runModuleRemoveCommand(
  options: ModuleRemoveOptions,
  context: CliContext = {},
): Promise<ModuleRemoveResult> {
  return runModuleRemoveCommandImpl(options, context);
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
