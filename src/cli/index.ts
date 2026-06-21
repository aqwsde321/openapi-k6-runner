#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveConfigModule,
  type LoadTestConfig,
  type LoadTestModuleConfig,
} from '../config/load-test.config.js';
import type { Scenario } from '../core/types.js';
import {
  executeAstScenario,
  type ScenarioExecutionReporter,
  type ScenarioExecutionResult,
} from '../executor/scenario.executor.js';
import { syncOpenApiSnapshot } from '../openapi/openapi.catalog.js';
import {
  CURRENT_SCAFFOLD_VERSION,
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
import {
  writeModuleAddSummary,
  writeModuleListOutput,
  writeModuleRemoveSummary,
  writeModuleSetDefaultSummary,
} from './module-output.js';
import { loadLoadTestEnv } from './load-test-env.js';
import { loadOptionalConfig } from './optional-config.js';
import { runDoctorCommand as runDoctorCommandImpl } from './doctor-command.js';
import { runK6Script } from './k6-runner.js';

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
  return runDoctorCommandImpl(options, context);
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
