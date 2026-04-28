#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { parse as parseDotEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAst } from '../compiler/ast.builder.js';
import { generateK6Script } from '../compiler/k6.generator.js';
import {
  loadTestConfig,
  resolveConfigFilePath,
  resolveConfigModule,
  type LoadTestConfig,
  type LoadTestModuleConfig,
} from '../config/load-test.config.js';
import { syncOpenApiSnapshot } from '../openapi/openapi.catalog.js';
import { parseOpenApiFile } from '../openapi/openapi.parser.js';
import { parseScenarioFile } from '../parser/scenario.parser.js';
import { initLoadTests } from '../scaffold/load-test.init.js';

type WritableLike = {
  write(chunk: string): unknown;
};

const DEFAULT_CONFIG_PATH = 'load-tests/config.yaml';
const DEFAULT_LOAD_TEST_DIR = 'load-tests';
const TODO_VALUE = 'TODO';

export interface CliContext {
  cwd?: string;
  stdout?: WritableLike;
  stderr?: WritableLike;
  cliPath?: string;
}

export interface GenerateOptions {
  scenario: string;
  openapi?: string;
  write?: string;
  config?: string;
  module?: string;
}

export interface SyncOptions {
  openapi?: string;
  write?: string;
  catalog?: string;
  config?: string;
  module?: string;
}

export interface InitOptions {
  dir?: string;
  module?: string;
  baseUrl?: string;
  openapi?: string;
  smokePath?: string;
  force?: boolean;
}

export interface GenerateResult {
  outputPath: string;
  scenarioPath: string;
  openapiPath: string;
  baseUrl: string;
  moduleName?: string;
}

export interface SyncResult {
  snapshotPath: string;
  catalogPath: string;
  openapiPath: string;
  operationCount: number;
  moduleName?: string;
}

export interface InitResult {
  directoryPath: string;
  configPath: string;
  runScriptPath: string;
  scenarioPath: string;
  readmePath: string;
}

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
}

function resolveOpenApiInput(cwd: string, value: string): string {
  if (isHttpUrl(value)) {
    return value;
  }

  return path.resolve(cwd, value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function loadOptionalConfig(
  cwd: string,
  configPath: string | undefined,
  useDefaultConfig: boolean,
): Promise<LoadTestConfig | undefined> {
  if (configPath === undefined && !useDefaultConfig) {
    return undefined;
  }

  const resolvedConfigPath = path.resolve(cwd, configPath ?? DEFAULT_CONFIG_PATH);

  try {
    return await loadTestConfig(resolvedConfigPath);
  } catch (error) {
    if (
      configPath === undefined &&
      useDefaultConfig &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw new Error(`${DEFAULT_CONFIG_PATH} was not found. Run openapi-k6 init or pass --config.`);
    }

    throw error;
  }
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

function resolveConfiguredOpenApiInput(
  cwd: string,
  config: LoadTestConfig | undefined,
  cliValue: string | undefined,
  configValue: string | undefined,
  message: string,
  configFieldLabel: string,
  commandName: string,
): string {
  if (cliValue !== undefined) {
    return resolveOpenApiInput(cwd, cliValue);
  }

  if (config !== undefined && isConfiguredValue(configValue)) {
    return resolveConfigFilePath(config, configValue);
  }

  if (config !== undefined) {
    throw new Error(
      `${config.path}: ${configFieldLabel} is not configured. Replace TODO before running ${commandName}.`,
    );
  }

  throw new Error(message);
}

function resolveConfiguredFilePath(
  cwd: string,
  config: LoadTestConfig | undefined,
  cliValue: string | undefined,
  configValue: string | undefined,
  message: string,
  configFieldLabel: string,
  commandName: string,
): string {
  if (cliValue !== undefined) {
    return path.resolve(cwd, cliValue);
  }

  if (config !== undefined && isConfiguredValue(configValue)) {
    return resolveConfigFilePath(config, configValue);
  }

  if (config !== undefined) {
    throw new Error(
      `${config.path}: ${configFieldLabel} is not configured. Replace TODO before running ${commandName}.`,
    );
  }

  throw new Error(message);
}

function isConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value.trim().toUpperCase() !== TODO_VALUE;
}

function normalizeConfiguredValue(value: string | undefined): string | undefined {
  return isConfiguredValue(value) ? value.trim() : undefined;
}

function resolveScenarioPath(cwd: string, config: LoadTestConfig | undefined, value: string): string {
  if (isScenarioName(value)) {
    return path.join(resolveLoadTestDir(cwd, config), 'scenarios', `${value}.yaml`);
  }

  return path.resolve(cwd, value);
}

function resolveOutputPath(
  cwd: string,
  config: LoadTestConfig | undefined,
  scenario: string,
  write: string | undefined,
): string {
  if (write !== undefined) {
    return path.resolve(cwd, write);
  }

  const scenarioName = isScenarioName(scenario)
    ? scenario
    : path.basename(scenario, path.extname(scenario));

  return path.join(resolveLoadTestDir(cwd, config), 'generated', `${scenarioName}.k6.js`);
}

function resolveLoadTestDir(cwd: string, config: LoadTestConfig | undefined): string {
  return config?.dir ?? path.resolve(cwd, DEFAULT_LOAD_TEST_DIR);
}

function isScenarioName(value: string): boolean {
  return !path.isAbsolute(value) &&
    !value.includes('/') &&
    !value.includes('\\') &&
    path.extname(value) === '';
}

export async function runGenerateCommand(
  options: GenerateOptions,
  context: CliContext = {},
): Promise<GenerateResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, options.openapi === undefined);
  const moduleConfig = selectConfigModule(config, options.module);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const moduleName = moduleConfig?.name ?? '<none>';
  const openapiPath = resolveConfiguredOpenApiInput(
    cwd,
    config,
    options.openapi,
    moduleConfig?.snapshot,
    '--openapi is required unless --config provides modules.<name>.snapshot',
    `modules.${moduleName}.snapshot`,
    'generate',
  );
  const scenario = await parseScenarioFile(scenarioPath);
  const registry = await parseOpenApiFile(openapiPath);
  const baseUrl =
    normalizeConfiguredValue(moduleConfig?.baseUrl) ??
    normalizeConfiguredValue(config?.baseUrl) ??
    (await loadBaseUrl(cwd)) ??
    registry.defaultServerUrl;

  if (!baseUrl) {
    throw new Error('baseUrl is not configured and OpenAPI servers[0].url is missing.');
  }

  const ast = buildAst(scenario, registry);
  const script = generateK6Script(ast, { baseUrl });
  const result: GenerateResult = {
    outputPath: resolveOutputPath(cwd, config, options.scenario, options.write),
    scenarioPath,
    openapiPath,
    baseUrl,
    ...(moduleConfig === undefined ? {} : { moduleName: moduleConfig.name }),
  };

  await fs.mkdir(path.dirname(result.outputPath), { recursive: true });
  await fs.writeFile(result.outputPath, script, 'utf8');

  return result;
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

export async function runInitCommand(
  options: InitOptions,
  context: CliContext = {},
): Promise<InitResult> {
  const cwd = resolveCwd(context);

  return initLoadTests({
    cwd,
    directory: options.dir,
    module: options.module,
    baseUrl: options.baseUrl,
    openapi: options.openapi,
    smokePath: options.smokePath,
    force: options.force,
    cliPath: resolveCliPath(context),
  });
}

function resolveCliPath(context: CliContext): string {
  return path.resolve(context.cliPath ?? fileURLToPath(import.meta.url));
}

function writeLine(stream: WritableLike, message: string): void {
  stream.write(`${message}\n`);
}

export function createProgram(context: CliContext = {}): Command {
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const program = new Command();

  program
    .name('openapi-k6')
    .description('Generate k6 scripts from OpenAPI specs and Scenario DSL files.')
    .version('0.1.0')
    .exitOverride()
    .configureOutput({
      writeOut: (value) => stdout.write(value),
      writeErr: (value) => stderr.write(value),
    });

  program
    .command('init')
    .description('Create a load-tests scaffold in the target project.')
    .option('--dir <path>', 'Load test directory path', 'load-tests')
    .option('-m, --module <name>', 'Initial module name', 'default')
    .option('--base-url <url>', 'API base URL for generated k6 scripts')
    .option('--openapi <path-or-url>', 'OpenAPI spec file path or URL')
    .option('--smoke-path <path>', 'Smoke scenario GET endpoint path', '/health')
    .option('--force', 'Overwrite existing scaffold files')
    .action(async (options: InitOptions) => {
      const result = await runInitCommand(options, context);
      writeLine(stdout, `Initialized ${result.directoryPath}`);
      writeLine(stdout, `Config ${result.configPath}`);
      writeLine(stdout, `Scenario ${result.scenarioPath}`);
      writeLine(stdout, `Run script ${result.runScriptPath}`);
    });

  program
    .command('generate')
    .description('Generate a k6 script for the configured scenario.')
    .requiredOption('-s, --scenario <path-or-name>', 'Scenario DSL file path or load-tests scenario name')
    .option('-o, --openapi <path>', 'OpenAPI spec file path')
    .option('-w, --write <path>', 'Output k6 script path (defaults to load-tests/generated/<scenario>.k6.js)')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .action(async (options: GenerateOptions) => {
      const result = await runGenerateCommand(options, context);
      writeLine(stdout, `Generated ${result.outputPath}`);
    });

  program
    .command('sync')
    .description('Write an OpenAPI snapshot and endpoint catalog.')
    .option('-o, --openapi <path-or-url>', 'OpenAPI spec file path or URL')
    .option('-w, --write <path>', 'Output OpenAPI snapshot path')
    .option('-c, --catalog <path>', 'Output endpoint catalog path')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .action(async (options: SyncOptions) => {
      const result = await runSyncCommand(options, context);
      writeLine(stdout, `Synced ${result.snapshotPath}`);
      writeLine(stdout, `Catalog ${result.catalogPath} (${result.operationCount} operations)`);
    });

  return program;
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

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (fileURLToPath(import.meta.url) === entryPath) {
  void main();
}
