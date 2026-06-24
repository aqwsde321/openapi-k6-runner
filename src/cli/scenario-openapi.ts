import { parse as parseDotEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  resolveConfigFilePath,
  resolveConfigModule,
  type LoadTestConfig,
  type LoadTestModuleConfig,
} from '../config/load-test.config.js';
import {
  createModuleBaseUrlEnvName,
  findModuleBaseUrlEnvNameCollisions,
} from '../core/module-env.js';
import { isInputStep, type ApiRegistry, type Scenario } from '../core/types.js';
import { parseOpenApiFile } from '../openapi/openapi.parser.js';
import {
  formatMissingConfigValueError,
  isConfiguredValue,
  normalizeConfiguredValue,
  resolveConfiguredOpenApiInput,
  resolveOpenApiInput,
} from './config-input.js';

export interface ScenarioOpenApiContext {
  registrySource: ApiRegistry | Map<string, ApiRegistry>;
  defaultModuleName?: string;
  openapiPath: string;
  openapiPaths?: Record<string, string>;
  baseUrl?: string;
  moduleBaseUrls?: Record<string, string>;
  moduleName?: string;
  moduleNames?: string[];
}

interface ScenarioModuleUse {
  moduleName: string;
  stepId: string;
  explicit: boolean;
}

export async function loadScenarioOpenApiContext(options: {
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
  return scenario.steps.flatMap((step) => {
    if (isInputStep(step) || step.api.module === undefined) {
      return [];
    }

    return [{ moduleName: step.api.module, stepId: step.id, explicit: true }];
  });
}

function resolveFallbackModuleForScenario(
  config: LoadTestConfig,
  moduleName: string | undefined,
  scenario: Scenario,
): LoadTestModuleConfig | undefined {
  const hasUnqualifiedStep = scenario.steps.some((step) =>
    !isInputStep(step) && step.api.module === undefined);

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
    if (isInputStep(step)) {
      continue;
    }

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
