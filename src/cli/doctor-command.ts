import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  resolveConfigFilePath,
  type LoadTestConfig,
  type LoadTestModuleConfig,
} from '../config/load-test.config.js';
import {
  createModuleBaseUrlEnvName,
  findModuleBaseUrlEnvNameCollisions,
} from '../core/module-env.js';
import { parseOpenApiFile } from '../openapi/openapi.parser.js';
import { SCAFFOLD_METADATA_FILENAME } from '../scaffold/load-test.init.js';
import type {
  CliContext,
  DoctorCheck,
  DoctorOptions,
  DoctorResult,
} from './types.js';
import {
  isConfiguredValue,
  normalizeConfiguredValue,
} from './config-input.js';
import { formatDisplayPath } from './display.js';
import { loadLoadTestEnv } from './load-test-env.js';
import {
  formatScaffoldUpdateCommand,
  readScaffoldWarnings,
} from './scaffold-status.js';
import {
  DEFAULT_LOAD_TEST_DIR,
  resolveLoadTestDir,
} from './workspace-paths.js';
import { loadOptionalConfig } from './optional-config.js';

const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;

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

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === code,
  );
}
