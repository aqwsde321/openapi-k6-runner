#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type ScenarioExecutionReporter,
  type ScenarioExecutionResult,
} from '../executor/scenario.executor.js';
import {
  CURRENT_SCAFFOLD_VERSION,
} from '../scaffold/load-test.init.js';
import {
  writeCatalogOutput,
  type CatalogResult,
} from './catalog.js';
import { createCliProgram } from './program.js';
import { runUiServerCommand } from './ui/server.js';
import {
  writeLine,
  type WritableLike,
} from './display.js';
import {
  DEFAULT_LOAD_TEST_DIR,
} from './workspace-paths.js';
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
import { writeDoctorOutput } from './doctor-output.js';
import { runDoctorCommand as runDoctorCommandImpl } from './doctor-command.js';
import {
  runCatalogCommand as runCatalogCommandImpl,
  runSyncCommand as runSyncCommandImpl,
} from './catalog-command.js';
import {
  runGenerateCommand as runGenerateCommandImpl,
  runRunCommand as runRunCommandImpl,
  runTestCommand as runTestCommandImpl,
  runValidateCommand as runValidateCommandImpl,
} from './scenario-command.js';
import {
  runInitCommand as runInitCommandImpl,
  runInstallSkillCommand as runInstallSkillCommandImpl,
  runUpdateCommand as runUpdateCommandImpl,
} from './workspace-command.js';
import {
  writeScaffoldUpdateNotice,
  writeValidateSummary,
  writeValidationWarnings,
} from './scenario-output.js';
import {
  writeInitSummary,
  writeInstallSkillSummary,
  writeSyncSummary,
  writeUpdateSummary,
} from './workspace-output.js';

export type { CatalogResult } from './catalog.js';

type ReadableLike = NodeJS.ReadableStream & {
  isTTY?: boolean;
};

const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;
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

export async function runGenerateCommand(
  options: GenerateOptions,
  context: CliContext = {},
): Promise<GenerateResult> {
  return runGenerateCommandImpl(options, context);
}

export async function runRunCommand(
  options: RunOptions,
  context: CliContext = {},
): Promise<RunResult> {
  return runRunCommandImpl(options, context);
}

export async function runValidateCommand(
  options: ValidateOptions,
  context: CliContext = {},
): Promise<ValidateResult> {
  return runValidateCommandImpl(options, context);
}

export async function runSyncCommand(
  options: SyncOptions,
  context: CliContext = {},
): Promise<SyncResult> {
  return runSyncCommandImpl(options, context);
}

export async function runCatalogCommand(
  options: CatalogOptions,
  context: CliContext = {},
): Promise<CatalogResult> {
  return runCatalogCommandImpl(options, context);
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
  return runTestCommandImpl(options, context);
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
  return runInitCommandImpl(options, context);
}

export async function runUpdateCommand(
  options: UpdateOptions,
  context: CliContext = {},
): Promise<UpdateResult> {
  return runUpdateCommandImpl(options, context);
}

export async function runInstallSkillCommand(
  options: InstallSkillOptions,
  context: CliContext = {},
): Promise<InstallSkillResult> {
  return runInstallSkillCommandImpl(options, context);
}

export async function runDoctorCommand(
  options: DoctorOptions,
  context: CliContext = {},
): Promise<DoctorResult> {
  return runDoctorCommandImpl(options, context);
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
