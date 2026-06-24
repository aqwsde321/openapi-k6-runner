import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { formatScenarioVarNameIssue } from '../core/scenario-vars.js';
import type { ApiReference, ExtractRule, MultipartFile, MultipartRequest, Scenario, Step, StepInput, StepRequest } from '../core/types.js';

interface ParsedStepEntry {
  step: Step;
  stepPath: string;
}

export interface ScenarioParseOptions {
  scenarioRootDir?: string;
}

interface ScenarioFileParseContext {
  entryDir: string;
  includeRootDir: string;
  includeRootLabel: string;
  scenarioRootDir?: string;
  stack: string[];
}

export class ScenarioParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioParseError';
  }
}

export async function parseScenarioFile(
  filePath: string,
  options: ScenarioParseOptions = {},
): Promise<Scenario> {
  const resolvedPath = path.resolve(filePath);
  const scenarioRootDir = options.scenarioRootDir === undefined
    ? undefined
    : path.resolve(options.scenarioRootDir);
  const parsed = await parseScenarioFileInternal(
    resolvedPath,
    {
      entryDir: path.dirname(resolvedPath),
      includeRootDir: path.dirname(resolvedPath),
      includeRootLabel: 'entry scenario directory',
      ...(scenarioRootDir === undefined ? {} : { scenarioRootDir }),
      stack: [resolvedPath],
    },
    true,
  );

  if (parsed.name === undefined) {
    throw new ScenarioParseError(`${resolvedPath}: name must be a string`);
  }

  return {
    name: parsed.name,
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
    ...(parsed.vars === undefined ? {} : { vars: parsed.vars }),
    steps: finalizeSteps(parsed.steps),
  };
}

export function parseScenarioSource(source: string, sourcePath = '<inline>'): Scenario {
  let document: unknown;

  try {
    document = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ScenarioParseError(`${sourcePath}: failed to parse scenario DSL: ${message}`);
  }

  return parseScenarioDocument(document, sourcePath);
}

export function parseScenarioDocument(document: unknown, sourcePath = '<inline>'): Scenario {
  const root = expectRecord(document, `${sourcePath}: scenario must be an object`);
  const name = expectString(root.name, `${sourcePath}: name must be a string`);

  if (root.fixtures !== undefined) {
    throw new ScenarioParseError(`${sourcePath}: fixtures require parseScenarioFile`);
  }

  const description = parseScenarioDescription(root.description, sourcePath);

  const vars = root.vars === undefined
    ? undefined
    : parseVars(root.vars, `${sourcePath}: vars`);

  if (!name.trim()) {
    throw new ScenarioParseError(`${sourcePath}: name must not be empty`);
  }

  if (!Array.isArray(root.steps) || root.steps.length === 0) {
    throw new ScenarioParseError(`${sourcePath}: steps must be a non-empty array`);
  }

  const steps = finalizeSteps(root.steps.map((stepValue, index) => {
    const stepPath = `${sourcePath}: steps[${index}]`;
    return {
      step: parseStepOrRejectInclude(stepValue, stepPath),
      stepPath,
    };
  }));

  return {
    name,
    ...(description === undefined ? {} : { description }),
    ...(vars === undefined ? {} : { vars }),
    steps,
  };
}

async function parseScenarioFileInternal(
  filePath: string,
  context: ScenarioFileParseContext,
  requireName: boolean,
): Promise<{ name?: string; description?: string; vars?: Record<string, unknown>; steps: ParsedStepEntry[] }> {
  let source: string;
  let document: unknown;

  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw new ScenarioParseError(`${filePath}: scenario file was not found`);
    }

    throw error;
  }

  try {
    document = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ScenarioParseError(`${filePath}: failed to parse scenario DSL: ${message}`);
  }

  const root = expectRecord(document, `${filePath}: scenario must be an object`);
  const name = parseScenarioName(root.name, filePath, requireName);
  const description = requireName
    ? parseScenarioDescription(root.description, filePath)
    : undefined;
  const fixtureVars = await parseScenarioFixtureVars(root.fixtures, filePath, requireName, context);
  const ownVars = parseScenarioVars(root.vars, filePath, requireName);
  const vars = mergeScenarioVars(fixtureVars, ownVars);
  const steps = await parseFileStepEntries(root.steps, filePath, context);

  return {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(vars === undefined ? {} : { vars }),
    steps,
  };
}

function parseScenarioName(value: unknown, sourcePath: string, requireName: boolean): string | undefined {
  if (value === undefined && !requireName) {
    return undefined;
  }

  const name = expectString(value, `${sourcePath}: name must be a string`);

  if (!name.trim()) {
    throw new ScenarioParseError(`${sourcePath}: name must not be empty`);
  }

  return name;
}

function parseScenarioDescription(value: unknown, sourcePath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectString(value, `${sourcePath}: description must be a string`);
}

function parseScenarioVars(
  value: unknown,
  sourcePath: string,
  isEntryScenario: boolean,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isEntryScenario) {
    throw new ScenarioParseError(`${sourcePath}: included scenario files must not define vars; define vars in the entry scenario`);
  }

  return parseVars(value, `${sourcePath}: vars`);
}

async function parseScenarioFixtureVars(
  value: unknown,
  sourcePath: string,
  isEntryScenario: boolean,
  context: ScenarioFileParseContext,
): Promise<Record<string, unknown> | undefined> {
  if (value === undefined) {
    return undefined;
  }

  if (!isEntryScenario) {
    throw new ScenarioParseError(`${sourcePath}: included scenario files must not define fixtures; define fixtures in the entry scenario`);
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new ScenarioParseError(`${sourcePath}: fixtures must be a non-empty array`);
  }

  const vars: Record<string, unknown> = {};

  for (const [index, rawFixturePath] of value.entries()) {
    const fixturePath = parseFixturePath(rawFixturePath, `${sourcePath}: fixtures[${index}]`);
    const resolvedPath = resolveScenarioLocalPath(
      fixturePath,
      `${sourcePath}: fixtures[${index}]`,
      sourcePath,
      context,
    );

    Object.assign(vars, await readFixtureVars(resolvedPath));
  }

  return vars;
}

function mergeScenarioVars(
  fixtureVars: Record<string, unknown> | undefined,
  ownVars: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (fixtureVars === undefined && ownVars === undefined) {
    return undefined;
  }

  return {
    ...(fixtureVars ?? {}),
    ...(ownVars ?? {}),
  };
}

async function readFixtureVars(filePath: string): Promise<Record<string, unknown>> {
  let source: string;
  let document: unknown;

  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      throw new ScenarioParseError(`${filePath}: fixture file was not found`);
    }

    throw error;
  }

  try {
    document = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ScenarioParseError(`${filePath}: failed to parse fixture: ${message}`);
  }

  return parseVars(document, `${filePath}: fixture`);
}

function parseVars(value: unknown, pathLabel: string): Record<string, unknown> {
  const vars = expectRecord(value, `${pathLabel} must be an object`);

  for (const key of Object.keys(vars)) {
    const issue = formatScenarioVarNameIssue(key, `${pathLabel}.${key}`);

    if (issue !== undefined) {
      throw new ScenarioParseError(issue);
    }
  }

  return { ...vars };
}

async function parseFileStepEntries(
  value: unknown,
  sourcePath: string,
  context: ScenarioFileParseContext,
): Promise<ParsedStepEntry[]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ScenarioParseError(`${sourcePath}: steps must be a non-empty array`);
  }

  const entries: ParsedStepEntry[] = [];

  for (const [index, stepValue] of value.entries()) {
    const stepPath = `${sourcePath}: steps[${index}]`;
    const stepReference = parseStepReference(stepValue, stepPath);

    if (stepReference !== undefined) {
      const referencedPath = stepReference.kind === 'include'
        ? resolveIncludePath(stepReference.value, stepPath, sourcePath, context)
        : resolveUsePath(stepReference.value, stepPath, context);
      const includeRoot = stepReference.kind === 'include'
        ? {
            includeRootDir: context.includeRootDir,
            includeRootLabel: context.includeRootLabel,
          }
        : {
            includeRootDir: context.scenarioRootDir ?? context.includeRootDir,
            includeRootLabel: 'scenario root directory',
          };
      entries.push(...(await parseIncludedScenarioFile(referencedPath, context, includeRoot)));
      continue;
    }

    entries.push({
      step: parseStep(stepValue, stepPath),
      stepPath,
    });
  }

  return entries;
}

async function parseIncludedScenarioFile(
  filePath: string,
  context: ScenarioFileParseContext,
  includeRoot: Pick<ScenarioFileParseContext, 'includeRootDir' | 'includeRootLabel'>,
): Promise<ParsedStepEntry[]> {
  if (context.stack.includes(filePath)) {
    const cycle = [...context.stack, filePath].map((entry) => path.relative(context.entryDir, entry) || '.').join(' -> ');
    throw new ScenarioParseError(`${filePath}: include cycle detected: ${cycle}`);
  }

  const scenario = await parseScenarioFileInternal(
    filePath,
    {
      ...includeRoot,
      entryDir: context.entryDir,
      ...(context.scenarioRootDir === undefined ? {} : { scenarioRootDir: context.scenarioRootDir }),
      stack: [...context.stack, filePath],
    },
    false,
  );

  return scenario.steps;
}

function parseStepOrRejectInclude(value: unknown, stepPath: string): Step {
  const stepReference = parseStepReference(value, stepPath);

  if (stepReference !== undefined) {
    throw new ScenarioParseError(`${stepPath}: ${stepReference.kind} steps require parseScenarioFile`);
  }

  return parseStep(value, stepPath);
}

function parseStepReference(
  value: unknown,
  stepPath: string,
): { kind: 'include' | 'use'; value: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const rawStep = value as Record<string, unknown>;
  const hasInclude = 'include' in rawStep;
  const hasUse = 'use' in rawStep;

  if (!hasInclude && !hasUse) {
    return undefined;
  }

  if (hasInclude && hasUse) {
    throw new ScenarioParseError(`${stepPath}: step can contain only one of include or use`);
  }

  const kind = hasInclude ? 'include' : 'use';
  const keys = Object.keys(rawStep);

  if (keys.length !== 1) {
    throw new ScenarioParseError(`${stepPath}: ${kind} step can only contain ${kind}`);
  }

  return {
    kind,
    value: kind === 'include'
      ? parseIncludePath(rawStep.include, `${stepPath}.include`)
      : parseUsePath(rawStep.use, `${stepPath}.use`),
  };
}

function parseIncludePath(value: unknown, pathLabel: string): string {
  return parseScenarioLocalPath(value, pathLabel);
}

function parseUsePath(value: unknown, pathLabel: string): string {
  return parseScenarioRootPath(value, pathLabel);
}

function parseFixturePath(value: unknown, pathLabel: string): string {
  return parseScenarioLocalPath(value, pathLabel);
}

function parseScenarioLocalPath(value: unknown, pathLabel: string): string {
  if (typeof value !== 'string') {
    throw new ScenarioParseError(`${pathLabel} must be a string`);
  }

  const localPath = value.trim();

  if (!localPath) {
    throw new ScenarioParseError(`${pathLabel} must not be empty`);
  }

  if (localPath.includes('{{')) {
    throw new ScenarioParseError(`${pathLabel} must be a static path without templates`);
  }

  if (path.isAbsolute(localPath)) {
    throw new ScenarioParseError(`${pathLabel} must be relative to the entry scenario directory`);
  }

  return localPath;
}

function resolveIncludePath(
  includePath: string,
  stepPath: string,
  sourcePath: string,
  context: ScenarioFileParseContext,
): string {
  return resolveScenarioLocalPath(includePath, `${stepPath}.include`, sourcePath, context);
}

function resolveUsePath(
  usePath: string,
  stepPath: string,
  context: ScenarioFileParseContext,
): string {
  if (context.scenarioRootDir === undefined) {
    throw new ScenarioParseError(`${stepPath}.use requires scenarioRootDir`);
  }

  const resolvedPath = path.resolve(context.scenarioRootDir, usePath);
  const relativePath = path.relative(context.scenarioRootDir, resolvedPath);

  if (!isLocalRelativePath(relativePath)) {
    throw new ScenarioParseError(`${stepPath}.use must stay inside the scenario root directory`);
  }

  return resolvedPath;
}

function resolveScenarioLocalPath(
  localPath: string,
  pathLabel: string,
  sourcePath: string,
  context: ScenarioFileParseContext,
): string {
  const resolvedPath = path.resolve(path.dirname(sourcePath), localPath);
  const relativePath = path.relative(context.includeRootDir, resolvedPath);

  if (!isLocalRelativePath(relativePath)) {
    throw new ScenarioParseError(`${pathLabel} must stay inside the ${context.includeRootLabel}`);
  }

  return resolvedPath;
}

function parseScenarioRootPath(value: unknown, pathLabel: string): string {
  if (typeof value !== 'string') {
    throw new ScenarioParseError(`${pathLabel} must be a string`);
  }

  const scenarioKey = value.trim();

  if (!scenarioKey) {
    throw new ScenarioParseError(`${pathLabel} must not be empty`);
  }

  if (scenarioKey.includes('{{')) {
    throw new ScenarioParseError(`${pathLabel} must be a static path without templates`);
  }

  if (path.isAbsolute(scenarioKey) || path.win32.isAbsolute(scenarioKey)) {
    throw new ScenarioParseError(`${pathLabel} must be relative to the scenario root directory`);
  }

  if (path.extname(scenarioKey) !== '') {
    throw new ScenarioParseError(`${pathLabel} must be a scenario key without a file extension`);
  }

  const segments = scenarioKey.split(/[\\/]+/);

  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ScenarioParseError(`${pathLabel} must be a scenario key without empty, . or .. segments`);
  }

  return `${segments.join(path.sep)}.yaml`;
}

function isLocalRelativePath(relativePath: string): boolean {
  return relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath) &&
    !path.win32.isAbsolute(relativePath);
}

function finalizeSteps(entries: ParsedStepEntry[]): Step[] {
  const usedStepIds = new Set<string>();
  const steps: Step[] = [];

  for (const entry of entries) {
    if (usedStepIds.has(entry.step.id)) {
      throw new ScenarioParseError(`${entry.stepPath}: duplicate step id "${entry.step.id}"`);
    }

    usedStepIds.add(entry.step.id);
    steps.push(entry.step);
  }

  return steps;
}

function parseStep(value: unknown, stepPath: string): Step {
  const rawStep = expectRecord(value, `${stepPath}: step must be an object`);
  const id = expectString(rawStep.id, `${stepPath}: id must be a string`);

  if (!id.trim()) {
    throw new ScenarioParseError(`${stepPath}: id must not be empty`);
  }

  if (rawStep.input !== undefined) {
    if (rawStep.api !== undefined) {
      throw new ScenarioParseError(`${stepPath}: step can contain only one of api or input`);
    }

    for (const key of ['request', 'extract', 'condition']) {
      if (rawStep[key] !== undefined) {
        throw new ScenarioParseError(`${stepPath}: input step cannot contain ${key}`);
      }
    }

    return {
      id,
      input: parseStepInput(rawStep.input, `${stepPath}.input`),
    };
  }

  const api = parseApiReference(rawStep.api, `${stepPath}.api`);
  const request = rawStep.request === undefined
    ? undefined
    : parseStepRequest(rawStep.request, `${stepPath}.request`);
  const extract = rawStep.extract === undefined
    ? undefined
    : parseExtract(rawStep.extract, `${stepPath}.extract`);
  const condition = rawStep.condition === undefined
    ? undefined
    : expectString(rawStep.condition, `${stepPath}.condition must be a string`);

  return {
    id,
    api,
    ...(request === undefined ? {} : { request }),
    ...(extract === undefined ? {} : { extract }),
    ...(condition === undefined ? {} : { condition }),
  };
}

function parseStepInput(value: unknown, pathLabel: string): StepInput {
  const input = expectRecord(value, `${pathLabel}: input must be an object`);
  const name = expectString(input.name, `${pathLabel}.name must be a string`).trim();
  const nameIssue = formatScenarioVarNameIssue(name, `${pathLabel}.name`);
  const label = input.label === undefined
    ? undefined
    : expectString(input.label, `${pathLabel}.label must be a string`).trim();
  const required = input.required === undefined
    ? true
    : expectBoolean(input.required, `${pathLabel}.required must be a boolean`);
  const sensitive = input.sensitive === undefined
    ? false
    : expectBoolean(input.sensitive, `${pathLabel}.sensitive must be a boolean`);

  if (nameIssue !== undefined) {
    throw new ScenarioParseError(nameIssue.replace(' for {{vars.NAME}} references', ' for {{NAME}} references'));
  }

  if (label !== undefined && !label) {
    throw new ScenarioParseError(`${pathLabel}.label must not be empty`);
  }

  return {
    name,
    ...(label === undefined ? {} : { label }),
    required,
    ...(sensitive ? { sensitive } : {}),
  };
}

function parseApiReference(value: unknown, path: string): ApiReference {
  const api = expectRecord(value, `${path}: api must be an object`);
  const moduleName = parseOptionalApiModule(api.module, `${path}.module`);
  const operationId = optionalNonEmptyString(api.operationId, `${path}.operationId must be a string`);
  const method = optionalNonEmptyString(api.method, `${path}.method must be a string`);
  const endpointPath = optionalNonEmptyString(api.path, `${path}.path must be a string`);
  const hasOperationId = operationId !== undefined;
  const hasMethod = method !== undefined;
  const hasPath = endpointPath !== undefined;

  if (!hasOperationId && !(hasMethod && hasPath)) {
    throw new ScenarioParseError(
      `${path}: api must include operationId or both method and path`,
    );
  }

  return {
    ...(moduleName === undefined ? {} : { module: moduleName }),
    ...(operationId === undefined ? {} : { operationId }),
    ...(method === undefined ? {} : { method }),
    ...(endpointPath === undefined ? {} : { path: endpointPath }),
  };
}

function parseOptionalApiModule(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new ScenarioParseError(`${path} must be a string`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new ScenarioParseError(`${path} must not be empty`);
  }

  return trimmed;
}

function parseStepRequest(value: unknown, path: string): StepRequest {
  const request = expectRecord(value, `${path}: request must be an object`);
  const headers = request.headers === undefined
    ? undefined
    : expectRecord(request.headers, `${path}.headers must be an object`);
  const query = request.query === undefined
    ? undefined
    : expectRecord(request.query, `${path}.query must be an object`);
  const pathParams = request.pathParams === undefined
    ? undefined
    : expectRecord(request.pathParams, `${path}.pathParams must be an object`);
  const multipart = request.multipart === undefined
    ? undefined
    : parseMultipartRequest(request.multipart, `${path}.multipart`);

  if (request.body !== undefined && multipart !== undefined) {
    throw new ScenarioParseError(`${path}: request.body and request.multipart cannot be used together`);
  }

  return {
    ...(headers === undefined ? {} : { headers }),
    ...(query === undefined ? {} : { query }),
    ...(pathParams === undefined ? {} : { pathParams }),
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(multipart === undefined ? {} : { multipart }),
  };
}

function parseMultipartRequest(value: unknown, path: string): MultipartRequest {
  const multipart = expectRecord(value, `${path}: multipart must be an object`);
  const fields = multipart.fields === undefined
    ? undefined
    : expectRecord(multipart.fields, `${path}.fields must be an object`);
  const files = expectRecord(multipart.files, `${path}.files must be an object`);

  if (Object.keys(files).length === 0) {
    throw new ScenarioParseError(`${path}.files must include at least one file field`);
  }

  for (const fieldName of Object.keys(fields ?? {})) {
    if (fieldName in files) {
      throw new ScenarioParseError(`${path}: fields.${fieldName} conflicts with files.${fieldName}`);
    }
  }

  return {
    ...(fields === undefined ? {} : { fields }),
    files: parseMultipartFiles(files, `${path}.files`),
  };
}

function parseMultipartFiles(value: Record<string, unknown>, path: string): Record<string, MultipartFile> {
  const files: Record<string, MultipartFile> = {};

  for (const [fieldName, rawFile] of Object.entries(value)) {
    if (!fieldName.trim()) {
      throw new ScenarioParseError(`${path}: file field name must not be empty`);
    }

    const file = expectRecord(rawFile, `${path}.${fieldName} must be an object`);
    const filePath = expectString(file.path, `${path}.${fieldName}.path must be a string`);
    const filename = file.filename === undefined
      ? undefined
      : expectString(file.filename, `${path}.${fieldName}.filename must be a string`);
    const contentType = file.contentType === undefined
      ? undefined
      : expectString(file.contentType, `${path}.${fieldName}.contentType must be a string`);

    const normalizedFilePath = validateFixturePath(filePath, `${path}.${fieldName}.path`);

    if (filename !== undefined && !filename.trim()) {
      throw new ScenarioParseError(`${path}.${fieldName}.filename must not be empty`);
    }

    if (contentType !== undefined && !contentType.trim()) {
      throw new ScenarioParseError(`${path}.${fieldName}.contentType must not be empty`);
    }

    files[fieldName] = {
      path: normalizedFilePath,
      ...(filename === undefined ? {} : { filename: filename.trim() }),
      ...(contentType === undefined ? {} : { contentType: contentType.trim() }),
    };
  }

  return files;
}

function validateFixturePath(value: string, pathLabel: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new ScenarioParseError(`${pathLabel} must not be empty`);
  }

  if (trimmed.includes('{{')) {
    throw new ScenarioParseError(`${pathLabel} must be a static path without templates`);
  }

  if (path.isAbsolute(trimmed)) {
    throw new ScenarioParseError(`${pathLabel} must be relative to the workspace directory`);
  }

  if (trimmed.split(/[\\/]+/).includes('..')) {
    throw new ScenarioParseError(`${pathLabel} must stay inside the workspace directory`);
  }

  return trimmed;
}

function parseExtract(value: unknown, path: string): Record<string, ExtractRule> {
  const extract = expectRecord(value, `${path}: extract must be an object`);
  const rules: Record<string, ExtractRule> = {};

  for (const [variableName, rawRule] of Object.entries(extract)) {
    if (!variableName.trim()) {
      throw new ScenarioParseError(`${path}: extract variable name must not be empty`);
    }

    const rule = expectRecord(rawRule, `${path}.${variableName}: extract rule must be an object`);
    const from = expectString(
      rule.from,
      `${path}.${variableName}.from must be a string`,
    );

    if (!from.trim()) {
      throw new ScenarioParseError(`${path}.${variableName}.from must not be empty`);
    }

    rules[variableName] = { from };
  }

  return rules;
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ScenarioParseError(message);
  }

  return value as Record<string, unknown>;
}

function expectString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new ScenarioParseError(message);
  }

  return value;
}

function expectBoolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ScenarioParseError(message);
  }

  return value;
}

function optionalString(value: unknown, message: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectString(value, message);
}

function optionalNonEmptyString(value: unknown, message: string): string | undefined {
  const parsed = optionalString(value, message);

  if (parsed === undefined) {
    return undefined;
  }

  const trimmed = parsed.trim();
  return trimmed ? trimmed : undefined;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
