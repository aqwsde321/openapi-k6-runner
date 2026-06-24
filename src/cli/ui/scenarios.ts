import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { LoadTestConfig } from '../../config/load-test.config.js';
import { isInputStep } from '../../core/types.js';
import { formatDisplayPath } from './paths.js';
import type { UiScenarioStepSource } from './run-state.js';
import { analyzeUiScenario } from './scenario-analysis.js';
import {
  readScenarioIncludes,
  readTopLevelStringArray,
  readUiScenarioStepDefinitions,
  readUiScenarioStepSources,
  type UiScenarioStepDefinition,
} from './scenario-files.js';
import {
  createUiScenarioReaderContext,
  formatUiScenarioOption,
  parseWorkspaceScenarioFile,
  resolveLoadTestDir,
  resolveScenarioName,
  resolveUiScenarioPath,
} from './scenario-paths.js';

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
    description?: string;
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
  description?: string;
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
        ...(scenario.description === undefined ? {} : { description: scenario.description }),
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
    ...(scenario.description === undefined ? {} : { description: scenario.description }),
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
      ...(isInputStep(step)
        ? {
            input: {
              name: step.input.name,
              ...(step.input.label === undefined ? {} : { label: step.input.label }),
              required: step.input.required,
              ...(step.input.sensitive === undefined ? {} : { sensitive: step.input.sensitive }),
            },
          }
        : {
            ...(step.api.module === undefined ? {} : { module: step.api.module }),
            ...(step.api.operationId === undefined ? {} : { operationId: step.api.operationId }),
            ...(step.api.method === undefined ? {} : { method: step.api.method }),
            ...(step.api.path === undefined ? {} : { path: step.api.path }),
            ...(step.condition === undefined ? {} : { condition: step.condition }),
            ...(step.extract === undefined ? {} : { extract: Object.keys(step.extract) }),
          }),
      ...(stepDefinitions[index] === undefined ? {} : { definition: stepDefinitions[index] }),
    })),
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

function isScenarioFile(fileName: string): boolean {
  return ['.yaml', '.yml', '.json'].includes(path.extname(fileName).toLowerCase());
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}
