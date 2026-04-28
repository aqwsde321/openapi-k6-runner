import SwaggerParser from '@apidevtools/swagger-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { ApiCatalog, ApiCatalogOperation } from '../core/types.js';
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
