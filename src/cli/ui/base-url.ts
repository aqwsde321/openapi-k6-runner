import { resolveConfigFilePath, type LoadTestConfig, type LoadTestModuleConfig } from '../../config/load-test.config.js';
import { createModuleBaseUrlEnvName } from '../../core/module-env.js';
import { parseOpenApiFile } from '../../openapi/openapi.parser.js';

const TODO_VALUE = 'TODO';

export interface UiBaseUrlResolveContext {
  config: LoadTestConfig;
}

export async function resolveUiModuleBaseUrl(
  context: UiBaseUrlResolveContext,
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

export function isConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value.trim().toUpperCase() !== TODO_VALUE;
}

function normalizeConfiguredValue(value: string | undefined): string | undefined {
  return isConfiguredValue(value) ? value.trim() : undefined;
}
