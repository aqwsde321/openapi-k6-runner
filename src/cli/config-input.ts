import path from 'node:path';

import {
  resolveConfigFilePath,
  type LoadTestConfig,
} from '../config/load-test.config.js';

const TODO_VALUE = 'TODO';

export function resolveOpenApiInput(cwd: string, value: string): string {
  if (isHttpUrl(value)) {
    return value;
  }

  return path.resolve(cwd, value);
}

export function resolveConfiguredOpenApiInput(
  cwd: string,
  config: LoadTestConfig | undefined,
  cliValue: string | undefined,
  configValue: string | undefined,
  message: string,
  configFieldLabel: string,
  commandName: string,
): string {
  if (cliValue !== undefined) {
    return resolveOpenApiInput(cwd, cliValue);
  }

  if (config !== undefined && isConfiguredValue(configValue)) {
    return resolveConfigFilePath(config, configValue);
  }

  if (config !== undefined) {
    throw new Error(formatMissingConfigValueError(config.path, configFieldLabel, commandName));
  }

  throw new Error(message);
}

export function resolveConfiguredFilePath(
  cwd: string,
  config: LoadTestConfig | undefined,
  cliValue: string | undefined,
  configValue: string | undefined,
  message: string,
  configFieldLabel: string,
  commandName: string,
): string {
  if (cliValue !== undefined) {
    return path.resolve(cwd, cliValue);
  }

  if (config !== undefined && isConfiguredValue(configValue)) {
    return resolveConfigFilePath(config, configValue);
  }

  if (config !== undefined) {
    throw new Error(formatMissingConfigValueError(config.path, configFieldLabel, commandName));
  }

  throw new Error(message);
}

export function isConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value.trim().toUpperCase() !== TODO_VALUE;
}

export function normalizeConfiguredValue(value: string | undefined): string | undefined {
  return isConfiguredValue(value) ? value.trim() : undefined;
}

export function formatMissingConfigValueError(
  configPath: string,
  configFieldLabel: string,
  commandName: string,
): string {
  return [
    `${configPath}: ${configFieldLabel} is not configured.`,
    '',
    'Edit:',
    `  ${configPath}`,
    '',
    'Set:',
    `  ${configFieldLabel}`,
    '',
    'After editing:',
    '  rerun the command',
  ].join('\n');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
