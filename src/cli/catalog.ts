import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  ApiCatalog,
  ApiCatalogExtractCandidate,
  ApiCatalogOperation,
  ApiCatalogRequestBodyFieldHint,
  ApiCatalogRequestBodyHint,
} from '../core/types.js';
import type { LoadTestConfig } from '../config/load-test.config.js';
import { HTTP_METHOD_ORDER } from '../openapi/openapi.parser.js';
import { DEFAULT_WORKSPACE_DIR } from '../scaffold/load-test.init.js';

type WritableLike = {
  write(chunk: string): unknown;
};

export interface CatalogOptions {
  config?: string;
  module?: string;
  query?: string;
  method?: string;
  tag?: string;
  all?: boolean;
  sync?: boolean;
  ai?: boolean;
  snippet?: boolean;
  json?: boolean;
}

export interface CatalogFilters {
  query?: string;
  method?: string;
  tag?: string;
  all?: boolean;
}

export interface CatalogCommandContext {
  cwd: string;
  config: LoadTestConfig | undefined;
  moduleName: string | undefined;
  openapi: string | undefined;
  options: CatalogOptions;
}

export interface CatalogResult {
  catalogPath: string;
  source: string;
  generatedAt: string;
  totalOperationCount: number;
  operations: ApiCatalogOperation[];
  tagCounts: Array<{ tag: string; count: number }>;
  warnings: string[];
  filters: CatalogFilters;
  moduleName?: string;
  synced?: {
    snapshotPath: string;
    catalogPath: string;
    openapiPath: string;
    operationCount: number;
    moduleName?: string;
  };
}

const DEFAULT_LOAD_TEST_DIR = DEFAULT_WORKSPACE_DIR;
const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;
const TODO_VALUE = 'TODO';

function writeLine(stream: WritableLike, message: string): void {
  stream.write(`${message}\n`);
}

function formatDisplayPath(cwd: string, filePath: string): string {
  const relativePath = path.relative(cwd, filePath);

  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return normalizeCommandPath(relativePath);
  }

  return filePath;
}

function normalizeCommandPath(value: string): string {
  return value.split(path.sep).join('/');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value.trim().toUpperCase() !== TODO_VALUE;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}

export async function readCatalogFile(
  catalogPath: string,
  context: CatalogCommandContext,
): Promise<ApiCatalog> {
  let raw: string;

  try {
    raw = await fs.readFile(catalogPath, 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      throw new Error(formatMissingCatalogFileError(catalogPath, context));
    }

    throw error;
  }

  try {
    return parseCatalog(JSON.parse(raw), catalogPath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${catalogPath}: failed to parse catalog JSON: ${error.message}`);
    }

    throw error;
  }
}

function formatMissingCatalogFileError(
  catalogPath: string,
  context: CatalogCommandContext,
): string {
  const openApiSetupLines = formatCatalogOpenApiSetupLines(context);

  return [
    `${catalogPath} was not found.`,
    '',
    ...openApiSetupLines,
    openApiSetupLines.length > 0 ? 'Then run:' : 'Run this first:',
    `  ${formatCatalogSyncCommand(context)}`,
    '',
    'Then retry:',
    `  ${formatCatalogRetryCommand(context)}`,
  ].join('\n');
}

function formatCatalogOpenApiSetupLines(context: CatalogCommandContext): string[] {
  if (isConfiguredValue(context.openapi)) {
    return [];
  }

  const configPath = context.config?.path ?? path.join(context.cwd, DEFAULT_CONFIG_PATH);
  const moduleName = context.moduleName ?? '<name>';

  return [
    'Configure OpenAPI source first:',
    `  ${configPath}`,
    '',
    'Set:',
    `  modules.${moduleName}.openapi`,
    '',
  ];
}

function formatCatalogSyncCommand(context: CatalogCommandContext): string {
  return formatCatalogCommand('sync', context, {});
}

function formatCatalogRetryCommand(context: CatalogCommandContext): string {
  return formatCatalogCommand('catalog', context, {
    query: context.options.query,
    method: context.options.method,
    tag: context.options.tag,
    all: context.options.all,
    json: context.options.json,
  });
}

function formatCatalogCommand(
  command: 'sync' | 'catalog',
  context: CatalogCommandContext,
  filters: {
    query?: string;
    method?: string;
    tag?: string;
    all?: boolean;
    json?: boolean;
  },
): string {
  const defaultConfigPath = path.join(context.cwd, DEFAULT_CONFIG_PATH);
  const parts = ['npx', '--yes', 'openapi-k6', command];

  if (context.config !== undefined && path.resolve(context.config.path) !== defaultConfigPath) {
    parts.push('--config', formatDisplayPath(context.cwd, context.config.path));
  }

  if (context.moduleName !== undefined && (context.options.module !== undefined || context.moduleName !== 'default')) {
    parts.push('--module', context.moduleName);
  }

  if (filters.query !== undefined) {
    parts.push('--query', filters.query);
  }

  if (filters.method !== undefined) {
    parts.push('--method', filters.method);
  }

  if (filters.tag !== undefined) {
    parts.push('--tag', filters.tag);
  }

  if (filters.all === true) {
    parts.push('--all');
  }

  if (filters.json === true) {
    parts.push('--json');
  }

  return parts.map(shellQuote).join(' ');
}

function parseCatalog(value: unknown, catalogPath: string): ApiCatalog {
  const catalog = expectCatalogRecord(value, `${catalogPath}: catalog must be an object`);
  const generatedAt = expectCatalogString(catalog.generatedAt, `${catalogPath}: generatedAt must be a string`);
  const source = expectCatalogString(catalog.source, `${catalogPath}: source must be a string`);

  if (!Array.isArray(catalog.operations)) {
    throw new Error(`${catalogPath}: operations must be an array`);
  }

  return {
    generatedAt,
    source,
    operations: catalog.operations.map((operation, index) =>
      parseCatalogOperation(operation, `${catalogPath}: operations[${index}]`)),
  };
}

function parseCatalogOperation(value: unknown, label: string): ApiCatalogOperation {
  const operation = expectCatalogRecord(value, `${label} must be an object`);
  const method = expectCatalogString(operation.method, `${label}.method must be a string`);
  const endpointPath = expectCatalogString(operation.path, `${label}.path must be a string`);
  const tags = Array.isArray(operation.tags)
    ? operation.tags.flatMap((tag) => typeof tag === 'string' ? [tag] : [])
    : [];

  return {
    method: method.toUpperCase(),
    path: endpointPath,
    tags,
    parameters: Array.isArray(operation.parameters) ? operation.parameters : [],
    hasRequestBody: operation.hasRequestBody === true,
    ...(typeof operation.operationId === 'string' ? { operationId: operation.operationId } : {}),
    ...(typeof operation.summary === 'string' ? { summary: operation.summary } : {}),
    ...(typeof operation.description === 'string' ? { description: operation.description } : {}),
    ...(Array.isArray(operation.requestBodyContentTypes)
      ? {
          requestBodyContentTypes: operation.requestBodyContentTypes.flatMap((contentType) =>
            typeof contentType === 'string' ? [contentType] : []),
        }
      : {}),
    ...parseCatalogRequestBodyHint(operation.requestBodyHint),
    ...parseCatalogExtractCandidates(operation.responseExtractCandidates),
  };
}

function parseCatalogRequestBodyHint(
  value: unknown,
): Pick<ApiCatalogOperation, 'requestBodyHint'> | Record<string, never> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;

  if (typeof record.contentType !== 'string') {
    return {};
  }

  if (record.source !== 'example' && record.source !== 'schema') {
    return {};
  }

  const requestBodyHint: ApiCatalogRequestBodyHint = {
    contentType: record.contentType,
    source: record.source,
    example: record.example,
    ...parseCatalogRequestBodyFieldHints(record.fields),
  };

  return { requestBodyHint };
}

function parseCatalogRequestBodyFieldHints(
  value: unknown,
): Pick<ApiCatalogRequestBodyHint, 'fields'> | Record<string, never> {
  if (!Array.isArray(value)) {
    return {};
  }

  const fields: ApiCatalogRequestBodyFieldHint[] = value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (typeof record.path !== 'string') {
      return [];
    }

    return [{
      path: record.path,
      required: record.required === true,
      ...(typeof record.type === 'string' ? { type: record.type } : {}),
      ...(typeof record.placeholder === 'string' ? { placeholder: record.placeholder } : {}),
      ...(typeof record.env === 'string' ? { env: record.env } : {}),
    }];
  });

  return fields.length === 0 ? {} : { fields };
}

function parseCatalogExtractCandidates(
  value: unknown,
): Pick<ApiCatalogOperation, 'responseExtractCandidates'> | Record<string, never> {
  if (!Array.isArray(value)) {
    return {};
  }

  const responseExtractCandidates: ApiCatalogExtractCandidate[] = value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (typeof record.name !== 'string' ||
      typeof record.from !== 'string' ||
      typeof record.status !== 'string') {
      return [];
    }

    return [{
      name: record.name,
      from: record.from,
      status: record.status,
      ...(typeof record.contentType === 'string' ? { contentType: record.contentType } : {}),
    }];
  });

  return responseExtractCandidates.length === 0 ? {} : { responseExtractCandidates };
}

function expectCatalogRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function expectCatalogString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }

  return value;
}

export function normalizeCatalogFilters(options: CatalogOptions): CatalogFilters {
  const query = normalizeCatalogTextFilter(options.query);
  const method = normalizeCatalogMethodFilter(options.method);
  const tag = normalizeCatalogTextFilter(options.tag);

  return {
    ...(query === undefined ? {} : { query }),
    ...(method === undefined ? {} : { method }),
    ...(tag === undefined ? {} : { tag }),
    ...(options.all === true ? { all: true } : {}),
  };
}

function normalizeCatalogTextFilter(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeCatalogMethodFilter(value: string | undefined): string | undefined {
  const method = normalizeCatalogTextFilter(value)?.toUpperCase();

  if (method === undefined) {
    return undefined;
  }

  const supportedMethods = new Set(HTTP_METHOD_ORDER.map((item) => item.toUpperCase()));

  if (!supportedMethods.has(method)) {
    throw new Error(`--method must be one of ${[...supportedMethods].join(', ')}`);
  }

  return method;
}

export function shouldListCatalogOperations(filters: CatalogFilters): boolean {
  return filters.all === true ||
    filters.query !== undefined ||
    filters.method !== undefined ||
    filters.tag !== undefined;
}

export function filterCatalogOperations(
  operations: ApiCatalogOperation[],
  filters: CatalogFilters,
): ApiCatalogOperation[] {
  return operations.filter((operation) => {
    if (filters.method !== undefined && operation.method.toUpperCase() !== filters.method) {
      return false;
    }

    if (
      filters.tag !== undefined &&
      !operation.tags.some((tag) => tag.toLowerCase() === filters.tag?.toLowerCase())
    ) {
      return false;
    }

    if (filters.query !== undefined && !matchesCatalogQuery(operation, filters.query)) {
      return false;
    }

    return true;
  });
}

function matchesCatalogQuery(operation: ApiCatalogOperation, query: string): boolean {
  const normalizedQuery = query.toLowerCase();

  return catalogSearchValues(operation).some((value) =>
    value.toLowerCase().includes(normalizedQuery));
}

function catalogSearchValues(operation: ApiCatalogOperation): string[] {
  return [
    operation.method,
    operation.path,
    operation.operationId,
    ...operation.tags,
    operation.summary,
    operation.description,
    ...(operation.requestBodyContentTypes ?? []),
    ...readCatalogParameterLabels(operation.parameters),
  ].flatMap((value) => value === undefined ? [] : [value]);
}

interface CatalogParameterHint {
  location: string;
  name: string;
  required: boolean;
}

function readCatalogParameterLabels(parameters: unknown[]): string[] {
  return readCatalogParameterHints(parameters).map(({ location, name }) => `${location} ${name}`);
}

function readCatalogParameterHints(parameters: unknown[]): CatalogParameterHint[] {
  return parameters.flatMap((parameter) => {
    if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) {
      return [];
    }

    const record = parameter as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : undefined;
    const location = typeof record.in === 'string' ? record.in : undefined;

    if (name === undefined && location === undefined) {
      return [];
    }

    return [{
      location: location ?? 'param',
      name: name ?? '<unnamed>',
      required: record.required === true,
    }];
  });
}

export function sortCatalogOperations(operations: ApiCatalogOperation[]): ApiCatalogOperation[] {
  return [...operations].sort((left, right) =>
    compareCatalogMethod(left.method, right.method) ||
    left.path.localeCompare(right.path) ||
    (left.operationId ?? '').localeCompare(right.operationId ?? ''));
}

function compareCatalogMethod(left: string, right: string): number {
  const methodOrder = new Map(HTTP_METHOD_ORDER.map((method, index) => [method.toUpperCase(), index]));
  const leftIndex = methodOrder.get(left.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = methodOrder.get(right.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;

  return leftIndex - rightIndex;
}

export function countCatalogTags(operations: ApiCatalogOperation[]): Array<{ tag: string; count: number }> {
  const tagCounts = new Map<string, number>();

  for (const operation of operations) {
    for (const tag of operation.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
}

export function findDuplicateOperationWarnings(operations: ApiCatalogOperation[]): string[] {
  const counts = new Map<string, number>();

  for (const operation of operations) {
    const key = `${operation.method.toUpperCase()} ${operation.path}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => `duplicate operation key: ${key} (${count} entries)`);
}

export function writeCatalogOutput(
  stdout: WritableLike,
  result: CatalogResult,
  cwd: string,
  options: Pick<CatalogOptions, 'ai' | 'json' | 'snippet'>,
): void {
  if (options.json === true) {
    writeLine(stdout, JSON.stringify(formatCatalogJson(result), null, 2));
    return;
  }

  if (options.ai === true) {
    writeCatalogSyncNotice(stdout, result, cwd, false);
    writeCatalogAiGuide(stdout, result, cwd);
    return;
  }

  if (options.snippet === true) {
    writeCatalogSyncNotice(stdout, result, cwd, true);
    writeCatalogSnippets(stdout, result, cwd);
    return;
  }

  writeCatalogSyncNotice(stdout, result, cwd, false);

  if (shouldListCatalogOperations(result.filters)) {
    writeCatalogOperations(stdout, result, cwd);
    return;
  }

  writeCatalogSummary(stdout, result, cwd);
}

function writeCatalogSyncNotice(
  stdout: WritableLike,
  result: CatalogResult,
  cwd: string,
  asComment: boolean,
): void {
  if (result.synced === undefined) {
    return;
  }

  const prefix = asComment ? '# ' : '';

  writeLine(stdout, `${prefix}Synced ${formatDisplayPath(cwd, result.synced.snapshotPath)}`);
  writeLine(stdout, `${prefix}Catalog ${formatDisplayPath(cwd, result.synced.catalogPath)} (${result.synced.operationCount} operations)`);
  writeLine(stdout, '');
}

function writeCatalogAiGuide(stdout: WritableLike, result: CatalogResult, cwd: string): void {
  writeLine(stdout, 'AI scenario authoring guide');
  writeLine(stdout, `Catalog: ${formatDisplayPath(cwd, result.catalogPath)}`);
  writeCatalogFilterSummary(stdout, result);

  if (result.operations.length === 0) {
    writeLine(stdout, '');
    writeLine(stdout, 'No operations matched.');
    writeLine(stdout, 'Try a broader --query, --tag, --method, or use --all.');
    return;
  }

  writeLine(stdout, '');
  writeLine(stdout, 'Rules for AI agents:');
  writeLine(stdout, '  - Use operationId first. If it is missing or ambiguous, use api.method and api.path.');
  writeLine(stdout, '  - Map path/query/header parameters to request.pathParams/request.query/request.headers.');
  writeLine(stdout, `  - Keep secrets in ${DEFAULT_LOAD_TEST_DIR}/.env and reference them as {{env.NAME}}.`);
  writeLine(stdout, '  - Fill request body values from the OpenAPI schema or real API contract before test.');
  writeLine(stdout, '  - Replace every <...> placeholder before validate/test.');
  writeLine(stdout, '  - Add extract only after checking the real response JSON path.');

  if (result.operations.length > 1) {
    writeLine(stdout, '');
    writeLine(stdout, 'Multiple operations matched.');
    writeLine(stdout, '  - Do not pick one arbitrarily.');
    writeLine(stdout, '  - Narrow with a more specific --query, --tag, --method, or operationId keyword.');
    writeLine(stdout, '  - If the user intent is ambiguous, ask which operation to use before writing scenario YAML.');
  }

  for (const [index, operation] of result.operations.entries()) {
    writeLine(stdout, '');
    writeLine(stdout, `Operation ${index + 1}: ${operation.operationId ?? `${operation.method} ${operation.path}`}`);
    writeLine(stdout, `  method: ${operation.method.toUpperCase()}`);
    writeLine(stdout, `  path: ${operation.path}`);

    if (operation.operationId !== undefined) {
      writeLine(stdout, `  operationId: ${operation.operationId}`);
    }

    writeLine(stdout, `  tags: ${operation.tags.length === 0 ? '-' : operation.tags.join(', ')}`);
    writeLine(stdout, `  body: ${formatCatalogBody(operation)}`);

    const parameters = readCatalogParameterLabels(operation.parameters);

    if (parameters.length > 0) {
      writeLine(stdout, `  parameters: ${parameters.join(', ')}`);
    }

    if (operation.summary !== undefined) {
      writeLine(stdout, `  summary: ${operation.summary}`);
    }

    writeCatalogAiScenarioMapping(stdout, operation);

    writeLine(stdout, '');
    writeLine(stdout, 'Suggested scenario step:');
    writeLine(stdout, '```yaml');

    for (const line of renderCatalogScenarioStepSnippet(operation, result.moduleName)) {
      writeLine(stdout, line);
    }

    writeLine(stdout, '```');
  }
}

function writeCatalogSnippets(stdout: WritableLike, result: CatalogResult, cwd: string): void {
  writeLine(stdout, `# Catalog: ${formatDisplayPath(cwd, result.catalogPath)}`);

  if (result.moduleName !== undefined) {
    writeLine(stdout, `# Module: ${result.moduleName}`);
  }

  if (result.operations.length === 0) {
    writeLine(stdout, '# No operations matched.');
    return;
  }

  for (const [index, operation] of result.operations.entries()) {
    if (index > 0) {
      writeLine(stdout, '');
    }

    for (const line of renderCatalogScenarioStepSnippet(operation, result.moduleName)) {
      writeLine(stdout, line);
    }
  }
}

function writeCatalogFilterSummary(stdout: WritableLike, result: CatalogResult): void {
  if (result.moduleName !== undefined) {
    writeLine(stdout, `Module: ${result.moduleName}`);
  }

  if (result.filters.query !== undefined) {
    writeLine(stdout, `Query: ${result.filters.query}`);
  }

  if (result.filters.method !== undefined) {
    writeLine(stdout, `Method: ${result.filters.method}`);
  }

  if (result.filters.tag !== undefined) {
    writeLine(stdout, `Tag: ${result.filters.tag}`);
  }

  writeLine(stdout, `Operations: ${result.operations.length}`);

  if (result.warnings.length > 0) {
    writeLine(stdout, '');
    writeLine(stdout, 'Warnings:');

    for (const warning of result.warnings) {
      writeLine(stdout, `  ${warning}`);
    }
  }
}

function writeCatalogAiScenarioMapping(stdout: WritableLike, operation: ApiCatalogOperation): void {
  const parametersByRequestKey = [
    ['pathParams', readCatalogParametersByLocation(operation.parameters, 'path')],
    ['query', readCatalogParametersByLocation(operation.parameters, 'query')],
    ['headers', readCatalogParametersByLocation(operation.parameters, 'header')],
  ] as const;
  const extractCandidates = operation.responseExtractCandidates ?? [];
  const shouldPrint = operation.hasRequestBody ||
    extractCandidates.length > 0 ||
    parametersByRequestKey.some(([, parameters]) => parameters.length > 0);

  if (!shouldPrint) {
    return;
  }

  writeLine(stdout, '  scenario mapping:');

  for (const [requestKey, parameters] of parametersByRequestKey) {
    if (parameters.length === 0) {
      continue;
    }

    writeLine(stdout, `    request.${requestKey}:`);

    for (const parameter of parameters) {
      const requiredLabel = parameter.required ? 'required' : 'optional';
      writeLine(stdout, `      - ${parameter.name} (${requiredLabel})`);
    }
  }

  if (operation.hasRequestBody) {
    for (const line of formatCatalogAiBodyMappingLines(operation)) {
      writeLine(stdout, `    ${line}`);
    }
  }

  if (extractCandidates.length > 0) {
    writeLine(stdout, '    response extract candidates:');

    for (const candidate of extractCandidates) {
      for (const line of formatCatalogExtractCandidateMappingLines(candidate)) {
        writeLine(stdout, `      ${line}`);
      }
    }
  }
}

function readCatalogParametersByLocation(
  parameters: unknown[],
  location: string,
): CatalogParameterHint[] {
  return readCatalogParameterHints(parameters)
    .filter((parameter) => parameter.location.toLowerCase() === location);
}

function formatCatalogAiBodyMappingLines(operation: ApiCatalogOperation): string[] {
  if (isMultipartCatalogOperation(operation)) {
    const contentTypes = operation.requestBodyContentTypes?.join(', ') ?? 'multipart/form-data';
    return [`request.multipart: ${contentTypes}`];
  }

  if (operation.requestBodyHint !== undefined) {
    const lines = [
      [
        `request.body: ${operation.requestBodyHint.contentType}`,
        `${operation.requestBodyHint.source} example`,
      ].join('; '),
    ];
    const fieldHints = operation.requestBodyHint.fields ?? [];

    if (fieldHints.length > 0) {
      lines.push('  fields:');
      lines.push(...fieldHints.map((field) => `    - ${formatCatalogBodyFieldHint(field)}`));
      return lines;
    }

    const fields = formatCatalogBodyHintFields(operation.requestBodyHint.example);

    if (fields.length > 0) {
      lines[0] += `; fields: ${fields.join(', ')}`;
    }

    return lines;
  }

  return [`request.body: ${formatCatalogBody(operation)}`];
}

function formatCatalogBodyFieldHint(field: ApiCatalogRequestBodyFieldHint): string {
  return [
    `${field.path}: ${field.type ?? 'value'}`,
    field.required ? 'required' : 'optional',
    ...(field.placeholder === undefined ? [] : [`placeholder ${field.placeholder}`]),
    ...(field.env === undefined ? [] : [`env ${field.env}`]),
  ].join(', ');
}

function formatCatalogBodyHintFields(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value as Record<string, unknown>);
}

function formatCatalogExtractCandidateSource(candidate: ApiCatalogExtractCandidate): string {
  return [
    candidate.status,
    candidate.contentType,
  ].filter((value) => value !== undefined).join(' ');
}

function formatCatalogExtractCandidateMappingLines(
  candidate: ApiCatalogExtractCandidate,
): string[] {
  const lines = [
    `- ${candidate.name} <- ${candidate.from} (${formatCatalogExtractCandidateSource(candidate)})`,
    '  yaml:',
    '    extract:',
    `      ${formatYamlKey(candidate.name)}:`,
    `        from: ${candidate.from}`,
  ];
  const nextUse = formatCatalogExtractNextUse(candidate.name);

  if (nextUse !== undefined) {
    lines.push('  likely next use:');
    lines.push(`    ${nextUse}`);
  }

  return lines;
}

function formatCatalogExtractNextUse(candidateName: string): string | undefined {
  const normalized = candidateName.toLowerCase();

  if (normalized.includes('token')) {
    return `request.headers.Authorization: "Bearer {{${candidateName}}}"`;
  }

  if (normalized.endsWith('id') || normalized.endsWith('uuid')) {
    return `request.pathParams.${candidateName}: "{{${candidateName}}}"`;
  }

  return undefined;
}

function renderCatalogScenarioStepSnippet(
  operation: ApiCatalogOperation,
  moduleName: string | undefined,
): string[] {
  const lines = [
    `# ${operation.method.toUpperCase()} ${operation.path}`,
    `- id: ${formatYamlPlainValue(formatCatalogScenarioStepId(operation))}`,
    '  api:',
  ];

  if (moduleName !== undefined) {
    lines.push(`    module: ${formatYamlPlainValue(moduleName)}`);
  }

  if (operation.operationId !== undefined) {
    lines.push(`    operationId: ${formatYamlPlainValue(operation.operationId)}`);
  } else {
    lines.push(`    method: ${formatYamlPlainValue(operation.method.toUpperCase())}`);
    lines.push(`    path: ${formatYamlString(operation.path)}`);
  }

  const requestLines = renderCatalogRequestSnippet(operation);

  if (requestLines.length > 0) {
    lines.push('  request:');
    lines.push(...requestLines.map((line) => `    ${line}`));
  }

  lines.push('  condition: status < 300');
  lines.push(...renderCatalogExtractCandidateComments(operation));

  return lines;
}

function renderCatalogRequestSnippet(operation: ApiCatalogOperation): string[] {
  const lines: string[] = [];

  appendCatalogParameterGroup(lines, operation, 'pathParams', 'path');
  appendCatalogParameterGroup(lines, operation, 'query', 'query');
  appendCatalogParameterGroup(lines, operation, 'headers', 'header');

  if (operation.hasRequestBody) {
    if (isMultipartCatalogOperation(operation)) {
      lines.push('multipart:');
      lines.push('  fields: {}');
      lines.push('  files: {}');
    } else if (operation.requestBodyHint !== undefined) {
      appendCatalogYamlField(lines, 'body', operation.requestBodyHint.example, 0);
    } else {
      lines.push('body: {}');
    }
  }

  return lines;
}

function renderCatalogExtractCandidateComments(operation: ApiCatalogOperation): string[] {
  const candidates = operation.responseExtractCandidates ?? [];

  if (candidates.length === 0) {
    return [];
  }

  return [
    '  # extract candidates:',
    ...candidates.flatMap((candidate) => [
      `  #   ${formatYamlKey(candidate.name)}:`,
      `  #     from: ${candidate.from}`,
    ]),
  ];
}

function appendCatalogParameterGroup(
  lines: string[],
  operation: ApiCatalogOperation,
  requestKey: 'headers' | 'pathParams' | 'query',
  location: string,
): void {
  const parameters = readCatalogParameterHints(operation.parameters)
    .filter((parameter) => parameter.location.toLowerCase() === location);

  if (parameters.length === 0) {
    return;
  }

  lines.push(`${requestKey}:`);

  for (const parameter of parameters) {
    const optionalSuffix = parameter.required ? '' : ' # optional';
    lines.push(`  ${formatYamlKey(parameter.name)}: ${formatYamlString(`<${parameter.name}>`)}${optionalSuffix}`);
  }
}

function appendCatalogYamlField(lines: string[], key: string, value: unknown, indent: number): void {
  const prefix = ' '.repeat(indent);

  if (isYamlScalar(value)) {
    lines.push(`${prefix}${formatYamlKey(key)}: ${formatYamlScalar(value)}`);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${prefix}${formatYamlKey(key)}: []`);
      return;
    }

    lines.push(`${prefix}${formatYamlKey(key)}:`);
    appendCatalogYamlArray(lines, value, indent + 2);
    return;
  }

  if (!value || typeof value !== 'object') {
    lines.push(`${prefix}${formatYamlKey(key)}: ${formatYamlString('<value>')}`);
    return;
  }

  const entries = Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) {
    lines.push(`${prefix}${formatYamlKey(key)}: {}`);
    return;
  }

  lines.push(`${prefix}${formatYamlKey(key)}:`);

  for (const [childKey, childValue] of entries) {
    appendCatalogYamlField(lines, childKey, childValue, indent + 2);
  }
}

function appendCatalogYamlArray(lines: string[], value: unknown[], indent: number): void {
  const prefix = ' '.repeat(indent);

  for (const item of value) {
    if (isYamlScalar(item)) {
      lines.push(`${prefix}- ${formatYamlScalar(item)}`);
      continue;
    }

    if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(`${prefix}- []`);
      } else {
        lines.push(`${prefix}-`);
        appendCatalogYamlArray(lines, item, indent + 2);
      }
      continue;
    }

    if (!item || typeof item !== 'object') {
      lines.push(`${prefix}- ${formatYamlString('<value>')}`);
      continue;
    }

    const entries = Object.entries(item as Record<string, unknown>);

    if (entries.length === 0) {
      lines.push(`${prefix}- {}`);
      continue;
    }

    lines.push(`${prefix}-`);

    for (const [childKey, childValue] of entries) {
      appendCatalogYamlField(lines, childKey, childValue, indent + 2);
    }
  }
}

function formatCatalogScenarioStepId(operation: ApiCatalogOperation): string {
  const source = operation.operationId ?? `${operation.method}-${operation.path}`;
  const value = source
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return value || 'step';
}

function isMultipartCatalogOperation(operation: ApiCatalogOperation): boolean {
  return operation.requestBodyContentTypes
    ?.some((contentType) => contentType.toLowerCase().includes('multipart/form-data')) === true;
}

function formatYamlKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    ? value
    : formatYamlString(value);
}

function formatYamlPlainValue(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value)
    ? value
    : formatYamlString(value);
}

function isYamlScalar(value: unknown): value is string | number | boolean | null {
  return value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean';
}

function formatYamlScalar(value: string | number | boolean | null): string {
  if (typeof value === 'string') {
    return formatYamlString(value);
  }

  if (value === null) {
    return 'null';
  }

  return String(value);
}

function formatYamlString(value: string): string {
  return JSON.stringify(value);
}

function formatCatalogJson(result: CatalogResult): Record<string, unknown> {
  return {
    catalogPath: result.catalogPath,
    ...(result.moduleName === undefined ? {} : { moduleName: result.moduleName }),
    source: result.source,
    generatedAt: result.generatedAt,
    totalOperationCount: result.totalOperationCount,
    operationCount: result.operations.length,
    filters: result.filters,
    tagCounts: result.tagCounts,
    warnings: result.warnings,
    ...(result.synced === undefined ? {} : { synced: result.synced }),
    operations: result.operations,
  };
}

function writeCatalogSummary(stdout: WritableLike, result: CatalogResult, cwd: string): void {
  writeLine(stdout, `Catalog: ${formatDisplayPath(cwd, result.catalogPath)}`);

  if (result.moduleName !== undefined) {
    writeLine(stdout, `Module: ${result.moduleName}`);
  }

  writeLine(stdout, `Operations: ${result.totalOperationCount}`);
  writeLine(stdout, '');
  writeLine(stdout, 'Tags:');

  if (result.tagCounts.length === 0) {
    writeLine(stdout, '  (none)');
  } else {
    const width = Math.max(...result.tagCounts.map(({ tag }) => tag.length));

    for (const { tag, count } of result.tagCounts) {
      writeLine(stdout, `  ${tag.padEnd(width)}  ${count}`);
    }
  }

  writeLine(stdout, '');
  writeLine(stdout, 'Use filters:');
  writeLine(stdout, '  openapi-k6 catalog --query <query>');
  writeLine(stdout, '  openapi-k6 catalog --tag auth');
  writeLine(stdout, '  openapi-k6 catalog --method POST');
  writeLine(stdout, '  openapi-k6 catalog --all');
}

function writeCatalogOperations(stdout: WritableLike, result: CatalogResult, cwd: string): void {
  writeLine(stdout, `Catalog: ${formatDisplayPath(cwd, result.catalogPath)}`);

  if (result.moduleName !== undefined) {
    writeLine(stdout, `Module: ${result.moduleName}`);
  }

  if (result.filters.query !== undefined) {
    writeLine(stdout, `Query: ${result.filters.query}`);
  }

  if (result.filters.method !== undefined) {
    writeLine(stdout, `Method: ${result.filters.method}`);
  }

  if (result.filters.tag !== undefined) {
    writeLine(stdout, `Tag: ${result.filters.tag}`);
  }

  writeLine(stdout, `Operations: ${result.operations.length}`);

  if (result.warnings.length > 0) {
    writeLine(stdout, '');
    writeLine(stdout, 'Warnings:');

    for (const warning of result.warnings) {
      writeLine(stdout, `  ${warning}`);
    }
  }

  if (result.operations.length === 0) {
    writeLine(stdout, '');
    writeLine(stdout, 'No operations matched.');
    return;
  }

  for (const operation of result.operations) {
    writeLine(stdout, '');
    writeLine(stdout, `${operation.method.padEnd(6)} ${operation.path}`);
    writeCatalogOperationDetail(stdout, operation);
  }
}

function writeCatalogOperationDetail(stdout: WritableLike, operation: ApiCatalogOperation): void {
  if (operation.operationId !== undefined) {
    writeLine(stdout, `  operationId: ${operation.operationId}`);
  }

  writeLine(stdout, `  tags: ${operation.tags.length === 0 ? '-' : operation.tags.join(', ')}`);
  writeLine(stdout, `  body: ${formatCatalogBody(operation)}`);

  const parameters = readCatalogParameterLabels(operation.parameters);

  if (parameters.length > 0) {
    writeLine(stdout, `  parameters: ${parameters.join(', ')}`);
  }

  if (operation.summary !== undefined) {
    writeLine(stdout, `  summary: ${operation.summary}`);
  }
}

function formatCatalogBody(operation: ApiCatalogOperation): string {
  if (!operation.hasRequestBody) {
    return 'no';
  }

  if (!operation.requestBodyContentTypes || operation.requestBodyContentTypes.length === 0) {
    return 'yes';
  }

  return `yes (${operation.requestBodyContentTypes.join(', ')})`;
}
