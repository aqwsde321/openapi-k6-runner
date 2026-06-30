import type { SuiteTestResult, TestResult, ValidateResult } from './types.js';
import {
  formatDisplayPath,
  writeLine,
  type WritableLike,
} from './display.js';

export function writeValidationWarnings(stdout: WritableLike, warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  writeLine(stdout, 'Warnings:');

  for (const warning of warnings) {
    writeLine(stdout, `  - ${warning}`);
  }

  writeLine(stdout, '');
}

export function writeScaffoldUpdateNotice(
  stdout: WritableLike,
  warnings: string[],
  updateCommand: string | undefined,
): void {
  if (warnings.length === 0) {
    return;
  }

  writeLine(stdout, 'Scaffold update available:');

  for (const warning of warnings) {
    writeLine(stdout, `  reason   ${warning}`);
  }

  if (updateCommand !== undefined) {
    writeLine(stdout, `  command  ${updateCommand}`);
  }

  writeLine(stdout, '  keeps    config, scenarios, suites, .env, snapshots, generated scripts, and logs unchanged');
  writeLine(stdout, '');
}

export function writeValidateSummary(stdout: WritableLike, result: ValidateResult, cwd: string): void {
  writeLine(stdout, `Validated ${formatDisplayPath(cwd, result.scenarioPath)}`);

  if (result.openapiPaths !== undefined) {
    writeLine(stdout, '  openapi');

    for (const [moduleName, openapiPath] of Object.entries(result.openapiPaths)) {
      writeLine(stdout, `    ${moduleName}  ${formatDisplayPath(cwd, openapiPath)}`);
    }
  } else {
    writeLine(stdout, `  openapi  ${formatDisplayPath(cwd, result.openapiPath)}`);
  }

  if (result.moduleName !== undefined) {
    writeLine(stdout, `  module   ${result.moduleName}`);
  } else if (result.moduleNames !== undefined) {
    writeLine(stdout, `  modules  ${result.moduleNames.join(', ')}`);
  }

  writeLine(stdout, `  scenario ${result.scenarioName}`);
  writeLine(stdout, `  steps    ${result.stepCount}`);

  const scaffoldWarningSet = new Set(result.scaffoldWarnings ?? []);
  const validationWarnings = result.warnings.filter((warning) => !scaffoldWarningSet.has(warning));
  const scaffoldWarnings = result.scaffoldWarnings ?? [];

  if (validationWarnings.length > 0 || scaffoldWarnings.length > 0) {
    writeLine(stdout, '');
  }

  writeValidationWarnings(stdout, validationWarnings);
  writeScaffoldUpdateNotice(stdout, scaffoldWarnings, result.scaffoldUpdateCommand);
}

export function writeSuiteTestSummary(stdout: WritableLike, result: SuiteTestResult, cwd: string): void {
  const passedScenarios = result.scenarios.filter((scenario) => scenario.passed).length;
  const totalSteps = result.scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0);
  const passedSteps = result.scenarios.reduce(
    (sum, scenario) => sum + scenario.steps.filter((step) => step.passed).length,
    0,
  );

  writeLine(stdout, '');
  writeLine(stdout, `Suite ${result.suiteName}`);
  writeLine(stdout, `  suite     ${formatDisplayPath(cwd, result.suitePath)}`);
  writeLine(stdout, `  result    ${result.passed ? 'PASS' : 'FAIL'}`);
  writeLine(stdout, `  scenarios ${passedScenarios}/${result.scenarios.length} passed`);
  writeLine(stdout, `  steps     ${passedSteps}/${totalSteps} passed`);
  writeLine(stdout, `  duration  ${formatDuration(result.durationMs)}`);
  if (result.reportPath !== undefined) {
    writeLine(stdout, `  report    ${formatDisplayPath(cwd, result.reportPath)}`);
  }

  if (result.scenarios.length === 0) {
    return;
  }

  writeLine(stdout, '');

  for (const scenario of result.scenarios) {
    writeLine(stdout, formatSuiteScenarioLine(scenario));

    if (!scenario.passed) {
      const failure = formatSuiteScenarioFailure(scenario);

      if (failure !== undefined) {
        writeLine(stdout, `    ${failure}`);
      }
    }
  }
}

function formatSuiteScenarioLine(result: TestResult & { scenarioKey: string }): string {
  const passedSteps = result.steps.filter((step) => step.passed).length;
  const status = result.passed ? 'PASS' : 'FAIL';

  return `  ${status} ${result.scenarioKey} ${passedSteps}/${result.steps.length} steps ${formatDuration(result.durationMs)}`;
}

function formatSuiteScenarioFailure(result: TestResult): string | undefined {
  const failedStep = result.steps.find((step) => !step.passed);

  if (failedStep === undefined) {
    return undefined;
  }

  const parts = [`step ${failedStep.id}`];

  if (failedStep.response !== undefined) {
    const statusText = failedStep.response.statusText ? ` ${failedStep.response.statusText}` : '';
    parts.push(`status ${failedStep.response.status}${statusText}`);
  }

  if (failedStep.condition !== undefined && !failedStep.condition.passed) {
    parts.push(`condition ${failedStep.condition.expression}`);
  }

  const failedExtract = failedStep.extracts.find((extract) => !extract.passed);

  if (failedExtract !== undefined) {
    parts.push(`extract ${failedExtract.name}`);
  }

  if (failedStep.error !== undefined) {
    parts.push('error');
  }

  return parts.join('; ');
}

function formatDuration(durationMs: number): string {
  return `${Math.round(durationMs)}ms`;
}
