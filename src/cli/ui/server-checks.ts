import { parse as parseDotEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveConfigFilePath, type LoadTestConfig, type LoadTestModuleConfig } from '../../config/load-test.config.js';
import { isConfiguredValue, resolveUiModuleBaseUrl } from './base-url.js';
import { formatDisplayPath } from './paths.js';
import { resolveLoadTestDir } from './scenario-paths.js';

export type UiSnapshotStatus = 'present' | 'missing' | 'error';

export interface UiServerCheckContext {
  cwd: string;
  config: LoadTestConfig;
  moduleOption?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export interface UiServerCheckResult {
  checkedAt: string;
  configPath: string;
  defaultModule?: string;
  moduleOption?: string;
  modules: UiModuleServerCheckResult[];
}

export interface UiModuleServerCheckResult {
  name: string;
  openapi?: string;
  baseUrl?: string;
  source?: string;
  status: 'unknown' | 'reachable' | 'failed';
  httpStatus?: number;
  durationMs?: number;
  error?: string;
  snapshot: {
    path?: string;
    status: UiSnapshotStatus;
    error?: string;
  };
}

export async function checkUiServers(context: UiServerCheckContext): Promise<UiServerCheckResult> {
  const loadTestDir = resolveLoadTestDir(context.cwd, context.config);
  const runtimeEnv = {
    ...(await loadLoadTestEnv(loadTestDir)),
    ...(context.env ?? process.env),
  };
  const modules = [];

  for (const moduleConfig of context.config.modules.values()) {
    modules.push(await checkUiModuleServer(context, moduleConfig, runtimeEnv));
  }

  return {
    checkedAt: new Date().toISOString(),
    configPath: formatDisplayPath(context.cwd, context.config.path),
    ...(context.config.defaultModule === undefined ? {} : { defaultModule: context.config.defaultModule }),
    ...(context.moduleOption === undefined ? {} : { moduleOption: context.moduleOption }),
    modules,
  };
}

async function loadLoadTestEnv(loadTestDir: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(loadTestDir, '.env'), 'utf8');
    return parseDotEnv(raw);
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return {};
    }

    throw error;
  }
}

async function checkUiModuleServer(
  context: UiServerCheckContext,
  moduleConfig: LoadTestModuleConfig,
  runtimeEnv: Record<string, string | undefined>,
): Promise<UiModuleServerCheckResult> {
  const snapshot = await checkUiSnapshot(context, moduleConfig);
  const resolved = await resolveUiModuleBaseUrl(context, moduleConfig, runtimeEnv);
  const metadata = {
    name: moduleConfig.name,
    ...formatUiOpenApiSource(context, moduleConfig),
  };

  if (resolved.baseUrl === undefined) {
    return {
      ...metadata,
      status: 'unknown',
      error: 'baseUrl is not configured',
      snapshot,
    };
  }

  const startedAt = Date.now();

  try {
    const response = await fetchUiReachability(context.fetch ?? fetch, resolved.baseUrl);
    return {
      ...metadata,
      baseUrl: formatUiUrl(resolved.baseUrl),
      source: resolved.source,
      status: 'reachable',
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      snapshot,
    };
  } catch (error) {
    return {
      ...metadata,
      baseUrl: formatUiUrl(resolved.baseUrl),
      source: resolved.source,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: formatUiUrlError(error, resolved.baseUrl),
      snapshot,
    };
  }
}

function formatUiOpenApiSource(
  context: UiServerCheckContext,
  moduleConfig: LoadTestModuleConfig,
): { openapi?: string } {
  if (!isConfiguredValue(moduleConfig.openapi)) {
    return {};
  }

  const openapi = resolveConfigFilePath(context.config, moduleConfig.openapi);
  return {
    openapi: /^https?:\/\//i.test(openapi) ? formatUiUrl(openapi) : formatDisplayPath(context.cwd, openapi),
  };
}

function formatUiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid URL';
  }
  if (!url.username && !url.password && !url.search && !url.hash) {
    return value;
  }

  if (url.username || url.password) {
    url.username = '***';
    url.password = '';
  }
  if (url.search) {
    const masked = new URLSearchParams();
    for (const key of url.searchParams.keys()) {
      masked.append(key, '***');
    }
    url.search = masked.toString();
  }
  if (url.hash) {
    url.hash = '#***';
  }
  return url.toString();
}

async function checkUiSnapshot(
  context: UiServerCheckContext,
  moduleConfig: LoadTestModuleConfig,
): Promise<{ path?: string; status: UiSnapshotStatus; error?: string }> {
  if (!isConfiguredValue(moduleConfig.snapshot)) {
    return {
      status: 'missing',
      error: 'snapshot is not configured',
    };
  }

  const snapshotPath = resolveConfigFilePath(context.config, moduleConfig.snapshot);
  const displayPath = formatDisplayPath(context.cwd, snapshotPath);

  try {
    await fs.access(snapshotPath);
    return {
      path: displayPath,
      status: 'present',
    };
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return {
        path: displayPath,
        status: 'missing',
        error: 'run openapi-k6 sync',
      };
    }

    return {
      path: displayPath,
      status: 'error',
      error: formatUiError(error),
    };
  }
}

function formatUiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && 'cause' in error
    ? (error as Error & { cause?: unknown }).cause
    : undefined;

  if (cause instanceof Error && cause.message && cause.message !== message) {
    return `${message}: ${cause.message}`;
  }

  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
    return `${message}: ${cause.code}`;
  }

  return message;
}

function formatUiUrlError(error: unknown, rawUrl: string): string {
  const displayUrl = formatUiUrl(rawUrl);
  let message = formatUiError(error);
  try {
    message = message.replaceAll(new URL(rawUrl).toString(), displayUrl);
  } catch {
    // Invalid URL is already rendered as a generic label.
  }
  return message.replaceAll(rawUrl, displayUrl);
}

async function fetchUiReachability(fetchImpl: typeof fetch, baseUrl: string): Promise<Response> {
  const targetUrl = new URL(baseUrl);
  const head = await fetchWithTimeout(fetchImpl, targetUrl, 'HEAD');

  if (head.ok || head.status > 0) {
    return head;
  }

  return fetchWithTimeout(fetchImpl, targetUrl, 'GET');
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: URL, method: 'GET' | 'HEAD'): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    return await fetchImpl(url, {
      method,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}
