import { existsSync, type Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { LoadTestConfig } from '../../config/load-test.config.js';
import { collectTemplateReferences } from '../../core/template.js';
import type { Scenario } from '../../core/types.js';
import { parseScenarioFile } from '../../parser/scenario.parser.js';
import { DEFAULT_WORKSPACE_DIR } from '../../scaffold/load-test.init.js';
import { formatDisplayPath } from './paths.js';
import type { UiScenarioStepSource } from './run-state.js';
import {
  readScenarioIncludes,
  readTopLevelStringArray,
  readUiScenarioStepDefinitions,
  readUiScenarioStepSources,
  type UiScenarioReaderContext,
  type UiScenarioStepDefinition,
} from './scenario-files.js';

const DEFAULT_LOAD_TEST_DIR = DEFAULT_WORKSPACE_DIR;

export interface UiScenarioContext {
  cwd: string;
  config: LoadTestConfig;
}

export interface UiScenarioList {
  configPath: string;
  scenarioDir: string;
  defaultModule?: string;
  moduleCount: number;
  scenarios: Array<{
    id: string;
    name: string;
    group: string;
    path: string;
    stepCount?: number;
    modules?: string[];
    env?: string[];
    vars?: string[];
    error?: string;
  }>;
}

export interface UiScenarioDetail {
  id: string;
  name: string;
  path: string;
  stepCount: number;
  modules: string[];
  env: string[];
  vars: string[];
  includes: string[];
  fixtures: string[];
  steps: Array<{
    id: string;
    source: UiScenarioStepSource;
    module?: string;
    operationId?: string;
    method?: string;
    path?: string;
    condition?: string;
    extract?: string[];
    definition?: UiScenarioStepDefinition;
  }>;
}

export function resolveLoadTestDir(cwd: string, config: LoadTestConfig | undefined): string {
  return config?.dir ?? path.resolve(cwd, DEFAULT_LOAD_TEST_DIR);
}

export async function listUiScenarios(context: UiScenarioContext): Promise<UiScenarioList> {
  const scenarioDir = path.join(resolveLoadTestDir(context.cwd, context.config), 'scenarios');
  const files = await listUiScenarioFiles(scenarioDir);
  const scenarios = [];

  for (const filePath of files) {
    try {
      const scenario = await parseWorkspaceScenarioFile(context.cwd, context.config, filePath);
      const analysis = analyzeUiScenario(scenario);
      scenarios.push({
        id: formatUiScenarioOption(context.cwd, scenarioDir, filePath),
        name: scenario.name,
        group: formatUiScenarioGroup(scenarioDir, filePath),
        path: formatDisplayPath(context.cwd, filePath),
        stepCount: scenario.steps.length,
        modules: analysis.modules,
        env: analysis.env,
        vars: analysis.vars,
      });
    } catch (error) {
      scenarios.push({
        id: formatDisplayPath(context.cwd, filePath),
        name: resolveScenarioName(filePath),
        group: formatUiScenarioGroup(scenarioDir, filePath),
        path: formatDisplayPath(context.cwd, filePath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    configPath: formatDisplayPath(context.cwd, context.config.path),
    scenarioDir: formatDisplayPath(context.cwd, scenarioDir),
    ...(context.config.defaultModule === undefined ? {} : { defaultModule: context.config.defaultModule }),
    moduleCount: context.config.modules.size,
    scenarios,
  };
}

export async function readUiScenarioDetail(
  context: UiScenarioContext,
  scenarioOption: string,
): Promise<UiScenarioDetail> {
  const scenarioPath = resolveUiScenarioPath(context, scenarioOption);
  const scenario = await parseWorkspaceScenarioFile(context.cwd, context.config, scenarioPath);
  const analysis = analyzeUiScenario(scenario);
  const scenarioReader = createUiScenarioReaderContext(context);
  const stepSources = await readUiScenarioStepSources(scenarioReader, scenarioPath);
  const stepDefinitions = await readUiScenarioStepDefinitions(scenarioReader, scenarioPath);

  return {
    id: formatUiScenarioOption(context.cwd, path.join(resolveLoadTestDir(context.cwd, context.config), 'scenarios'), scenarioPath),
    name: scenario.name,
    path: formatDisplayPath(context.cwd, scenarioPath),
    stepCount: scenario.steps.length,
    modules: analysis.modules,
    env: analysis.env,
    vars: analysis.vars,
    includes: await readScenarioIncludes(scenarioPath),
    fixtures: await readTopLevelStringArray(scenarioPath, 'fixtures'),
    steps: scenario.steps.map((step, index) => ({
      id: step.id,
      source: stepSources[index] ?? { kind: 'direct' },
      ...(step.api.module === undefined ? {} : { module: step.api.module }),
      ...(step.api.operationId === undefined ? {} : { operationId: step.api.operationId }),
      ...(step.api.method === undefined ? {} : { method: step.api.method }),
      ...(step.api.path === undefined ? {} : { path: step.api.path }),
      ...(step.condition === undefined ? {} : { condition: step.condition }),
      ...(step.extract === undefined ? {} : { extract: Object.keys(step.extract) }),
      ...(stepDefinitions[index] === undefined ? {} : { definition: stepDefinitions[index] }),
    })),
  };
}

export function validateUiScenarioOption(context: UiScenarioContext, value: string): string {
  resolveUiScenarioPath(context, value);
  return value;
}

export function resolveUiScenarioPath(context: UiScenarioContext, value: string): string {
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

export function createUiScenarioReaderContext(context: UiScenarioContext): UiScenarioReaderContext {
  return {
    resolveScenarioPath: (value) => resolveUiScenarioPath(context, value),
    formatDisplayPath: (filePath) => formatDisplayPath(context.cwd, filePath),
  };
}

async function listUiScenarioFiles(directoryPath: string): Promise<string[]> {
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
      if (entry.name !== 'partials' && entry.name !== 'fixtures') {
        files.push(...await listUiScenarioFiles(entryPath));
      }
    } else if (entry.isFile() && isScenarioFile(entry.name) && !entry.name.endsWith('.example')) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function formatUiScenarioGroup(scenarioDir: string, filePath: string): string {
  const relative = path.relative(scenarioDir, filePath);
  const group = path.dirname(relative).split(path.sep).join('/');
  return group === '.' ? 'root' : group;
}

function resolveScenarioPath(cwd: string, config: LoadTestConfig | undefined, value: string): string {
  if (isScenarioKey(value)) {
    const explicitPath = path.resolve(cwd, value);

    if (hasScenarioKeySeparator(value) && existsSync(explicitPath)) {
      return explicitPath;
    }

    return path.join(resolveLoadTestDir(cwd, config), 'scenarios', `${normalizeScenarioKey(value)}.yaml`);
  }

  return path.resolve(cwd, value);
}

function resolveScenarioName(scenario: string): string {
  return path.basename(scenario, path.extname(scenario));
}

function resolveScenarioRootDir(cwd: string, config: LoadTestConfig | undefined): string {
  return path.join(resolveLoadTestDir(cwd, config), 'scenarios');
}

function parseWorkspaceScenarioFile(
  cwd: string,
  config: LoadTestConfig | undefined,
  scenarioPath: string,
): Promise<Scenario> {
  return parseScenarioFile(scenarioPath, {
    scenarioRootDir: resolveScenarioRootDir(cwd, config),
  });
}

function analyzeUiScenario(scenario: Scenario): {
  modules: string[];
  env: string[];
  vars: string[];
} {
  const modules = new Set<string>();
  const env = new Set<string>();
  const vars = new Set<string>();

  for (const step of scenario.steps) {
    if (step.api.module !== undefined) {
      modules.add(step.api.module);
    }

    collectUiTemplateReferences(step.request, env, vars);
  }

  collectUiTemplateReferences(scenario.vars, env, vars);

  return {
    modules: [...modules].sort(),
    env: [...env].sort(),
    vars: [...vars].sort(),
  };
}

function collectUiTemplateReferences(value: unknown, env: Set<string>, vars: Set<string>): void {
  if (typeof value === 'string') {
    try {
      for (const reference of collectTemplateReferences(value)) {
        if (reference.type === 'env') {
          env.add(reference.name);
        } else if (reference.type === 'vars') {
          vars.add(reference.name);
        }
      }
    } catch {
      return;
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUiTemplateReferences(item, env, vars);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectUiTemplateReferences(item, env, vars);
    }
  }
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

function isScenarioFile(fileName: string): boolean {
  return ['.yaml', '.yml', '.json'].includes(path.extname(fileName).toLowerCase());
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}
