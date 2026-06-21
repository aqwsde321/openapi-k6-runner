#!/usr/bin/env node
import { CommanderError } from 'commander';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli as runCliImpl } from './program.js';

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
  createProgram,
  runCli,
  runUiCommand,
} from './program.js';
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

async function main(): Promise<void> {
  try {
    await runCliImpl();
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
