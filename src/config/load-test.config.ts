import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface LoadTestConfig {
  path: string;
  dir: string;
  baseUrl?: string;
  defaultModule?: string;
  modules: Map<string, LoadTestModuleConfig>;
}

export interface LoadTestModuleConfig {
  name: string;
  openapi?: string;
  snapshot?: string;
  catalog?: string;
  baseUrl?: string;
}

export class LoadTestConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadTestConfigError';
  }
}

export async function loadTestConfig(configPath: string): Promise<LoadTestConfig> {
  const resolvedPath = path.resolve(configPath);
  const raw = await fs.readFile(resolvedPath, 'utf8');
  const parsed = parseConfigSource(raw, resolvedPath);
  const config = expectRecord(parsed, `${resolvedPath}: config must be an object`);
  const modulesValue = expectRecord(config.modules, `${resolvedPath}: modules must be an object`);
  const modules = new Map<string, LoadTestModuleConfig>();

  for (const [moduleName, moduleValue] of Object.entries(modulesValue)) {
    const moduleConfig = expectRecord(
      moduleValue,
      `${resolvedPath}: modules.${moduleName} must be an object`,
    );
    modules.set(moduleName, {
      name: moduleName,
      openapi: readOptionalString(moduleConfig.openapiUrl) ?? readOptionalString(moduleConfig.openapi),
      snapshot: readOptionalString(moduleConfig.snapshot),
      catalog: readOptionalString(moduleConfig.catalog),
      baseUrl: readOptionalString(moduleConfig.baseUrl),
    });
  }

  if (modules.size === 0) {
    throw new LoadTestConfigError(`${resolvedPath}: modules must include at least one module`);
  }

  const defaultModule = readOptionalString(config.defaultModule);

  if (defaultModule !== undefined && !modules.has(defaultModule)) {
    throw new LoadTestConfigError(
      `${resolvedPath}: defaultModule "${defaultModule}" was not found in modules`,
    );
  }

  return {
    path: resolvedPath,
    dir: path.dirname(resolvedPath),
    baseUrl: readOptionalString(config.baseUrl),
    defaultModule,
    modules,
  };
}

export function resolveConfigModule(
  config: LoadTestConfig,
  moduleName: string | undefined,
): LoadTestModuleConfig {
  const selectedName = moduleName ?? config.defaultModule ?? inferOnlyModuleName(config);
  const moduleConfig = config.modules.get(selectedName);

  if (!moduleConfig) {
    const available = [...config.modules.keys()].join(', ');
    throw new LoadTestConfigError(
      `${config.path}: module "${selectedName}" was not found. Available modules: ${available}`,
    );
  }

  return moduleConfig;
}

export function resolveConfigFilePath(config: LoadTestConfig, value: string): string {
  if (isHttpUrl(value) || path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(config.dir, value);
}

function inferOnlyModuleName(config: LoadTestConfig): string {
  if (config.modules.size === 1) {
    const [moduleName] = config.modules.keys();
    return moduleName;
  }

  throw new LoadTestConfigError(
    `${config.path}: module is required because defaultModule is not configured`,
  );
}

function parseConfigSource(source: string, sourcePath: string): unknown {
  try {
    return parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LoadTestConfigError(`${sourcePath}: failed to parse config: ${message}`);
  }
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LoadTestConfigError(message);
  }

  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown): string | undefined {
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
