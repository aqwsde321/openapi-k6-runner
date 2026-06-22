import { parse as parseDotEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveConfigFilePath, type LoadTestConfig, type LoadTestModuleConfig } from '../../config/load-test.config.js';
import { createModuleBaseUrlEnvName } from '../../core/module-env.js';
import { parseOpenApiFile } from '../../openapi/openapi.parser.js';
import { formatDisplayPath } from './paths.js';
import { resolveLoadTestDir } from './scenarios.js';

const TODO_VALUE = 'TODO';

export type UiSnapshotStatus = 'present' | 'missing' | 'error';

export interface UiServerCheckContext {
  cwd: string;
  config: LoadTestConfig;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export interface UiServerCheckResult {
  checkedAt: string;
  modules: UiModuleServerCheckResult[];
}

export interface UiModuleServerCheckResult {
  name: string;
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

  if (resolved.baseUrl === undefined) {
    return {
      name: moduleConfig.name,
      status: 'unknown',
      error: 'baseUrl is not configured',
      snapshot,
    };
  }

  const startedAt = Date.now();

  try {
    const response = await fetchUiReachability(context.fetch ?? fetch, resolved.baseUrl);
    return {
      name: moduleConfig.name,
      baseUrl: resolved.baseUrl,
      source: resolved.source,
      status: 'reachable',
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      snapshot,
    };
  } catch (error) {
    return {
      name: moduleConfig.name,
      baseUrl: resolved.baseUrl,
      source: resolved.source,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: formatUiError(error),
      snapshot,
    };
  }
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

async function resolveUiModuleBaseUrl(
  context: UiServerCheckContext,
  moduleConfig: LoadTestModuleConfig,
  runtimeEnv: Record<string, string | undefined>,
): Promise<{ baseUrl?: string; source?: string }> {
  const moduleEnvName = createModuleBaseUrlEnvName(moduleConfig.name);
  const moduleEnv = normalizeConfiguredValue(runtimeEnv[moduleEnvName]);

  if (moduleEnv !== undefined) {
    return { baseUrl: moduleEnv, source: moduleEnvName };
  }

  const rootEnv = normalizeConfiguredValue(runtimeEnv.BASE_URL);

  if (rootEnv !== undefined) {
    return { baseUrl: rootEnv, source: 'BASE_URL' };
  }

  const moduleBaseUrl = normalizeConfiguredValue(moduleConfig.baseUrl);

  if (moduleBaseUrl !== undefined) {
    return { baseUrl: moduleBaseUrl, source: `modules.${moduleConfig.name}.baseUrl` };
  }

  const rootBaseUrl = normalizeConfiguredValue(context.config.baseUrl);

  if (rootBaseUrl !== undefined) {
    return { baseUrl: rootBaseUrl, source: 'baseUrl' };
  }

  if (isConfiguredValue(moduleConfig.snapshot)) {
    try {
      const registry = await parseOpenApiFile(resolveConfigFilePath(context.config, moduleConfig.snapshot));

      if (registry.defaultServerUrl !== undefined) {
        return { baseUrl: registry.defaultServerUrl, source: `modules.${moduleConfig.name}.snapshot servers[0].url` };
      }
    } catch {
      return {};
    }
  }

  return {};
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

function isConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value.trim().toUpperCase() !== TODO_VALUE;
}

function normalizeConfiguredValue(value: string | undefined): string | undefined {
  return isConfiguredValue(value) ? value.trim() : undefined;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code;
}
