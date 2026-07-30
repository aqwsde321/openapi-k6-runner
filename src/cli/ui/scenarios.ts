import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { buildAst } from '../../compiler/ast.builder.js';
import type { LoadTestConfig } from '../../config/load-test.config.js';
import { resolveStepRegistry } from '../../core/api-registry.js';
import {
  isASTApiStep,
  isInputStep,
  type ASTStep,
  type StepInput,
  type StepRequest,
} from '../../core/types.js';
import {
  buildOpenApiResponsePreview,
  type OpenApiResponsePreview,
} from '../../openapi/openapi.catalog.js';
import { resolveApiOperation } from '../../openapi/openapi.resolver.js';
import { loadScenarioOpenApiContext } from '../scenario-openapi.js';
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
  options?: {
    module?: string;
  };
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
  targetModules?: string[];
  env: string[];
  vars: string[];
  includes: string[];
  fixtures: string[];
  steps: Array<{
    id: string;
    source: UiScenarioStepSource;
    module?: string;
    targetModule?: string;
    operationId?: string;
    method?: string;
    path?: string;
    request?: StepRequest;
    expectedResponse?: OpenApiResponsePreview;
    input?: StepInput;
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
  let resolvedSteps: ASTStep[] = [];
  let targetModules: string[] = [];
  let expectedResponses: Array<OpenApiResponsePreview | undefined> = [];

  try {
    const openApiContext = await loadScenarioOpenApiContext({
      cwd: context.cwd,
      config: context.config,
      scenario,
      cliModuleName: context.options?.module,
      commandName: 'validate',
      requireBaseUrl: false,
    });
    const registryOptions = {
      defaultModuleName: openApiContext.defaultModuleName,
    };
    resolvedSteps = buildAst(scenario, openApiContext.registrySource, registryOptions).steps;
    targetModules = openApiContext.moduleNames ??
      (openApiContext.moduleName === undefined ? [] : [openApiContext.moduleName]);
    expectedResponses = scenario.steps.map((step) => {
      if (isInputStep(step)) {
        return undefined;
      }

      const { registry } = resolveStepRegistry(step, openApiContext.registrySource, registryOptions);
      return buildOpenApiResponsePreview(resolveApiOperation(registry, step.api, step.id).responses);
    });
  } catch {
    // Keep scenario details available when an OpenAPI snapshot is missing or invalid.
  }

  return {
    id: formatUiScenarioOption(context.cwd, path.join(resolveLoadTestDir(context.cwd, context.config), 'scenarios'), scenarioPath),
    name: scenario.name,
    ...(scenario.description === undefined ? {} : { description: scenario.description }),
    path: formatDisplayPath(context.cwd, scenarioPath),
    stepCount: scenario.steps.length,
    modules: analysis.modules,
    ...(targetModules.length === 0 ? {} : { targetModules }),
    env: analysis.env,
    vars: analysis.vars,
    includes: await readScenarioIncludes(scenarioPath),
    fixtures: await readTopLevelStringArray(scenarioPath, 'fixtures'),
    steps: scenario.steps.map((step, index) => {
      const resolvedStep = resolvedSteps[index];
      const resolvedApi = resolvedStep && isASTApiStep(resolvedStep) ? resolvedStep : undefined;
      const definition = stepDefinitions[index];
      const definitionCode = definition === undefined
        ? undefined
        : maskUiYamlDefinitionCode(definition.code);

      return {
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
              ...(resolvedApi?.moduleName === undefined ? {} : { targetModule: resolvedApi.moduleName }),
              ...(step.api.operationId === undefined ? {} : { operationId: step.api.operationId }),
              ...(resolvedApi === undefined
                ? {
                    ...(step.api.method === undefined ? {} : { method: step.api.method }),
                    ...(step.api.path === undefined ? {} : { path: step.api.path }),
                  }
                : { method: resolvedApi.method, path: resolvedApi.path }),
              ...(step.request === undefined && resolvedApi?.request === undefined
                ? {}
                : { request: maskUiPreviewValue(resolvedApi?.request ?? step.request) as StepRequest }),
              ...(expectedResponses[index] === undefined
                ? {}
                : { expectedResponse: maskUiResponsePreview(expectedResponses[index]) }),
              ...(step.condition === undefined ? {} : { condition: step.condition }),
              ...(step.extract === undefined ? {} : { extract: Object.keys(step.extract) }),
            }),
        ...(definition === undefined || definitionCode === undefined
          ? {}
          : { definition: { ...definition, code: definitionCode } }),
      };
    }),
  };
}

export function maskUiYamlDefinitionCode(code: string): string | undefined {
  try {
    const parsed = parseYaml(code);

    if (!Array.isArray(parsed) || parsed.length !== 1) {
      return undefined;
    }

    const step = parsed[0];

    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      return undefined;
    }

    const record = step as Record<string, unknown>;

    if (record.request !== undefined) {
      record.request = maskUiPreviewValue(record.request);
    }

    return stringifyYaml(parsed).trimEnd();
  } catch {
    return undefined;
  }
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

function maskUiResponsePreview(preview: OpenApiResponsePreview): OpenApiResponsePreview {
  return preview.body === undefined
    ? preview
    : { ...preview, body: maskUiPreviewValue(preview.body) };
}

function maskUiPreviewValue(value: unknown, fieldName = '', inheritedSensitive = false): unknown {
  const sensitive = inheritedSensitive || isSensitivePreviewField(fieldName);

  if (Array.isArray(value)) {
    return value.map((item) => maskUiPreviewValue(item, fieldName, sensitive));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskUiPreviewValue(item, key, sensitive)]),
    );
  }

  if (sensitive && !containsTemplateReference(value)) {
    return '***';
  }

  return value;
}

function isSensitivePreviewField(fieldName: string): boolean {
  return /(password|secret|token|api[-_]?key|authorization|cookie)/i.test(fieldName);
}

function containsTemplateReference(value: unknown): boolean {
  return typeof value === 'string' && /\{\{[^{}]+\}\}/.test(value);
}
