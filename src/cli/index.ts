#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURRENT_SCAFFOLD_VERSION,
} from '../scaffold/load-test.init.js';
import {
  writeCatalogOutput,
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
  runModuleAddCommand,
  runModuleListCommand,
  runModuleRemoveCommand,
  runModuleSetDefaultCommand,
} from './module-command.js';
import {
  writeModuleAddSummary,
  writeModuleListOutput,
  writeModuleRemoveSummary,
  writeModuleSetDefaultSummary,
} from './module-output.js';
import { writeDoctorOutput } from './doctor-output.js';
import { runDoctorCommand } from './doctor-command.js';
import {
  runCatalogCommand,
  runSyncCommand,
} from './catalog-command.js';
import {
  runGenerateCommand,
  runRunCommand,
  runTestCommand,
  runValidateCommand,
} from './scenario-command.js';
import {
  runInitCommand,
  runInstallSkillCommand,
  runUpdateCommand,
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
import type {
  CliContext,
  UiOptions,
  UiResult,
} from './types.js';

export type {
  CatalogOptions,
  CatalogResult,
  CliContext,
  DoctorCheck,
  DoctorOptions,
  DoctorResult,
  GenerateOptions,
  GenerateResult,
  InitOptions,
  InitResult,
  InstallSkillOptions,
  InstallSkillResult,
  ModuleAddOptions,
  ModuleAddResult,
  ModuleListItem,
  ModuleListOptions,
  ModuleListResult,
  ModuleRemoveOptions,
  ModuleRemoveResult,
  ModuleScenarioReference,
  ModuleSetDefaultOptions,
  ModuleSetDefaultResult,
  RunOptions,
  RunResult,
  SyncOptions,
  SyncResult,
  TestOptions,
  TestResult,
  UiOptions,
  UiResult,
  UpdateOptions,
  UpdateResult,
  ValidateOptions,
  ValidateResult,
} from './types.js';

export {
  runCatalogCommand,
  runSyncCommand,
} from './catalog-command.js';
export { runDoctorCommand } from './doctor-command.js';
export {
  runModuleAddCommand,
  runModuleListCommand,
  runModuleRemoveCommand,
  runModuleSetDefaultCommand,
} from './module-command.js';
export {
  runGenerateCommand,
  runRunCommand,
  runTestCommand,
  runValidateCommand,
} from './scenario-command.js';
export {
  runInitCommand,
  runInstallSkillCommand,
  runUpdateCommand,
} from './workspace-command.js';

const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;
const CLI_VERSION = CURRENT_SCAFFOLD_VERSION;
const CODEX_SKILL_NAME = 'openapi-k6-scenario';

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
}

export async function runUiCommand(
  options: UiOptions,
  context: CliContext = {},
): Promise<UiResult> {
  return runUiServerCommand(options, context, { runCli });
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
