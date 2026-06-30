import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import type { LoadTestConfig } from '../config/load-test.config.js';
import { executeAstScenario } from '../executor/scenario.executor.js';
import type { K6ExecutionValues, ScenarioExecutionResult, ScenarioInputProvider } from '../executor/scenario.executor.js';
import type {
  CliContext,
  GenerateOptions,
  GenerateResult,
  RunOptions,
  RunResult,
  SuiteScenarioTestResult,
  SuiteTestOptions,
  SuiteTestResult,
  TestOptions,
  TestResult,
  ValidateOptions,
  ValidateResult,
} from './types.js';
import {
  formatDisplayPath,
  writeLine,
} from './display.js';
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
  parseWorkspaceSuiteFile,
  resolveLoadTestDir,
  resolveOutputPath,
  resolveScenarioOutputStem,
  resolveScenarioPath,
  resolveSuitePath,
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

  const iterationCount = options.iterations ?? 1;
  if (!Number.isInteger(iterationCount) || iterationCount < 1) {
    throw new Error('--iterations must be a positive integer');
  }

  const runId = runtimeEnv.OPENAPI_K6_RUN_ID ?? 'test-run';
  let result: ScenarioExecutionResult | undefined;
  let durationMs = 0;

  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    result = await executeAstScenario(validatedAst.ast, {
      baseUrl: openApiContext.baseUrl ?? '',
      moduleBaseUrls: openApiContext.moduleBaseUrls,
      fileRootDir: loadTestDir,
      env: runtimeEnv,
      k6: createTestK6ExecutionValues(runId, iteration),
      fetch: context.fetch,
      captureRequestResponseValues: context.captureRequestResponseValues === true,
      inputProvider: context.inputProvider ?? createCliInputProvider(context),
      reporter: context.testReporter,
    });
    durationMs += result.durationMs;

    if (!result.passed) {
      break;
    }
  }

  if (result === undefined) {
    throw new Error('--iterations must be a positive integer');
  }

  const finalResult = {
    ...result,
    durationMs,
  };

  return {
    ...finalResult,
    scenarioPath,
    openapiPath: openApiContext.openapiPath,
    ...(openApiContext.openapiPaths === undefined ? {} : { openapiPaths: openApiContext.openapiPaths }),
    ...(openApiContext.moduleName === undefined ? {} : { moduleName: openApiContext.moduleName }),
    ...(openApiContext.moduleNames === undefined ? {} : { moduleNames: openApiContext.moduleNames }),
    ...(scaffoldWarnings.length === 0 ? {} : { scaffoldWarnings }),
    ...(scaffoldUpdateCommand === undefined ? {} : { scaffoldUpdateCommand }),
  };
}

export async function runSuiteTestCommand(
  options: SuiteTestOptions,
  context: CliContext = {},
): Promise<SuiteTestResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(cwd, options.config, true);
  assertModuleOptionHasConfig(config, options.module);
  const suitePath = resolveSuitePath(cwd, config, options.suite);
  const suite = await parseWorkspaceSuiteFile(cwd, config, suitePath);
  const scenarios: SuiteScenarioTestResult[] = [];
  let durationMs = 0;

  for (const scenarioKey of suite.scenarios) {
    const result = await runTestCommand({
      scenario: scenarioKey,
      ...(options.config === undefined ? {} : { config: options.config }),
      ...(options.module === undefined ? {} : { module: options.module }),
      ...(options.color === undefined ? {} : { color: options.color }),
      ...(options.iterations === undefined ? {} : { iterations: options.iterations }),
      ...(options.varFile === undefined ? {} : { varFile: options.varFile }),
      ...(options.var === undefined ? {} : { var: options.var }),
    }, context);
    scenarios.push({
      ...result,
      scenarioKey,
    });
    durationMs += result.durationMs;
  }

  const scaffoldWarnings = uniqueStrings(scenarios.flatMap((scenario) => scenario.scaffoldWarnings ?? []));
  const scaffoldUpdateCommand = scenarios
    .map((scenario) => scenario.scaffoldUpdateCommand)
    .find((command): command is string => command !== undefined);
  const result: SuiteTestResult = {
    suitePath,
    suiteName: suite.name,
    scenarios,
    passed: scenarios.every((scenario) => scenario.passed),
    durationMs,
    ...(scaffoldWarnings.length === 0 ? {} : { scaffoldWarnings }),
    ...(scaffoldUpdateCommand === undefined ? {} : { scaffoldUpdateCommand }),
  };
  const reportPath = await writeSuiteTestReport(cwd, config, options.suite, result);

  return {
    ...result,
    reportPath,
  };
}

function createCliInputProvider(context: CliContext): ScenarioInputProvider | undefined {
  const stdin = context.stdin ?? process.stdin;
  const stdout = context.stdout ?? process.stdout;

  if (context.interactive === false || stdin.isTTY !== true || stdout.isTTY !== true) {
    return undefined;
  }

  return async (request) => {
    const readline = createInterface({
      input: stdin,
      output: stdout as NodeJS.WritableStream,
      terminal: true,
    });
    const label = request.label ?? request.name;

    try {
      return await readline.question(`${label}: `);
    } finally {
      readline.close();
    }
  };
}

function createTestK6ExecutionValues(runId: string, iteration: number): K6ExecutionValues {
  return {
    'run.id': runId,
    'scenario.iterationInInstance': iteration,
    'scenario.iterationInTest': iteration,
    'vu.idInInstance': 1,
    'vu.idInTest': 1,
    'vu.iterationInInstance': iteration,
    'vu.iterationInScenario': iteration,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

async function writeSuiteTestReport(
  cwd: string,
  config: LoadTestConfig | undefined,
  suiteOption: string,
  result: SuiteTestResult,
): Promise<string> {
  const loadTestDir = resolveLoadTestDir(cwd, config);
  const reportDir = path.join(loadTestDir, 'reports');
  const reportPath = path.join(reportDir, `${formatReportTimestamp(new Date())}_${formatReportStem(suiteOption)}.json`);
  const report = createSuiteTestReport(cwd, suiteOption, result);

  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}

function createSuiteTestReport(cwd: string, suiteOption: string, result: SuiteTestResult): unknown {
  const totalSteps = result.scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0);
  const passedSteps = result.scenarios.reduce(
    (sum, scenario) => sum + scenario.steps.filter((step) => step.passed).length,
    0,
  );

  return {
    tool: 'openapi-k6',
    kind: 'suite-test',
    generatedAt: new Date().toISOString(),
    suite: {
      key: suiteOption,
      name: result.suiteName,
      path: formatDisplayPath(cwd, result.suitePath),
    },
    result: result.passed ? 'PASS' : 'FAIL',
    summary: {
      scenarios: {
        passed: result.scenarios.filter((scenario) => scenario.passed).length,
        total: result.scenarios.length,
      },
      steps: {
        passed: passedSteps,
        total: totalSteps,
      },
      durationMs: Math.round(result.durationMs),
    },
    scenarios: result.scenarios.map((scenario) => ({
      key: scenario.scenarioKey,
      name: scenario.scenario,
      path: formatDisplayPath(cwd, scenario.scenarioPath),
      result: scenario.passed ? 'PASS' : 'FAIL',
      durationMs: Math.round(scenario.durationMs),
      steps: scenario.steps.map((step) => ({
        index: step.index,
        id: step.id,
        result: step.passed ? 'PASS' : 'FAIL',
        method: step.method,
        path: step.path,
        durationMs: Math.round(step.durationMs),
        ...(step.response === undefined
          ? {}
          : {
              response: {
                status: step.response.status,
                statusText: step.response.statusText,
              },
            }),
        ...(step.condition === undefined
          ? {}
          : {
              condition: {
                expression: step.condition.expression,
                passed: step.condition.passed,
              },
            }),
        extracts: step.extracts.map((extract) => ({
          name: extract.name,
          path: extract.path,
          passed: extract.passed,
          ...(extract.error === undefined ? {} : { error: extract.error }),
        })),
        ...(step.error === undefined ? {} : { error: step.error }),
      })),
    })),
  };
}

function formatReportTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function formatReportStem(value: string): string {
  const parsed = path.parse(value);
  const stem = parsed.ext ? path.join(parsed.dir, parsed.name) : value;
  const normalized = stem.trim().replace(/^[./\\]+/, '').replace(/[\\/]+/g, '-');
  const safe = normalized.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'suite';
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
