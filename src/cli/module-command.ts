import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  loadTestConfig,
  resolveConfigFilePath,
  type LoadTestConfig,
} from '../config/load-test.config.js';
import {
  removeModuleConfigEntry,
  resolveDefaultAfterModuleRemoval,
  writeDefaultModuleConfig,
  writeModuleConfigEntry,
} from '../config/load-test.config.writer.js';
import { syncOpenApiSnapshot } from '../openapi/openapi.catalog.js';
import { parseScenarioFile } from '../parser/scenario.parser.js';
import type {
  CliContext,
  ModuleAddOptions,
  ModuleAddResult,
  ModuleListOptions,
  ModuleListResult,
  ModuleRemoveOptions,
  ModuleRemoveResult,
  ModuleSetDefaultOptions,
  ModuleSetDefaultResult,
} from './types.js';
import { formatDisplayPath, normalizeCommandPath, type WritableLike } from './display.js';
import {
  buildDefaultOpenApiUrl,
  isHttpUrl,
  normalizeBaseUrlInput,
  resolveOpenApiForInit,
} from './init-openapi.js';
import {
  DEFAULT_LOAD_TEST_DIR,
  isScenarioFile,
} from './workspace-paths.js';

const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;

interface ModuleScenarioReference {
  scenarioPath: string;
  stepId: string;
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

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
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
  const resolvedConfigPath = path.resolve(cwd, configPath ?? DEFAULT_CONFIG_PATH);

  try {
    return await loadTestConfig(resolvedConfigPath);
  } catch (error) {
    if (configPath === undefined && isNodeErrorCode(error, 'ENOENT')) {
      throw new Error(`${DEFAULT_CONFIG_PATH} was not found. Run openapi-k6 init or pass --config.`);
    }

    throw error;
  }
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

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === code,
  );
}
