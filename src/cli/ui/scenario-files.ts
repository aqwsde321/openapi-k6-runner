import fs from 'node:fs/promises';
import path from 'node:path';
import { isMap, isSeq, parse as parseYaml, parseDocument, type YAMLMap } from 'yaml';

import type {
  UiScenarioStepSource,
  UiScenarioStepSourceReference,
} from './run-state.js';

export interface UiScenarioReaderContext {
  resolveScenarioPath(value: string): string;
  formatDisplayPath(filePath: string): string;
}

export interface UiScenarioStepDefinition {
  path: string;
  code: string;
  lineage?: UiScenarioStepDefinition[];
}

export async function readTopLevelStringArray(filePath: string, key: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  const value = (parsed as Record<string, unknown>)[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

export async function readScenarioIncludes(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  const steps = (parsed as Record<string, unknown>).steps;

  if (!Array.isArray(steps)) {
    return [];
  }

  return steps.flatMap((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      return [];
    }

    const record = step as Record<string, unknown>;
    return [
      typeof record.include === 'string' ? record.include : undefined,
      typeof record.use === 'string' ? record.use : undefined,
    ].filter((item): item is string => item !== undefined);
  });
}

export async function readUiScenarioStepSources(
  context: UiScenarioReaderContext,
  filePath: string,
): Promise<UiScenarioStepSource[]> {
  try {
    return await readUiScenarioStepSourcesInternal(context, path.resolve(filePath), new Set());
  } catch {
    return [];
  }
}

async function readUiScenarioStepSourcesInternal(
  context: UiScenarioReaderContext,
  filePath: string,
  stack: Set<string>,
): Promise<UiScenarioStepSource[]> {
  if (stack.has(filePath)) {
    return [];
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  const steps = (parsed as Record<string, unknown>).steps;

  if (!Array.isArray(steps)) {
    return [];
  }

  const nextStack = new Set(stack);
  nextStack.add(filePath);
  const sources: UiScenarioStepSource[] = [];

  for (const step of steps) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      sources.push({ kind: 'direct' });
      continue;
    }

    const record = step as Record<string, unknown>;
    const useReference = typeof record.use === 'string' ? record.use : undefined;
    const includeReference = typeof record.include === 'string' ? record.include : undefined;

    if (useReference !== undefined) {
      const nestedPath = context.resolveScenarioPath(useReference);
      const nestedSources = await readUiScenarioStepSourcesInternal(context, nestedPath, nextStack);
      sources.push(...nestedSources.map((source) => prependUiScenarioStepSource(source, {
        kind: 'use',
        reference: useReference,
      })));
      continue;
    }

    if (includeReference !== undefined) {
      const nestedPath = path.resolve(path.dirname(filePath), includeReference);
      const nestedSources = await readUiScenarioStepSourcesInternal(context, nestedPath, nextStack);
      sources.push(...nestedSources.map((source) => prependUiScenarioStepSource(source, {
        kind: 'include',
        reference: includeReference,
      })));
      continue;
    }

    sources.push({ kind: 'direct' });
  }

  return sources;
}

function prependUiScenarioStepSource(
  source: UiScenarioStepSource,
  parent: UiScenarioStepSourceReference,
): UiScenarioStepSource {
  const nestedLineage = source.lineage ?? (
    source.kind === 'direct' || source.reference === undefined
      ? []
      : [{ kind: source.kind, reference: source.reference }]
  );

  return nestedLineage.length === 0
    ? parent
    : { ...parent, lineage: [parent, ...nestedLineage] };
}

export async function readUiScenarioStepDefinitions(
  context: UiScenarioReaderContext,
  filePath: string,
): Promise<UiScenarioStepDefinition[]> {
  try {
    return await readUiScenarioStepDefinitionsInternal(context, path.resolve(filePath), new Set());
  } catch {
    return [];
  }
}

async function readUiScenarioStepDefinitionsInternal(
  context: UiScenarioReaderContext,
  filePath: string,
  stack: Set<string>,
): Promise<UiScenarioStepDefinition[]> {
  if (stack.has(filePath)) {
    return [];
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const document = parseDocument(raw, { keepSourceTokens: true });

  if (document.errors.length > 0 || !isMap(document.contents)) {
    return [];
  }

  const steps = document.contents.get('steps', true);

  if (!isSeq(steps)) {
    return [];
  }

  const nextStack = new Set(stack);
  nextStack.add(filePath);
  const definitions: UiScenarioStepDefinition[] = [];

  for (const step of steps.items) {
    if (!isMap(step)) {
      continue;
    }

    const useReference = readYamlMapString(step, 'use');
    const includeReference = readYamlMapString(step, 'include');

    if (useReference !== undefined) {
      const nestedPath = context.resolveScenarioPath(useReference);
      const nestedDefinitions = await readUiScenarioStepDefinitionsInternal(context, nestedPath, nextStack);
      const nestedDefinition = await readUiScenarioDefinition(context, nestedPath);
      definitions.push(...nestedDefinitions.map((definition) => (
        prependUiScenarioStepDefinition(definition, nestedDefinition)
      )));
      continue;
    }

    if (includeReference !== undefined) {
      const nestedPath = path.resolve(path.dirname(filePath), includeReference);
      const nestedDefinitions = await readUiScenarioStepDefinitionsInternal(context, nestedPath, nextStack);
      const nestedDefinition = await readUiScenarioDefinition(context, nestedPath);
      definitions.push(...nestedDefinitions.map((definition) => (
        prependUiScenarioStepDefinition(definition, nestedDefinition)
      )));
      continue;
    }

    const code = formatYamlNodeSnippet(raw, step);

    if (code !== undefined) {
      definitions.push({
        path: context.formatDisplayPath(filePath),
        code,
      });
    }
  }

  return definitions;
}

async function readUiScenarioDefinition(
  context: UiScenarioReaderContext,
  filePath: string,
): Promise<UiScenarioStepDefinition> {
  return {
    path: context.formatDisplayPath(filePath),
    code: await fs.readFile(filePath, 'utf8'),
  };
}

function prependUiScenarioStepDefinition(
  definition: UiScenarioStepDefinition,
  parent: UiScenarioStepDefinition,
): UiScenarioStepDefinition {
  return {
    ...definition,
    lineage: [parent, ...(definition.lineage ?? [])],
  };
}

function readYamlMapString(node: YAMLMap, key: string): string | undefined {
  const value = node.get(key);
  return typeof value === 'string' ? value : undefined;
}

function formatYamlNodeSnippet(raw: string, node: unknown): string | undefined {
  const range = readYamlNodeRange(node);

  if (range === undefined) {
    return undefined;
  }

  const lineStart = raw.lastIndexOf('\n', Math.max(0, range[0] - 1)) + 1;
  return dedentYamlSnippet(raw.slice(lineStart, range[1]));
}

function readYamlNodeRange(node: unknown): [number, number, number?] | undefined {
  const range = node && typeof node === 'object'
    ? (node as { range?: unknown }).range
    : undefined;

  if (
    Array.isArray(range) &&
    typeof range[0] === 'number' &&
    typeof range[1] === 'number'
  ) {
    return [range[0], range[1], typeof range[2] === 'number' ? range[2] : undefined];
  }

  return undefined;
}

function dedentYamlSnippet(value: string): string {
  const lines = value.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.match(/^ */)?.[0].length ?? 0);
  const indent = indents.length === 0 ? 0 : Math.min(...indents);

  return lines.map((line) => line.trim() === '' ? '' : line.slice(indent)).join('\n');
}
