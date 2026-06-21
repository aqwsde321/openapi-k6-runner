import path from 'node:path';

import type {
  ModuleAddResult,
  ModuleListResult,
  ModuleRemoveResult,
  ModuleSetDefaultResult,
} from './types.js';
import {
  formatDisplayPath,
  shellQuote,
  writeLine,
  type WritableLike,
} from './display.js';
import { DEFAULT_LOAD_TEST_DIR } from './workspace-paths.js';

const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;

export function writeModuleListOutput(
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

export function writeModuleAddSummary(stdout: WritableLike, result: ModuleAddResult, cwd: string): void {
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

export function writeModuleSetDefaultSummary(
  stdout: WritableLike,
  result: ModuleSetDefaultResult,
  cwd: string,
): void {
  writeLine(stdout, `Default module set to ${result.defaultModule} in ${formatDisplayPath(cwd, result.configPath)}`);
}

export function writeModuleRemoveSummary(stdout: WritableLike, result: ModuleRemoveResult, cwd: string): void {
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
