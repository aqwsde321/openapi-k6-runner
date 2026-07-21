import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveConfigModule,
  type LoadTestConfig,
  type LoadTestModuleConfig,
} from '../config/load-test.config.js';
import {
  initLoadTests,
  updateLoadTests,
} from '../scaffold/load-test.init.js';
import { runSyncCommand } from './catalog-command.js';
import type {
  CliContext,
  InitOptions,
  InitResult,
  InstallSkillOptions,
  InstallSkillResult,
  UpdateOptions,
  UpdateResult,
} from './types.js';
import { resolveInitOptionsInteractively } from './init-openapi.js';
import { loadOptionalConfig } from './optional-config.js';
import { DEFAULT_LOAD_TEST_DIR } from './workspace-paths.js';

const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;
const LEGACY_DEFAULT_CONFIG_PATH = 'load-tests/config.yaml';
const CODEX_SKILL_NAME = 'openapi-k6-scenario';

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

  if (
    options.config === undefined &&
    !(await pathExists(path.join(cwd, DEFAULT_CONFIG_PATH))) &&
    await pathExists(path.join(cwd, LEGACY_DEFAULT_CONFIG_PATH))
  ) {
    const defaultDirectoryExists = await pathExists(path.join(cwd, DEFAULT_LOAD_TEST_DIR));

    throw new Error(
      [
        `${LEGACY_DEFAULT_CONFIG_PATH} was found, but the default workspace is fixed at ${DEFAULT_LOAD_TEST_DIR}/.`,
        ...(defaultDirectoryExists
          ? [`${DEFAULT_LOAD_TEST_DIR}/ already exists. Resolve that directory before moving load-tests/.`]
          : [`Move load-tests/ to ${DEFAULT_LOAD_TEST_DIR}/ manually.`]),
        `Run openapi-k6 update --config ${LEGACY_DEFAULT_CONFIG_PATH} to update the legacy workspace in place.`,
      ].join('\n'),
    );
  }

  const config = await loadOptionalConfig(cwd, options.config, true);
  const moduleConfig = selectConfigModule(config, options.module);

  if (config === undefined) {
    throw new Error(`${DEFAULT_CONFIG_PATH} was not found. Run openapi-k6 init or pass --config.`);
  }

  return updateLoadTests({
    cwd,
    directory: path.relative(cwd, config.dir) || '.',
    module: moduleConfig?.name,
    includeModuleOption: options.module !== undefined,
    snapshot: moduleConfig?.snapshot,
    catalog: moduleConfig?.catalog,
  });
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

function resolvePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function resolveSkillTargetDir(cwd: string, targetDir: string | undefined): string {
  if (targetDir !== undefined) {
    return path.isAbsolute(targetDir) ? targetDir : path.resolve(cwd, targetDir);
  }

  return path.join(homedir(), '.codex', 'skills', CODEX_SKILL_NAME);
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

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
}
