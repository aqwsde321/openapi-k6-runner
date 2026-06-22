import { createInterface } from 'node:readline/promises';

import { parseOpenApiFile } from '../openapi/openapi.parser.js';
import { resolveOpenApiInput } from './config-input.js';
import {
  initStatusSymbol,
  writeInitStatus,
  writeLine,
  type WritableLike,
} from './display.js';

type ReadableLike = NodeJS.ReadableStream & {
  isTTY?: boolean;
};

export interface InitOpenApiOptions {
  baseUrl?: string;
  openapi?: string;
  input?: boolean;
  noInput?: boolean;
}

export interface InitOpenApiContext {
  stdin?: ReadableLike;
  stdout?: WritableLike;
  fetch?: typeof fetch;
  interactive?: boolean;
}

const DEFAULT_INIT_BASE_URL = 'http://localhost:8080';
const DEFAULT_INIT_OPENAPI_PATH = '/v3/api-docs';
const OPENAPI_CHECK_TIMEOUT_MS = 5000;
const COMMON_OPENAPI_PATHS = [
  '/v3/api-docs',
  '/api-docs',
  '/openapi.json',
  '/swagger.json',
  '/swagger/v1/swagger.json',
];

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeBaseUrlInput(value: string): string {
  const trimmed = value.trim();

  if (!isHttpUrl(trimmed)) {
    return trimmed;
  }

  const url = new URL(trimmed);
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.search = '';
  url.hash = '';

  const normalized = url.toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function normalizeUrlPath(value: string): string {
  if (value === '' || value === '/') {
    return '/';
  }

  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

function joinUrlPath(basePath: string, suffixPath: string): string {
  const normalizedBasePath = normalizeUrlPath(basePath);
  const normalizedSuffixPath = normalizeUrlPath(suffixPath);

  if (normalizedBasePath === '/') {
    return normalizedSuffixPath;
  }

  return `${normalizedBasePath}${normalizedSuffixPath}`;
}

export function buildDefaultOpenApiUrl(baseUrl: string): string {
  if (!isHttpUrl(baseUrl)) {
    return DEFAULT_INIT_OPENAPI_PATH;
  }

  const url = new URL(baseUrl);
  url.pathname = joinUrlPath(url.pathname, DEFAULT_INIT_OPENAPI_PATH);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function inferOpenApiContextPath(pathname: string): string {
  const swaggerUiIndex = pathname.indexOf('/swagger-ui/');

  if (swaggerUiIndex >= 0) {
    return pathname.slice(0, swaggerUiIndex) || '/';
  }

  if (pathname.endsWith('/swagger-ui.html')) {
    return pathname.slice(0, -'/swagger-ui.html'.length) || '/';
  }

  for (const openApiPath of COMMON_OPENAPI_PATHS) {
    if (pathname.endsWith(openApiPath)) {
      return pathname.slice(0, -openApiPath.length) || '/';
    }
  }

  const lastSlashIndex = pathname.lastIndexOf('/');
  return lastSlashIndex > 0 ? pathname.slice(0, lastSlashIndex) : '/';
}

function commonOpenApiUrlsFrom(sourceUrl: string, baseUrl: string | undefined): string[] {
  const source = new URL(sourceUrl);
  const bases = new Map<string, { origin: string; basePath: string }>();
  const addBase = (origin: string, basePath: string) => {
    const normalizedBasePath = normalizeUrlPath(basePath);
    bases.set(`${origin}${normalizedBasePath}`, { origin, basePath: normalizedBasePath });
  };

  addBase(source.origin, inferOpenApiContextPath(source.pathname));
  addBase(source.origin, '/');

  if (baseUrl !== undefined && isHttpUrl(baseUrl)) {
    const base = new URL(baseUrl);
    addBase(base.origin, base.pathname);
    addBase(base.origin, '/');
  }

  const candidates = new Set<string>();

  for (const { origin, basePath } of bases.values()) {
    for (const openApiPath of COMMON_OPENAPI_PATHS) {
      candidates.add(new URL(joinUrlPath(basePath, openApiPath), origin).toString());
    }
  }

  candidates.delete(source.toString());
  return [...candidates];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type OpenApiCheckResult = {
  ok: boolean;
  message: string;
};

function validateOpenApiDocument(value: unknown): OpenApiCheckResult {
  if (!isRecord(value)) {
    return { ok: false, message: 'response body is not an object' };
  }

  if (typeof value.swagger === 'string') {
    return { ok: false, message: 'Swagger 2.0 documents are not supported' };
  }

  if (typeof value.openapi !== 'string' || !value.openapi.startsWith('3.')) {
    return { ok: false, message: 'response is not an OpenAPI 3.x document' };
  }

  if (!isRecord(value.info)) {
    return { ok: false, message: 'OpenAPI info object is missing' };
  }

  if (!isRecord(value.paths)) {
    return { ok: false, message: 'OpenAPI paths object is missing' };
  }

  return { ok: true, message: `OpenAPI ${value.openapi}` };
}

async function checkOpenApiUrl(
  openapiUrl: string,
  fetchImpl: typeof fetch,
): Promise<OpenApiCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAPI_CHECK_TIMEOUT_MS);

  try {
    const response = await fetchImpl(openapiUrl, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status}` };
    }

    try {
      return validateOpenApiDocument(await response.json());
    } catch {
      const contentType = response.headers.get('content-type');
      return {
        ok: false,
        message: contentType === null
          ? 'response is not JSON'
          : `response is not JSON (${contentType})`,
      };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, message: `timed out after ${OPENAPI_CHECK_TIMEOUT_MS}ms` };
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkOpenApiFile(cwd: string, openapiPath: string): Promise<OpenApiCheckResult> {
  try {
    await parseOpenApiFile(resolveOpenApiInput(cwd, openapiPath));
    return { ok: true, message: 'OpenAPI file parsed' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export type OpenApiResolveResult =
  | { ok: true; openapi: string }
  | { ok: false; message: string };

export async function resolveOpenApiForInit(
  cwd: string,
  openapiInput: string,
  baseUrl: string | undefined,
  stdout: WritableLike,
  fetchImpl: typeof fetch,
): Promise<OpenApiResolveResult> {
  writeLine(stdout, '');
  writeLine(stdout, 'OpenAPI discovery');

  if (!isHttpUrl(openapiInput)) {
    const fileCheck = await checkOpenApiFile(cwd, openapiInput);
    writeInitStatus(stdout, fileCheck.ok ? 'success' : 'failure', openapiInput, fileCheck.message);

    if (fileCheck.ok) {
      return { ok: true, openapi: openapiInput };
    }

    return { ok: false, message: fileCheck.message };
  }

  const directCheck = await checkOpenApiUrl(openapiInput, fetchImpl);
  writeInitStatus(stdout, directCheck.ok ? 'success' : 'failure', openapiInput, directCheck.message);

  if (directCheck.ok) {
    return { ok: true, openapi: openapiInput };
  }

  let lastMessage = directCheck.message;

  for (const candidate of commonOpenApiUrlsFrom(openapiInput, baseUrl)) {
    const candidateCheck = await checkOpenApiUrl(candidate, fetchImpl);
    writeInitStatus(stdout, candidateCheck.ok ? 'success' : 'failure', candidate, candidateCheck.message);

    if (candidateCheck.ok) {
      return { ok: true, openapi: candidate };
    }

    lastMessage = `${candidate}: ${candidateCheck.message}`;
  }

  return { ok: false, message: lastMessage };
}

function shouldPromptForInit(
  options: InitOpenApiOptions,
  context: InitOpenApiContext,
  stdin: ReadableLike,
  stdout: WritableLike,
): boolean {
  if (options.noInput === true || options.input === false) {
    return false;
  }

  if (options.baseUrl !== undefined && options.openapi !== undefined) {
    return false;
  }

  if (context.interactive !== undefined) {
    return context.interactive;
  }

  return stdin.isTTY === true && stdout.isTTY === true;
}

async function promptForBaseUrl(
  readline: ReturnType<typeof createInterface>,
  stdout: WritableLike,
): Promise<string> {
  while (true) {
    const answer = await readline.question(`API base URL [${DEFAULT_INIT_BASE_URL}]: `);
    const baseUrl = normalizeBaseUrlInput(answer.trim() || DEFAULT_INIT_BASE_URL);

    if (isHttpUrl(baseUrl)) {
      return baseUrl;
    }

    writeLine(stdout, 'baseUrl must be an http(s) URL.');
  }
}

async function promptForOpenApi(
  readline: ReturnType<typeof createInterface>,
  cwd: string,
  baseUrl: string | undefined,
  stdout: WritableLike,
  fetchImpl: typeof fetch,
): Promise<string> {
  let defaultOpenApi = buildDefaultOpenApiUrl(baseUrl ?? DEFAULT_INIT_BASE_URL);

  while (true) {
    const answer = await readline.question(`OpenAPI spec URL/file path or "skip" [${defaultOpenApi}]: `);
    const trimmed = answer.trim();

    if (trimmed.toLowerCase() === 'skip') {
      writeLine(stdout, `${initStatusSymbol(stdout, 'warning')} Saved ${defaultOpenApi} without checking. Edit config.yaml later if needed.`);
      return defaultOpenApi;
    }

    const candidate = trimmed || defaultOpenApi;
    const result = await resolveOpenApiForInit(cwd, candidate, baseUrl, stdout, fetchImpl);

    if (result.ok) {
      return result.openapi;
    }

    writeLine(stdout, '');
    writeLine(stdout, `${initStatusSymbol(stdout, 'failure')} OpenAPI check failed: ${result.message}`);
    writeLine(stdout, '  Enter another URL/file path, press Enter to retry, or type "skip" to save it and edit config.yaml later.');
    defaultOpenApi = candidate;
  }
}

async function autoResolveOpenApiForInit(
  cwd: string,
  baseUrl: string | undefined,
  stdout: WritableLike,
  fetchImpl: typeof fetch,
): Promise<OpenApiResolveResult> {
  const defaultOpenApi = buildDefaultOpenApiUrl(baseUrl ?? DEFAULT_INIT_BASE_URL);
  const result = await resolveOpenApiForInit(cwd, defaultOpenApi, baseUrl, stdout, fetchImpl);

  if (!result.ok) {
    writeLine(stdout, '');
    writeLine(stdout, `${initStatusSymbol(stdout, 'warning')} OpenAPI auto-discovery failed.`);
    writeLine(stdout, '  Enter an OpenAPI URL/file path, or type "skip" to save the default and edit config.yaml later.');
  }

  return result;
}

export async function resolveInitOptionsInteractively<TOptions extends InitOpenApiOptions>(
  options: TOptions,
  context: InitOpenApiContext,
  cwd: string,
): Promise<TOptions> {
  const stdin = context.stdin ?? process.stdin;
  const stdout = context.stdout ?? process.stdout;

  if (!shouldPromptForInit(options, context, stdin, stdout)) {
    return options;
  }

  const readline = createInterface({
    input: stdin,
    output: stdout as NodeJS.WritableStream,
    terminal: stdout.isTTY === true,
  });

  try {
    const baseUrl = options.baseUrl === undefined
      ? await promptForBaseUrl(readline, stdout)
      : normalizeBaseUrlInput(options.baseUrl);
    let openapi = options.openapi;

    if (openapi === undefined) {
      const fetchImpl = context.fetch ?? fetch;
      const automaticOpenApi = await autoResolveOpenApiForInit(cwd, baseUrl, stdout, fetchImpl);
      openapi = automaticOpenApi.ok
        ? automaticOpenApi.openapi
        : await promptForOpenApi(readline, cwd, baseUrl, stdout, fetchImpl);
    }

    return {
      ...options,
      baseUrl,
      openapi,
    };
  } finally {
    readline.close();
  }
}
