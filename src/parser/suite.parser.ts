import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { Suite } from '../core/types.js';

export class SuiteParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuiteParseError';
  }
}

export async function parseSuiteFile(filePath: string): Promise<Suite> {
  const resolvedPath = path.resolve(filePath);
  let source: string;

  try {
    source = await fs.readFile(resolvedPath, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw new SuiteParseError(`${resolvedPath}: suite file was not found`);
    }

    throw error;
  }

  return parseSuiteSource(source, resolvedPath);
}

export function parseSuiteSource(source: string, sourcePath = '<inline>'): Suite {
  let document: unknown;

  try {
    document = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SuiteParseError(`${sourcePath}: failed to parse suite: ${message}`);
  }

  return parseSuiteDocument(document, sourcePath);
}

export function parseSuiteDocument(document: unknown, sourcePath = '<inline>'): Suite {
  const root = expectRecord(document, `${sourcePath}: suite must be an object`);
  const name = expectString(root.name, `${sourcePath}: name must be a string`);

  if (!name.trim()) {
    throw new SuiteParseError(`${sourcePath}: name must not be empty`);
  }

  const description = root.description;

  if (description !== undefined && typeof description !== 'string') {
    throw new SuiteParseError(`${sourcePath}: description must be a string`);
  }

  if (!Array.isArray(root.scenarios) || root.scenarios.length === 0) {
    throw new SuiteParseError(`${sourcePath}: scenarios must be a non-empty array`);
  }

  const scenarios = root.scenarios.map((value, index) =>
    parseSuiteScenarioKey(value, `${sourcePath}: scenarios[${index}]`));
  const duplicate = findDuplicate(scenarios);

  if (duplicate !== undefined) {
    throw new SuiteParseError(`${sourcePath}: scenarios must not contain duplicate scenario key "${duplicate}"`);
  }

  return {
    name,
    ...(description === undefined ? {} : { description }),
    scenarios,
  };
}

function parseSuiteScenarioKey(value: unknown, pathLabel: string): string {
  if (typeof value !== 'string') {
    throw new SuiteParseError(`${pathLabel} must be a string`);
  }

  const scenarioKey = value.trim();

  if (!scenarioKey) {
    throw new SuiteParseError(`${pathLabel} must not be empty`);
  }

  if (scenarioKey.includes('{{')) {
    throw new SuiteParseError(`${pathLabel} must be a static scenario key without templates`);
  }

  if (path.isAbsolute(scenarioKey) || path.win32.isAbsolute(scenarioKey)) {
    throw new SuiteParseError(`${pathLabel} must be relative to the scenario root directory`);
  }

  if (path.extname(scenarioKey) !== '') {
    throw new SuiteParseError(`${pathLabel} must be a scenario key without a file extension`);
  }

  const segments = scenarioKey.split(/[\\/]+/);

  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new SuiteParseError(`${pathLabel} must be a scenario key without empty, . or .. segments`);
  }

  return segments.join('/');
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SuiteParseError(message);
  }

  return value as Record<string, unknown>;
}

function expectString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new SuiteParseError(message);
  }

  return value;
}

function findDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }

    seen.add(value);
  }

  return undefined;
}
