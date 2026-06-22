import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { formatScenarioVarNameIssue } from '../core/scenario-vars.js';
import type { Scenario } from '../core/types.js';

export interface ScenarioVarOverrideOptions {
  varFile?: string[];
  var?: string[];
}

export async function applyScenarioVarOverrides(
  cwd: string,
  scenario: Scenario,
  options: ScenarioVarOverrideOptions,
): Promise<Scenario> {
  const fileVars = await loadScenarioVarFiles(cwd, normalizeRepeatedOption(options.varFile));
  const inlineVars = parseInlineScenarioVars(normalizeRepeatedOption(options.var));
  const mergedVars = {
    ...(scenario.vars ?? {}),
    ...fileVars,
    ...inlineVars,
  };

  if (Object.keys(mergedVars).length === 0 && scenario.vars === undefined) {
    return scenario;
  }

  return {
    ...scenario,
    vars: mergedVars,
  };
}

async function loadScenarioVarFiles(
  cwd: string,
  values: string[],
): Promise<Record<string, unknown>> {
  const vars: Record<string, unknown> = {};

  for (const value of values) {
    const filePath = path.resolve(cwd, value);
    Object.assign(vars, await loadScenarioVarFile(filePath));
  }

  return vars;
}

async function loadScenarioVarFile(filePath: string): Promise<Record<string, unknown>> {
  let source: string;
  let document: unknown;

  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      throw new Error(`${filePath}: var file was not found`);
    }

    throw error;
  }

  try {
    document = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${filePath}: failed to parse var file: ${message}`);
  }

  return parseScenarioVarsRecord(document, `${filePath}: var file`);
}

function parseInlineScenarioVars(values: string[]): Record<string, unknown> {
  const vars: Record<string, unknown> = {};

  for (const value of values) {
    const separatorIndex = value.indexOf('=');

    if (separatorIndex <= 0) {
      throw new Error(`--var must use name=value syntax: ${JSON.stringify(value)}`);
    }

    const name = value.slice(0, separatorIndex).trim();
    const rawValue = value.slice(separatorIndex + 1);

    validateScenarioVarName(name, '--var');
    vars[name] = parseInlineScenarioVarValue(name, rawValue);
  }

  return vars;
}

function parseInlineScenarioVarValue(name: string, value: string): unknown {
  if (value === '') {
    return '';
  }

  try {
    return parseYaml(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse --var ${name}: ${message}`);
  }
}

function parseScenarioVarsRecord(value: unknown, pathLabel: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an object`);
  }

  const vars = value as Record<string, unknown>;

  for (const key of Object.keys(vars)) {
    validateScenarioVarName(key, `${pathLabel}.${key}`);
  }

  return { ...vars };
}

function validateScenarioVarName(name: string, pathLabel: string): void {
  const issue = formatScenarioVarNameIssue(name, pathLabel);

  if (issue !== undefined) {
    throw new Error(issue);
  }
}

function normalizeRepeatedOption(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === code,
  );
}
