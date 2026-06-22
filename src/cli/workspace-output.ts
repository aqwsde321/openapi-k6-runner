import path from 'node:path';

import type {
  InitOptions,
  InitResult,
  InstallSkillResult,
  SyncOptions,
  SyncResult,
  UpdateResult,
} from './types.js';
import {
  formatDisplayPath,
  initStatusSymbol,
  shellQuote,
  writeLine,
  type WritableLike,
} from './display.js';
import { DEFAULT_LOAD_TEST_DIR } from './workspace-paths.js';

const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;

export function writeInitSummary(
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

export function writeSyncSummary(
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

export function writeUpdateSummary(
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

export function writeInstallSkillSummary(
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
