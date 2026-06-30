import type { Dirent } from 'node:fs';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { LoadTestConfig } from '../../config/load-test.config.js';
import {
  parseWorkspaceScenarioFile,
  parseWorkspaceSuiteFile,
  resolveSuitePath,
} from '../workspace-paths.js';
import { formatDisplayPath } from './paths.js';
import {
  formatUiScenarioOption,
  resolveLoadTestDir,
  resolveUiScenarioPath,
} from './scenario-paths.js';
import { analyzeUiScenario } from './scenario-analysis.js';

export interface UiSuiteContext {
  cwd: string;
  config: LoadTestConfig;
}

export interface UiSuiteList {
  suiteDir: string;
  suites: UiSuiteListItem[];
}

export interface UiSuiteListItem {
  id: string;
  name: string;
  description?: string;
  group: string;
  path: string;
  scenarioCount?: number;
  scenarios?: string[];
  error?: string;
}

export interface UiSuiteDetail {
  id: string;
  name: string;
  description?: string;
  path: string;
  scenarioCount: number;
  scenarios: Array<{
    id: string;
    name?: string;
    description?: string;
    path?: string;
    stepCount?: number;
    modules?: string[];
    env?: string[];
    vars?: string[];
    error?: string;
  }>;
}

export async function listUiSuites(context: UiSuiteContext): Promise<UiSuiteList> {
  const suiteDir = resolveUiSuiteDir(context);
  const files = await listUiSuiteFiles(suiteDir);
  const suites: UiSuiteListItem[] = [];

  for (const filePath of files) {
    try {
      const suite = await parseWorkspaceSuiteFile(context.cwd, context.config, filePath);
      suites.push({
        id: formatUiSuiteOption(context.cwd, suiteDir, filePath),
        name: suite.name,
        ...(suite.description === undefined ? {} : { description: suite.description }),
        group: formatUiSuiteGroup(suiteDir, filePath),
        path: formatDisplayPath(context.cwd, filePath),
        scenarioCount: suite.scenarios.length,
        scenarios: suite.scenarios,
      });
    } catch (error) {
      suites.push({
        id: formatDisplayPath(context.cwd, filePath),
        name: resolveSuiteName(filePath),
        group: formatUiSuiteGroup(suiteDir, filePath),
        path: formatDisplayPath(context.cwd, filePath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    suiteDir: formatDisplayPath(context.cwd, suiteDir),
    suites,
  };
}

export async function readUiSuiteDetail(
  context: UiSuiteContext,
  suiteOption: string,
): Promise<UiSuiteDetail> {
  const suiteDir = resolveUiSuiteDir(context);
  const suitePath = resolveUiSuitePath(context, suiteOption);
  const suite = await parseWorkspaceSuiteFile(context.cwd, context.config, suitePath);

  return {
    id: formatUiSuiteOption(context.cwd, suiteDir, suitePath),
    name: suite.name,
    ...(suite.description === undefined ? {} : { description: suite.description }),
    path: formatDisplayPath(context.cwd, suitePath),
    scenarioCount: suite.scenarios.length,
    scenarios: await Promise.all(suite.scenarios.map((scenarioKey) => readSuiteScenario(context, scenarioKey))),
  };
}

export function resolveUiSuitePath(context: UiSuiteContext, value: string): string {
  const suiteDir = resolveUiSuiteDir(context);
  const keyedSuitePath = isSuiteKey(value)
    ? path.join(suiteDir, `${normalizeSuiteKey(value)}.yaml`)
    : undefined;
  const suitePath = keyedSuitePath !== undefined && existsSync(keyedSuitePath)
    ? keyedSuitePath
    : resolveSuitePath(context.cwd, context.config, value);
  const relative = path.relative(suiteDir, suitePath);

  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`suite must be inside ${formatDisplayPath(context.cwd, suiteDir)}`);
  }

  return suitePath;
}

export function formatUiSuiteOption(cwd: string, suiteDir: string, filePath: string): string {
  const relative = path.relative(suiteDir, filePath);

  if (isLocalRelativePath(relative) && path.extname(relative).toLowerCase() === '.yaml') {
    const suiteKey = formatSuiteKey(relative);

    if (isSuiteKey(suiteKey)) {
      return suiteKey;
    }
  }

  return formatDisplayPath(cwd, filePath);
}

async function readSuiteScenario(
  context: UiSuiteContext,
  scenarioKey: string,
): Promise<UiSuiteDetail['scenarios'][number]> {
  try {
    const scenarioPath = resolveUiScenarioPath(context, scenarioKey);
    const scenario = await parseWorkspaceScenarioFile(context.cwd, context.config, scenarioPath);
    const analysis = analyzeUiScenario(scenario);
    const scenarioDir = path.join(resolveLoadTestDir(context.cwd, context.config), 'scenarios');

    return {
      id: formatUiScenarioOption(context.cwd, scenarioDir, scenarioPath),
      name: scenario.name,
      ...(scenario.description === undefined ? {} : { description: scenario.description }),
      path: formatDisplayPath(context.cwd, scenarioPath),
      stepCount: scenario.steps.length,
      modules: analysis.modules,
      env: analysis.env,
      vars: analysis.vars,
    };
  } catch (error) {
    return {
      id: scenarioKey,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function listUiSuiteFiles(directoryPath: string): Promise<string[]> {
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
      files.push(...await listUiSuiteFiles(entryPath));
    } else if (entry.isFile() && isSuiteFile(entry.name) && !entry.name.endsWith('.example')) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function resolveUiSuiteDir(context: UiSuiteContext): string {
  return path.join(resolveLoadTestDir(context.cwd, context.config), 'suites');
}

function formatUiSuiteGroup(suiteDir: string, filePath: string): string {
  const relative = path.relative(suiteDir, filePath);
  const group = path.dirname(relative).split(path.sep).join('/');
  return group === '.' ? 'root' : group;
}

function resolveSuiteName(suite: string): string {
  return path.basename(suite, path.extname(suite));
}

function isSuiteFile(fileName: string): boolean {
  return ['.yaml', '.yml', '.json'].includes(path.extname(fileName).toLowerCase());
}

function isSuiteKey(value: string): boolean {
  const trimmed = value.trim();

  if (
    trimmed === '' ||
    path.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    path.extname(trimmed) !== ''
  ) {
    return false;
  }

  const segments = splitSuiteKey(trimmed);
  return segments.length > 0 && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function normalizeSuiteKey(value: string): string {
  return splitSuiteKey(value.trim()).join('/');
}

function splitSuiteKey(value: string): string[] {
  return value.split(/[\\/]+/);
}

function formatSuiteKey(relativeFilePath: string): string {
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

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}
