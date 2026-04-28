import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { ApiReference, ExtractRule, MultipartFile, MultipartRequest, Scenario, Step, StepRequest } from '../core/types.js';

export class ScenarioParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioParseError';
  }
}

export async function parseScenarioFile(filePath: string): Promise<Scenario> {
  const source = await fs.readFile(filePath, 'utf8');
  return parseScenarioSource(source, filePath);
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

  if (!name.trim()) {
    throw new ScenarioParseError(`${sourcePath}: name must not be empty`);
  }

  if (!Array.isArray(root.steps) || root.steps.length === 0) {
    throw new ScenarioParseError(`${sourcePath}: steps must be a non-empty array`);
  }

  const usedStepIds = new Set<string>();
  const steps = root.steps.map((stepValue, index) => {
    const stepPath = `${sourcePath}: steps[${index}]`;
    const step = parseStep(stepValue, stepPath);

    if (usedStepIds.has(step.id)) {
      throw new ScenarioParseError(`${stepPath}: duplicate step id "${step.id}"`);
    }

    usedStepIds.add(step.id);
    return step;
  });

  return { name, steps };
}

function parseStep(value: unknown, stepPath: string): Step {
  const rawStep = expectRecord(value, `${stepPath}: step must be an object`);
  const id = expectString(rawStep.id, `${stepPath}: id must be a string`);

  if (!id.trim()) {
    throw new ScenarioParseError(`${stepPath}: id must not be empty`);
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

function parseApiReference(value: unknown, path: string): ApiReference {
  const api = expectRecord(value, `${path}: api must be an object`);
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
    ...(operationId === undefined ? {} : { operationId }),
    ...(method === undefined ? {} : { method }),
    ...(endpointPath === undefined ? {} : { path: endpointPath }),
  };
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
    throw new ScenarioParseError(`${pathLabel} must be relative to the load-tests directory`);
  }

  if (trimmed.split(/[\\/]+/).includes('..')) {
    throw new ScenarioParseError(`${pathLabel} must stay inside the load-tests directory`);
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
