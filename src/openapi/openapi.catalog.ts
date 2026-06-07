import SwaggerParser from '@apidevtools/swagger-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type {
  ApiCatalog,
  ApiCatalogExtractCandidate,
  ApiCatalogOperation,
  ApiCatalogRequestBodyFieldHint,
  ApiCatalogRequestBodyHint,
} from '../core/types.js';
import { HTTP_METHOD_ORDER, OpenApiParseError } from './openapi.parser.js';

export interface OpenApiSyncOptions {
  openapi: string;
  write: string;
  catalog: string;
  generatedAt?: Date;
}

export interface OpenApiSyncResult {
  snapshotPath: string;
  catalogPath: string;
  operationCount: number;
}

interface LoadedOpenApiDocument {
  document: unknown;
  source: string;
}

type SwaggerApiInput = Parameters<typeof SwaggerParser.dereference>[1];

const CATALOG_HINT_MAX_DEPTH = 4;
const CATALOG_HINT_MAX_PROPERTIES = 12;
const CATALOG_HINT_MAX_ARRAY_ITEMS = 2;
const CATALOG_EXTRACT_MAX_CANDIDATES = 8;
const CATALOG_FIELD_HINT_MAX_DEPTH = 4;
const CATALOG_FIELD_HINT_MAX_FIELDS = 16;

const openApiRefOptions: SwaggerParser.Options = {
  resolve: {
    http: {
      safeUrlResolver: false,
    },
  },
};

export class OpenApiSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenApiSyncError';
  }
}

export async function syncOpenApiSnapshot(
  options: OpenApiSyncOptions,
): Promise<OpenApiSyncResult> {
  const loaded = await loadOpenApiDocument(options.openapi);
  // Bundle external refs into the snapshot so generate can run from the local snapshot alone.
  const bundled = await SwaggerParser.bundle(
    options.openapi,
    loaded.document as SwaggerApiInput,
    openApiRefOptions,
  );
  const snapshot = `${JSON.stringify(bundled, null, 2)}\n`;
  // Keep the original path/URL as the ref base while avoiding parser issues with extensionless URLs.
  const dereferenced = await SwaggerParser.dereference(
    options.openapi,
    bundled as SwaggerApiInput,
    openApiRefOptions,
  );
  const catalog = buildOpenApiCatalog(dereferenced, {
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    source: loaded.source,
  });

  await fs.mkdir(path.dirname(options.write), { recursive: true });
  await fs.mkdir(path.dirname(options.catalog), { recursive: true });
  await fs.writeFile(options.write, snapshot, 'utf8');
  await fs.writeFile(options.catalog, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  return {
    snapshotPath: options.write,
    catalogPath: options.catalog,
    operationCount: catalog.operations.length,
  };
}

export async function loadOpenApiDocument(input: string): Promise<LoadedOpenApiDocument> {
  const source = input;
  const raw = await readOpenApiSource(input);
  return {
    document: parseOpenApiSource(raw, source),
    source,
  };
}

export function buildOpenApiCatalog(
  spec: unknown,
  options: { generatedAt: string; source: string },
): ApiCatalog {
  const document = expectRecord(spec, `${options.source}: OpenAPI document must be an object`);
  validateOpenApiVersion(document, options.source);
  const paths = expectOptionalRecord(document.paths, `${options.source}: paths must be an object`);
  const operations: ApiCatalogOperation[] = [];

  for (const endpointPath of Object.keys(paths).sort((left, right) => left.localeCompare(right))) {
    const pathItem = expectOptionalRecord(
      paths[endpointPath],
      `${options.source}: paths.${endpointPath} must be an object`,
    );

    for (const method of HTTP_METHOD_ORDER) {
      const operationValue = pathItem[method];

      if (operationValue === undefined) {
        continue;
      }

      const operation = expectRecord(
        operationValue,
        `${options.source}: ${method.toUpperCase()} ${endpointPath} operation must be an object`,
      );
      const operationId = normalizeOptionalString(operation.operationId);
      const summary = normalizeOptionalString(operation.summary);
      const description = normalizeOptionalString(operation.description);

      operations.push({
        method: method.toUpperCase(),
        path: endpointPath,
        tags: readStringArray(operation.tags),
        parameters: collectOperationParameters(pathItem, operation),
        hasRequestBody: operation.requestBody !== undefined,
        ...renderRequestBodyContentTypes(operation.requestBody),
        ...renderRequestBodyHint(operation.requestBody),
        ...renderResponseExtractCandidates(operation.responses),
        ...(operationId === undefined ? {} : { operationId }),
        ...(summary === undefined ? {} : { summary }),
        ...(description === undefined ? {} : { description }),
      });
    }
  }

  return {
    generatedAt: options.generatedAt,
    source: options.source,
    operations,
  };
}

function renderRequestBodyContentTypes(requestBody: unknown): Pick<ApiCatalogOperation, 'requestBodyContentTypes'> | Record<string, never> {
  const contentTypes = readRequestBodyContentTypes(requestBody);

  return contentTypes.length === 0 ? {} : { requestBodyContentTypes: contentTypes };
}

function renderRequestBodyHint(requestBody: unknown): Pick<ApiCatalogOperation, 'requestBodyHint'> | Record<string, never> {
  if (!isRecord(requestBody)) {
    return {};
  }

  const selected = selectJsonMediaType(requestBody.content);

  if (selected === undefined) {
    return {};
  }

  const explicitExample = readMediaTypeExample(selected.mediaType);

  if (explicitExample !== undefined) {
    const example = normalizeCatalogHintValue(explicitExample, 0);

    return {
      requestBodyHint: {
        contentType: selected.contentType,
        source: 'example',
        example,
        ...renderRequestBodyFieldHints(selected.mediaType.schema, example),
      },
    };
  }

  const schemaExample = createCatalogHintFromSchema(selected.mediaType.schema, 'value', 0);

  if (schemaExample === undefined) {
    return {};
  }

  return {
    requestBodyHint: {
      contentType: selected.contentType,
      source: 'schema',
      example: schemaExample,
      ...renderRequestBodyFieldHints(selected.mediaType.schema, schemaExample),
    },
  };
}

function renderRequestBodyFieldHints(
  schema: unknown,
  example: unknown,
): Pick<ApiCatalogRequestBodyHint, 'fields'> | Record<string, never> {
  const fields = collectRequestBodyFieldHints(schema, example, '', false, 0)
    .slice(0, CATALOG_FIELD_HINT_MAX_FIELDS);

  return fields.length === 0 ? {} : { fields };
}

function renderResponseExtractCandidates(
  responses: unknown,
): Pick<ApiCatalogOperation, 'responseExtractCandidates'> | Record<string, never> {
  if (!isRecord(responses)) {
    return {};
  }

  const candidates: ApiCatalogExtractCandidate[] = [];
  const usedNames = new Set<string>();

  for (const status of Object.keys(responses).sort(compareResponseStatus)) {
    if (!isSuccessStatus(status)) {
      continue;
    }

    const response = responses[status];

    if (!isRecord(response)) {
      continue;
    }

    const selected = selectJsonMediaType(response.content);

    if (selected === undefined) {
      continue;
    }

    for (const candidate of collectExtractCandidatesFromSchema(
      selected.mediaType.schema,
      status,
      selected.contentType,
      [],
      '$',
      0,
    )) {
      if (usedNames.has(candidate.name)) {
        const derivedName = formatExtractCandidateName(candidate.from);

        if (usedNames.has(derivedName)) {
          continue;
        }

        candidates.push({ ...candidate, name: derivedName });
        usedNames.add(derivedName);
      } else {
        candidates.push(candidate);
        usedNames.add(candidate.name);
      }

      if (candidates.length >= CATALOG_EXTRACT_MAX_CANDIDATES) {
        return { responseExtractCandidates: candidates };
      }
    }
  }

  return candidates.length === 0 ? {} : { responseExtractCandidates: candidates };
}

function readRequestBodyContentTypes(requestBody: unknown): string[] {
  if (!isRecord(requestBody)) {
    return [];
  }

  const content = requestBody.content;

  if (!isRecord(content)) {
    return [];
  }

  return Object.keys(content).sort((left, right) => left.localeCompare(right));
}

function selectJsonMediaType(content: unknown): { contentType: string; mediaType: Record<string, unknown> } | undefined {
  if (!isRecord(content)) {
    return undefined;
  }

  const contentTypes = Object.keys(content).sort((left, right) => {
    const leftRank = rankJsonContentType(left);
    const rightRank = rankJsonContentType(right);

    return leftRank - rightRank || left.localeCompare(right);
  });

  for (const contentType of contentTypes) {
    if (!isJsonContentType(contentType)) {
      continue;
    }

    const mediaType = content[contentType];

    if (isRecord(mediaType)) {
      return { contentType, mediaType };
    }
  }

  return undefined;
}

function rankJsonContentType(contentType: string): number {
  const normalized = contentType.toLowerCase();

  if (normalized === 'application/json') {
    return 0;
  }

  if (normalized.endsWith('+json')) {
    return 1;
  }

  if (normalized.includes('json')) {
    return 2;
  }

  return 3;
}

function isJsonContentType(contentType: string): boolean {
  return rankJsonContentType(contentType) < 3;
}

function readMediaTypeExample(mediaType: Record<string, unknown>): unknown {
  if (mediaType.example !== undefined) {
    return mediaType.example;
  }

  if (!isRecord(mediaType.examples)) {
    return undefined;
  }

  for (const key of Object.keys(mediaType.examples).sort((left, right) => left.localeCompare(right))) {
    const example = mediaType.examples[key];

    if (isRecord(example) && example.value !== undefined) {
      return example.value;
    }

    if (!isRecord(example)) {
      return example;
    }
  }

  return undefined;
}

function createCatalogHintFromSchema(schema: unknown, propertyName: string, depth: number): unknown {
  if (depth >= CATALOG_HINT_MAX_DEPTH) {
    return formatSchemaPlaceholder(propertyName);
  }

  if (!isRecord(schema)) {
    return undefined;
  }

  if (schema.example !== undefined) {
    return normalizeCatalogHintValue(schema.example, depth);
  }

  if (schema.default !== undefined) {
    return normalizeCatalogHintValue(schema.default, depth);
  }

  const enumValue = readFirstEnumValue(schema.enum);

  if (enumValue !== undefined) {
    return normalizeCatalogHintValue(enumValue, depth);
  }

  const allOfSample = createAllOfCatalogHint(schema.allOf, propertyName, depth);

  if (allOfSample !== undefined) {
    return allOfSample;
  }

  const oneOfSample = createFirstCompositeCatalogHint(schema.oneOf, propertyName, depth) ??
    createFirstCompositeCatalogHint(schema.anyOf, propertyName, depth);

  if (oneOfSample !== undefined) {
    return oneOfSample;
  }

  const type = readSchemaType(schema);

  if (type === 'object' || isRecord(schema.properties)) {
    return createObjectCatalogHint(schema, depth);
  }

  if (type === 'array' || schema.items !== undefined) {
    const item = createCatalogHintFromSchema(schema.items, singularizePropertyName(propertyName), depth + 1) ??
      formatSchemaPlaceholder(singularizePropertyName(propertyName));

    return [item];
  }

  if (type === 'integer' || type === 'number') {
    return 0;
  }

  if (type === 'boolean') {
    return false;
  }

  return formatSchemaPlaceholder(propertyName);
}

function createObjectCatalogHint(schema: Record<string, unknown>, depth: number): Record<string, unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const requiredNames = new Set(readStringArray(schema.required));
  const propertyNamesInSchemaOrder = Object.keys(properties);
  const propertyIndex = new Map(propertyNamesInSchemaOrder.map((propertyName, index) => [propertyName, index]));
  const propertyNames = propertyNamesInSchemaOrder.sort((left, right) => {
    const requiredOrder = Number(requiredNames.has(right)) - Number(requiredNames.has(left));

    return requiredOrder || (propertyIndex.get(left) ?? 0) - (propertyIndex.get(right) ?? 0);
  });
  const sample: Record<string, unknown> = {};

  for (const propertyName of propertyNames.slice(0, CATALOG_HINT_MAX_PROPERTIES)) {
    sample[propertyName] = createCatalogHintFromSchema(properties[propertyName], propertyName, depth + 1) ??
      formatSchemaPlaceholder(propertyName);
  }

  return sample;
}

function collectRequestBodyFieldHints(
  schema: unknown,
  example: unknown,
  pathPrefix: string,
  required: boolean,
  depth: number,
): ApiCatalogRequestBodyFieldHint[] {
  if (depth >= CATALOG_FIELD_HINT_MAX_DEPTH || !isRecord(schema)) {
    return [];
  }

  const compositeHints = collectCompositeRequestBodyFieldHints(schema, example, pathPrefix, required, depth);

  if (compositeHints.length > 0) {
    return deduplicateRequestBodyFieldHints(compositeHints);
  }

  const type = readSchemaType(schema);

  if (type === 'array' || schema.items !== undefined) {
    const itemSchema = schema.items;
    const itemExample = Array.isArray(example) ? example[0] : undefined;
    const arrayPath = pathPrefix === '' ? '[]' : `${pathPrefix}[]`;

    return collectRequestBodyFieldHints(itemSchema, itemExample, arrayPath, false, depth + 1);
  }

  if (type !== 'object' && !isRecord(schema.properties)) {
    return pathPrefix === ''
      ? []
      : [createRequestBodyFieldHint(pathPrefix, schema, example, required)];
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const requiredNames = new Set(readStringArray(schema.required));
  const exampleObject = isRecord(example) ? example : {};
  const propertyNames = Object.keys(properties).slice(0, CATALOG_HINT_MAX_PROPERTIES);
  const hints: ApiCatalogRequestBodyFieldHint[] = [];

  for (const propertyName of propertyNames) {
    const propertySchema = properties[propertyName];
    const propertyPath = pathPrefix === '' ? propertyName : `${pathPrefix}.${propertyName}`;
    const propertyExample = exampleObject[propertyName];
    const propertyRequired = requiredNames.has(propertyName);

    hints.push(createRequestBodyFieldHint(propertyPath, propertySchema, propertyExample, propertyRequired));

    if (shouldCollectNestedRequestBodyFieldHints(propertySchema)) {
      hints.push(...collectRequestBodyFieldHints(
        propertySchema,
        propertyExample,
        propertyPath,
        propertyRequired,
        depth + 1,
      ));
    }

    if (hints.length >= CATALOG_FIELD_HINT_MAX_FIELDS) {
      break;
    }
  }

  return hints.slice(0, CATALOG_FIELD_HINT_MAX_FIELDS);
}

function shouldCollectNestedRequestBodyFieldHints(schema: unknown): boolean {
  if (!isRecord(schema)) {
    return false;
  }

  const type = readSchemaType(schema);

  if (type === 'object' || isRecord(schema.properties)) {
    return true;
  }

  if (type !== 'array' && schema.items === undefined) {
    return false;
  }

  const items = schema.items;

  return isRecord(items) &&
    (readSchemaType(items) === 'object' || isRecord(items.properties));
}

function collectCompositeRequestBodyFieldHints(
  schema: Record<string, unknown>,
  example: unknown,
  pathPrefix: string,
  required: boolean,
  depth: number,
): ApiCatalogRequestBodyFieldHint[] {
  const allOfHints = Array.isArray(schema.allOf)
    ? schema.allOf.flatMap((item) =>
      collectRequestBodyFieldHints(item, example, pathPrefix, required, depth + 1))
    : [];

  if (allOfHints.length > 0) {
    return allOfHints;
  }

  const oneOfItems = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : [];

  for (const item of oneOfItems) {
    const hints = collectRequestBodyFieldHints(item, example, pathPrefix, required, depth + 1);

    if (hints.length > 0) {
      return hints;
    }
  }

  return [];
}

function createRequestBodyFieldHint(
  fieldPath: string,
  schema: unknown,
  example: unknown,
  required: boolean,
): ApiCatalogRequestBodyFieldHint {
  return {
    path: fieldPath,
    ...formatRequestBodyFieldType(schema),
    required,
    ...classifyRequestBodyExample(example),
  };
}

function deduplicateRequestBodyFieldHints(
  fields: ApiCatalogRequestBodyFieldHint[],
): ApiCatalogRequestBodyFieldHint[] {
  const seen = new Set<string>();
  const result: ApiCatalogRequestBodyFieldHint[] = [];

  for (const field of fields) {
    if (seen.has(field.path)) {
      continue;
    }

    seen.add(field.path);
    result.push(field);
  }

  return result;
}

function formatRequestBodyFieldType(schema: unknown): Pick<ApiCatalogRequestBodyFieldHint, 'type'> | Record<string, never> {
  if (!isRecord(schema)) {
    return {};
  }

  const type = readSchemaType(schema);

  if (type === 'array' || schema.items !== undefined) {
    return { type: `${formatRequestBodyArrayItemType(schema.items)}[]` };
  }

  if (type === 'object' || isRecord(schema.properties)) {
    return { type: 'object' };
  }

  if (type !== undefined) {
    return { type };
  }

  const enumValue = readFirstEnumValue(schema.enum);

  if (enumValue !== undefined) {
    return { type: typeof enumValue };
  }

  return {};
}

function formatRequestBodyArrayItemType(items: unknown): string {
  if (!isRecord(items)) {
    return 'value';
  }

  const type = readSchemaType(items);

  if (type === 'array' || items.items !== undefined) {
    return `${formatRequestBodyArrayItemType(items.items)}[]`;
  }

  if (type === 'object' || isRecord(items.properties)) {
    return 'object';
  }

  return type ?? 'value';
}

function classifyRequestBodyExample(
  example: unknown,
): Pick<ApiCatalogRequestBodyFieldHint, 'placeholder' | 'env'> | Record<string, never> {
  if (typeof example !== 'string') {
    return {};
  }

  if (/^<[^<>]+>$/.test(example)) {
    return { placeholder: example };
  }

  if (/^\{\{env\.[A-Za-z_][A-Za-z0-9_]*\}\}$/.test(example)) {
    return { env: example };
  }

  return {};
}

function createAllOfCatalogHint(value: unknown, propertyName: string, depth: number): unknown {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const merged: Record<string, unknown> = {};
  let hasObject = false;

  for (const item of value) {
    const sample = createCatalogHintFromSchema(item, propertyName, depth + 1);

    if (isRecord(sample)) {
      Object.assign(merged, sample);
      hasObject = true;
      continue;
    }

    if (sample !== undefined) {
      return sample;
    }
  }

  return hasObject ? merged : undefined;
}

function createFirstCompositeCatalogHint(value: unknown, propertyName: string, depth: number): unknown {
  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const item of value) {
    const sample = createCatalogHintFromSchema(item, propertyName, depth + 1);

    if (sample !== undefined) {
      return sample;
    }
  }

  return undefined;
}

function readFirstEnumValue(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.find((item) => item !== null);
}

function readSchemaType(schema: Record<string, unknown>): string | undefined {
  if (typeof schema.type === 'string') {
    return schema.type;
  }

  if (Array.isArray(schema.type)) {
    return schema.type.find((type): type is string => typeof type === 'string' && type !== 'null');
  }

  return undefined;
}

function normalizeCatalogHintValue(value: unknown, depth: number): unknown {
  if (depth >= CATALOG_HINT_MAX_DEPTH) {
    return '<value>';
  }

  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, CATALOG_HINT_MAX_ARRAY_ITEMS)
      .map((item) => normalizeCatalogHintValue(item, depth + 1));
  }

  if (!isRecord(value)) {
    return '<value>';
  }

  const sample: Record<string, unknown> = {};

  for (const key of Object.keys(value).slice(0, CATALOG_HINT_MAX_PROPERTIES)) {
    sample[key] = normalizeCatalogHintValue(value[key], depth + 1);
  }

  return sample;
}

function collectExtractCandidatesFromSchema(
  schema: unknown,
  status: string,
  contentType: string,
  pathSegments: Array<string | number>,
  jsonPath: string,
  depth: number,
): ApiCatalogExtractCandidate[] {
  if (depth >= CATALOG_HINT_MAX_DEPTH || !isRecord(schema)) {
    return [];
  }

  const allOfCandidates = Array.isArray(schema.allOf)
    ? schema.allOf.flatMap((item) =>
      collectExtractCandidatesFromSchema(item, status, contentType, pathSegments, jsonPath, depth + 1))
    : [];

  const compositeCandidates = Array.isArray(schema.oneOf)
    ? schema.oneOf.flatMap((item) =>
      collectExtractCandidatesFromSchema(item, status, contentType, pathSegments, jsonPath, depth + 1))
    : Array.isArray(schema.anyOf)
      ? schema.anyOf.flatMap((item) =>
        collectExtractCandidatesFromSchema(item, status, contentType, pathSegments, jsonPath, depth + 1))
      : [];

  const directCandidates = collectDirectExtractCandidates(schema, status, contentType, pathSegments, jsonPath, depth);

  return [...allOfCandidates, ...compositeCandidates, ...directCandidates];
}

function collectDirectExtractCandidates(
  schema: Record<string, unknown>,
  status: string,
  contentType: string,
  pathSegments: Array<string | number>,
  jsonPath: string,
  depth: number,
): ApiCatalogExtractCandidate[] {
  const type = readSchemaType(schema);

  if (type === 'array' || schema.items !== undefined) {
    return collectExtractCandidatesFromSchema(
      schema.items,
      status,
      contentType,
      [...pathSegments, 0],
      `${jsonPath}[0]`,
      depth + 1,
    );
  }

  if (type !== 'object' && !isRecord(schema.properties)) {
    return [];
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const candidates: ApiCatalogExtractCandidate[] = [];

  for (const propertyName of Object.keys(properties)) {
    if (!isJsonPathDotProperty(propertyName)) {
      continue;
    }

    const propertyPathSegments = [...pathSegments, propertyName];
    const propertyJsonPath = `${jsonPath}.${propertyName}`;

    if (isExtractCandidateProperty(propertyName)) {
      candidates.push({
        name: formatExtractCandidateNameFromSegments(propertyPathSegments),
        from: propertyJsonPath,
        status,
        contentType,
      });
    }

    candidates.push(...collectExtractCandidatesFromSchema(
      properties[propertyName],
      status,
      contentType,
      propertyPathSegments,
      propertyJsonPath,
      depth + 1,
    ));
  }

  return candidates;
}

function isExtractCandidateProperty(propertyName: string): boolean {
  const normalized = propertyName.toLowerCase();

  return normalized === 'id' ||
    normalized === 'uuid' ||
    normalized === 'code' ||
    normalized === 'token' ||
    normalized.endsWith('id') ||
    normalized.endsWith('uuid') ||
    normalized.includes('token');
}

function formatExtractCandidateNameFromSegments(pathSegments: Array<string | number>): string {
  const stringSegments = pathSegments.filter((segment): segment is string => typeof segment === 'string');

  if (stringSegments.length === 0) {
    return 'value';
  }

  if (stringSegments.length === 1) {
    return stringSegments[0];
  }

  return stringSegments
    .map((segment, index) => index === 0 ? segment : capitalize(segment))
    .join('');
}

function formatExtractCandidateName(jsonPath: string): string {
  return jsonPath
    .replace(/^\$\./, '')
    .replace(/\[0\]/g, '')
    .split('.')
    .filter(Boolean)
    .map((segment, index) => index === 0 ? segment : capitalize(segment))
    .join('') || 'value';
}

function isJsonPathDotProperty(propertyName: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propertyName);
}

function isSuccessStatus(status: string): boolean {
  if (!/^\d+$/.test(status)) {
    return false;
  }

  const code = Number(status);

  return code >= 200 && code < 300;
}

function compareResponseStatus(left: string, right: string): number {
  const leftCode = /^\d+$/.test(left) ? Number(left) : Number.MAX_SAFE_INTEGER;
  const rightCode = /^\d+$/.test(right) ? Number(right) : Number.MAX_SAFE_INTEGER;

  return leftCode - rightCode || left.localeCompare(right);
}

function formatSchemaPlaceholder(propertyName: string): string {
  if (isSecretLikeProperty(propertyName)) {
    return `{{env.${formatEnvName(propertyName)}}}`;
  }

  return `<${propertyName}>`;
}

function isSecretLikeProperty(propertyName: string): boolean {
  return /(password|secret|token|api[-_]?key|authorization)/i.test(propertyName);
}

function formatEnvName(propertyName: string): string {
  return propertyName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || 'VALUE';
}

function singularizePropertyName(propertyName: string): string {
  return propertyName.endsWith('s') && propertyName.length > 1
    ? propertyName.slice(0, -1)
    : propertyName;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

async function readOpenApiSource(input: string): Promise<string> {
  if (!isHttpUrl(input)) {
    return fs.readFile(input, 'utf8');
  }

  const response = await fetch(input);

  if (!response.ok) {
    throw new OpenApiSyncError(
      `${input}: failed to fetch OpenAPI document (${response.status} ${response.statusText})`,
    );
  }

  return response.text();
}

function parseOpenApiSource(source: string, sourcePath: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    try {
      return parseYaml(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new OpenApiSyncError(`${sourcePath}: failed to parse OpenAPI document: ${message}`);
    }
  }
}

function validateOpenApiVersion(document: Record<string, unknown>, sourcePath: string): void {
  if (document.swagger === '2.0') {
    throw new OpenApiParseError(`${sourcePath}: Swagger/OpenAPI 2.0 is not supported`);
  }

  const version = document.openapi;

  if (typeof version !== 'string' || !version.startsWith('3.')) {
    throw new OpenApiParseError(`${sourcePath}: only OpenAPI 3.x documents are supported`);
  }
}

function collectOperationParameters(
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
): unknown[] {
  const parameters = [
    ...readParameterArray(pathItem.parameters),
    ...readParameterArray(operation.parameters),
  ];
  const keyedParameters = new Map<string, unknown>();
  const unkeyedParameters: unknown[] = [];

  for (const parameter of parameters) {
    if (!isRecord(parameter)) {
      unkeyedParameters.push(parameter);
      continue;
    }

    const name = normalizeOptionalString(parameter.name);
    const location = normalizeOptionalString(parameter.in);

    if (name === undefined || location === undefined) {
      unkeyedParameters.push(parameter);
      continue;
    }

    keyedParameters.set(`${location}:${name}`, parameter);
  }

  return [...keyedParameters.values(), ...unkeyedParameters];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const parsed = normalizeOptionalString(item);
    return parsed === undefined ? [] : [parsed];
  });
}

function readParameterArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function expectOptionalRecord(value: unknown, message: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  return expectRecord(value, message);
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new OpenApiParseError(message);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
