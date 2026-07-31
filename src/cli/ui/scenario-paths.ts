import { existsSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { LoadTestConfig } from '../../config/load-test.config.js';
import {
  parseWorkspaceScenarioFile,
  resolveLoadTestDir,
  resolveScenarioPath,
} from '../workspace-paths.js';
import { formatDisplayPath } from './paths.js';
import type { UiScenarioReaderContext } from './scenario-files.js';

export { parseWorkspaceScenarioFile, resolveLoadTestDir } from '../workspace-paths.js';

export interface UiScenarioPathContext {
  cwd: string;
  config: LoadTestConfig;
}

export function validateUiScenarioOption(context: UiScenarioPathContext, value: string): string {
  resolveUiScenarioPath(context, value);
  return value;
}

export function resolveUiScenarioPath(context: UiScenarioPathContext, value: string): string {
  const scenarioDir = path.join(resolveLoadTestDir(context.cwd, context.config), 'scenarios');
  const keyedScenarioPath = isScenarioKey(value)
    ? path.join(scenarioDir, `${normalizeScenarioKey(value)}.yaml`)
    : undefined;
  const scenarioPath = keyedScenarioPath !== undefined && existsSync(keyedScenarioPath)
    ? keyedScenarioPath
    : resolveScenarioPath(context.cwd, context.config, value);
  const relative = path.relative(scenarioDir, scenarioPath);

  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes('partials') ||
    relative.split(path.sep).includes('fixtures')
  ) {
    throw new Error(`scenario must be inside ${formatDisplayPath(context.cwd, scenarioDir)}`);
  }

  return scenarioPath;
}

export async function resolveUiEditableScenarioPath(
  context: UiScenarioPathContext,
  value: string,
): Promise<string> {
  const scenarioDir = path.join(resolveLoadTestDir(context.cwd, context.config), 'scenarios');
  const scenarioPath = resolveUiScenarioPath(context, value);
  const [realScenarioDir, realScenarioPath, scenarioFile] = await Promise.all([
    realpath(scenarioDir),
    realpath(scenarioPath),
    lstat(scenarioPath),
  ]);
  const relative = path.relative(realScenarioDir, realScenarioPath);

  if (
    scenarioFile.isSymbolicLink() ||
    !scenarioFile.isFile() ||
    !['.yaml', '.yml', '.json'].includes(path.extname(scenarioPath).toLowerCase()) ||
    !isLocalRelativePath(relative) ||
    relative.split(path.sep).includes('partials') ||
    relative.split(path.sep).includes('fixtures')
  ) {
    throw new Error(`scenario must be inside ${formatDisplayPath(context.cwd, scenarioDir)}`);
  }

  return scenarioPath;
}

export function formatUiScenarioOption(cwd: string, scenarioDir: string, filePath: string): string {
  const relative = path.relative(scenarioDir, filePath);

  if (isLocalRelativePath(relative) && path.extname(relative).toLowerCase() === '.yaml') {
    const scenarioKey = formatScenarioKey(relative);

    if (isScenarioKey(scenarioKey)) {
      return scenarioKey;
    }
  }

  return formatDisplayPath(cwd, filePath);
}

export function createUiScenarioReaderContext(context: UiScenarioPathContext): UiScenarioReaderContext {
  return {
    resolveScenarioPath: (value) => resolveUiScenarioPath(context, value),
    formatDisplayPath: (filePath) => formatDisplayPath(context.cwd, filePath),
  };
}

export function resolveScenarioName(scenario: string): string {
  return path.basename(scenario, path.extname(scenario));
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
