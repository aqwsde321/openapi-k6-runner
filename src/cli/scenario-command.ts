import fs from 'node:fs/promises';
import path from 'node:path';

import type { LoadTestConfig } from '../config/load-test.config.js';
import { executeAstScenario } from '../executor/scenario.executor.js';
import type {
  CliContext,
  GenerateOptions,
  GenerateResult,
  RunOptions,
  RunResult,
  TestOptions,
  TestResult,
  ValidateOptions,
  ValidateResult,
} from './types.js';
import { writeLine } from './display.js';
import { runK6Script } from './k6-runner.js';
import { loadLoadTestEnv } from './load-test-env.js';
import { loadOptionalConfig } from './optional-config.js';
import { loadScenarioOpenApiContext } from './scenario-openapi.js';
import {
  writeScaffoldUpdateNotice,
  writeValidationWarnings,
} from './scenario-output.js';
import { applyScenarioVarOverrides } from './scenario-var-overrides.js';
import {
  prepareGeneratedK6Script,
  validateAndBuildAst,
  validateScenarioOpenApi,
} from './scenario-script.js';
import {
  readScaffoldWarnings,
  resolveScaffoldUpdateCommand,
} from './scaffold-status.js';
import {
  parseWorkspaceScenarioFile,
  resolveLoadTestDir,
  resolveOutputPath,
  resolveScenarioOutputStem,
  resolveScenarioPath,
} from './workspace-paths.js';

export async function runGenerateCommand(
  options: GenerateOptions,
  context: CliContext = {},
): Promise<GenerateResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, options.openapi === undefined);
  assertModuleOptionHasConfig(config, options.module);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const scenario = await applyScenarioVarOverrides(
    cwd,
    await parseWorkspaceScenarioFile(cwd, config, scenarioPath),
    options,
  );
  const openApiContext = await loadScenarioOpenApiContext({
    cwd,
    config,
    scenario,
    cliOpenapi: options.openapi,
    cliModuleName: options.module,
    commandName: 'generate',
    requireBaseUrl: true,
  });
  const scaffoldWarnings = await readScaffoldWarnings(cwd, config);
  const scaffoldUpdateCommand = resolveScaffoldUpdateCommand(cwd, config, scaffoldWarnings);
  const outputPath = resolveOutputPath(cwd, config, options.scenario, options.write);
  const generated = prepareGeneratedK6Script({
    scenario,
    outputPath,
    openApiContext,
    fileRootDir: resolveLoadTestDir(cwd, config),
  });
  const result: GenerateResult = {
    outputPath: generated.outputPath,
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    baseUrl: openApiContext.baseUrl ?? '',
    warnings: generated.warnings,
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
    ...(scaffoldWarnings.length === 0 ? {} : { scaffoldWarnings }),
    ...(scaffoldUpdateCommand === undefined ? {} : { scaffoldUpdateCommand }),
  };

  await fs.mkdir(path.dirname(result.outputPath), { recursive: true });
  await fs.writeFile(result.outputPath, generated.script, 'utf8');

  return result;
}

export async function runRunCommand(
  options: RunOptions,
  context: CliContext = {},
): Promise<RunResult> {
  const cwd = resolveCwd(context);
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const config = await loadOptionalConfig(cwd, options.config, true);
  assertModuleOptionHasConfig(config, options.module);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const scenario = await applyScenarioVarOverrides(
    cwd,
    await parseWorkspaceScenarioFile(cwd, config, scenarioPath),
    options,
  );
  const loadTestDir = resolveLoadTestDir(cwd, config);
  const loadTestEnv = await loadLoadTestEnv(loadTestDir);
  const runtimeEnv = {
    ...loadTestEnv,
    ...(context.env ?? process.env),
  };
  const openApiContext = await loadScenarioOpenApiContext({
    cwd,
    config,
    scenario,
    cliModuleName: options.module,
    commandName: 'run',
    requireBaseUrl: true,
    runtimeEnv,
  });
  const validatedAst = validateAndBuildAst(scenario, openApiContext);
  const scaffoldWarnings = await readScaffoldWarnings(cwd, config);
  const scaffoldUpdateCommand = resolveScaffoldUpdateCommand(cwd, config, scaffoldWarnings);
  const outputPath = resolveOutputPath(cwd, config, options.scenario, options.write);
  const generated = prepareGeneratedK6Script({
    scenario,
    outputPath,
    openApiContext,
    fileRootDir: loadTestDir,
    validatedAst,
  });

  await fs.mkdir(path.dirname(generated.outputPath), { recursive: true });
  await fs.writeFile(generated.outputPath, generated.script, 'utf8');

  writeValidationWarnings(stdout, generated.warnings);
  writeScaffoldUpdateNotice(stdout, scaffoldWarnings, scaffoldUpdateCommand);
  writeLine(stdout, `Generated ${generated.outputPath}`);

  const k6Result = await runK6Script({
    cwd,
    loadTestDir,
    scenarioName: resolveScenarioOutputStem(cwd, config, options.scenario),
    scriptPath: generated.outputPath,
    runtimeEnv,
    k6Args: options.k6Args ?? [],
    log: options.log === true,
    trace: options.trace === true,
    report: options.report === true,
    openDashboard: options.openDashboard === true,
    stdout,
    stderr,
  });

  return {
    outputPath: generated.outputPath,
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
    ...(scaffoldWarnings.length === 0 ? {} : { scaffoldWarnings }),
    ...(scaffoldUpdateCommand === undefined ? {} : { scaffoldUpdateCommand }),
    ...(k6Result.logPath === undefined ? {} : { logPath: k6Result.logPath }),
    ...(k6Result.reportPath === undefined ? {} : { reportPath: k6Result.reportPath }),
    exitCode: k6Result.exitCode,
    signal: k6Result.signal,
  };
}

export async function runValidateCommand(
  options: ValidateOptions,
  context: CliContext = {},
): Promise<ValidateResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, options.openapi === undefined);
  assertModuleOptionHasConfig(config, options.module);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const scenario = await applyScenarioVarOverrides(
    cwd,
    await parseWorkspaceScenarioFile(cwd, config, scenarioPath),
    options,
  );
  const openApiContext = await loadScenarioOpenApiContext({
    cwd,
    config,
    scenario,
    cliOpenapi: options.openapi,
    cliModuleName: options.module,
    commandName: 'validate',
    requireBaseUrl: false,
  });
  const validation = validateScenarioOpenApi(scenario, openApiContext);
  const scaffoldWarnings = await readScaffoldWarnings(cwd, config);
  const scaffoldUpdateCommand = resolveScaffoldUpdateCommand(cwd, config, scaffoldWarnings);

  return {
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    scenarioName: validation.scenarioName,
    stepCount: validation.stepCount,
    warnings: [...validation.warnings, ...scaffoldWarnings],
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
    ...(scaffoldWarnings.length === 0 ? {} : { scaffoldWarnings }),
    ...(scaffoldUpdateCommand === undefined ? {} : { scaffoldUpdateCommand }),
  };
}

export async function runTestCommand(
  options: TestOptions,
  context: CliContext = {},
): Promise<TestResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, true);
  const scenarioPath = resolveScenarioPath(cwd, config, options.scenario);
  const scenario = await applyScenarioVarOverrides(
    cwd,
    await parseWorkspaceScenarioFile(cwd, config, scenarioPath),
    options,
  );
  const loadTestDir = resolveLoadTestDir(cwd, config);
  const loadTestEnv = await loadLoadTestEnv(loadTestDir);
  const runtimeEnv = {
    ...loadTestEnv,
    ...(context.env ?? process.env),
  };
  const openApiContext = await loadScenarioOpenApiContext({
    cwd,
    config,
    scenario,
    cliModuleName: options.module,
    commandName: 'test',
    requireBaseUrl: true,
    runtimeEnv,
  });
  const validatedAst = validateAndBuildAst(scenario, openApiContext);
  const scaffoldWarnings = await readScaffoldWarnings(cwd, config);
  const scaffoldUpdateCommand = resolveScaffoldUpdateCommand(cwd, config, scaffoldWarnings);

  const result = await executeAstScenario(validatedAst.ast, {
    baseUrl: openApiContext.baseUrl ?? '',
    moduleBaseUrls: openApiContext.moduleBaseUrls,
    fileRootDir: loadTestDir,
    env: runtimeEnv,
    fetch: context.fetch,
    reporter: context.testReporter,
  });

  return {
    ...result,
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
    ...(scaffoldWarnings.length === 0 ? {} : { scaffoldWarnings }),
    ...(scaffoldUpdateCommand === undefined ? {} : { scaffoldUpdateCommand }),
  };
}

function assertModuleOptionHasConfig(
  config: LoadTestConfig | undefined,
  moduleName: string | undefined,
): void {
  if (config === undefined && moduleName !== undefined) {
    throw new Error('--module requires --config');
  }
}

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
}
