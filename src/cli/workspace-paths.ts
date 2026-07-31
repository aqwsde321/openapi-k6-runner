import { existsSync } from 'node:fs';
import path from 'node:path';

import type { LoadTestConfig } from '../config/load-test.config.js';
import type { Scenario, Suite } from '../core/types.js';
import { parseScenarioFile } from '../parser/scenario.parser.js';
import { parseSuiteFile } from '../parser/suite.parser.js';
import { DEFAULT_WORKSPACE_DIR } from '../scaffold/load-test.init.js';

export const DEFAULT_LOAD_TEST_DIR = DEFAULT_WORKSPACE_DIR;

export function resolveScenarioPath(cwd: string, config: LoadTestConfig | undefined, value: string): string {
  if (isScenarioKey(value)) {
    const explicitPath = path.resolve(cwd, value);

    if (hasScenarioKeySeparator(value) && existsSync(explicitPath)) {
      return explicitPath;
    }

    return path.join(resolveLoadTestDir(cwd, config), 'scenarios', `${normalizeScenarioKey(value)}.yaml`);
  }

  return path.resolve(cwd, value);
}

export function resolveSuitePath(cwd: string, config: LoadTestConfig | undefined, value: string): string {
  if (isScenarioKey(value)) {
    const explicitPath = path.resolve(cwd, value);

    if (hasScenarioKeySeparator(value) && existsSync(explicitPath)) {
      return explicitPath;
    }

    return path.join(resolveLoadTestDir(cwd, config), 'suites', `${normalizeScenarioKey(value)}.yaml`);
  }

  return path.resolve(cwd, value);
}

export function resolveOutputPath(
  cwd: string,
  config: LoadTestConfig | undefined,
  scenario: string,
  write: string | undefined,
): string {
  if (write !== undefined) {
    return path.resolve(cwd, write);
  }

  const scenarioName = resolveScenarioOutputStem(cwd, config, scenario);

  return resolveGeneratedK6Path(resolveLoadTestDir(cwd, config), scenarioName);
}

export function resolveScenarioOutputStem(cwd: string, config: LoadTestConfig | undefined, scenario: string): string {
  if (isScenarioKey(scenario)) {
    const explicitPath = path.resolve(cwd, scenario);

    if (hasScenarioKeySeparator(scenario) && existsSync(explicitPath)) {
      return resolveScenarioOutputStemFromPath(cwd, config, explicitPath);
    }

    return normalizeScenarioKey(scenario);
  }

  return resolveScenarioOutputStemFromPath(cwd, config, path.resolve(cwd, scenario));
}

function resolveScenarioOutputStemFromPath(cwd: string, config: LoadTestConfig | undefined, scenarioPath: string): string {
  const scenarioDir = path.join(resolveLoadTestDir(cwd, config), 'scenarios');
  const relative = path.relative(scenarioDir, scenarioPath);

  if (isLocalRelativePath(relative) && isScenarioFile(relative)) {
    return formatScenarioKey(relative);
  }

  return resolveScenarioName(scenarioPath);
}

function resolveGeneratedK6Path(loadTestDir: string, scenarioKey: string): string {
  const parts = scenarioKey.split('/');
  const scriptName = `${parts.pop() ?? scenarioKey}.k6.js`;
  return path.join(loadTestDir, 'generated', ...parts, scriptName);
}

function resolveScenarioName(scenario: string): string {
  return path.basename(scenario, path.extname(scenario));
}

export function resolveLoadTestDir(cwd: string, config: LoadTestConfig | undefined): string {
  return config?.dir ?? path.resolve(cwd, DEFAULT_LOAD_TEST_DIR);
}

function resolveScenarioRootDir(cwd: string, config: LoadTestConfig | undefined): string {
  return path.join(resolveLoadTestDir(cwd, config), 'scenarios');
}

export function parseWorkspaceScenarioFile(
  cwd: string,
  config: LoadTestConfig | undefined,
  scenarioPath: string,
): Promise<Scenario> {
  return parseScenarioFile(scenarioPath, {
    scenarioRootDir: resolveScenarioRootDir(cwd, config),
  });
}

export function parseWorkspaceScenarioSource(
  cwd: string,
  config: LoadTestConfig | undefined,
  scenarioPath: string,
  source: string,
): Promise<Scenario> {
  return parseScenarioFile(scenarioPath, {
    scenarioRootDir: resolveScenarioRootDir(cwd, config),
    source,
  });
}

export function parseWorkspaceSuiteFile(
  _cwd: string,
  _config: LoadTestConfig | undefined,
  suitePath: string,
): Promise<Suite> {
  return parseSuiteFile(suitePath);
}

function isScenarioKey(value: string): boolean {
  const trimmed = value.trim();

  if (
    trimmed === '' ||
    path.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    path.extname(trimmed) !== ''
  ) {
    return false;
  }

  const segments = splitScenarioKey(trimmed);
  return segments.length > 0 && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function normalizeScenarioKey(value: string): string {
  return splitScenarioKey(value.trim()).join('/');
}

function splitScenarioKey(value: string): string[] {
  return value.split(/[\\/]+/);
}

function hasScenarioKeySeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function formatScenarioKey(relativeFilePath: string): string {
  const parsed = path.parse(relativeFilePath);
  return path.join(parsed.dir, parsed.name).split(path.sep).join('/');
}

function isLocalRelativePath(relativePath: string): boolean {
  return relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath) &&
    !path.win32.isAbsolute(relativePath);
}

export function isScenarioFile(fileName: string): boolean {
  return ['.yaml', '.yml', '.json'].includes(path.extname(fileName).toLowerCase());
}
