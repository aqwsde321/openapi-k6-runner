import type { ApiRegistry, ApiStep } from './types.js';

export type ApiRegistrySource = ApiRegistry | Map<string, ApiRegistry>;

export interface StepRegistryResolveOptions {
  defaultModuleName?: string;
}

export function resolveStepRegistry(
  step: ApiStep,
  registrySource: ApiRegistrySource,
  options: StepRegistryResolveOptions = {},
): { registry: ApiRegistry; moduleName?: string } {
  if (!(registrySource instanceof Map)) {
    if (step.api.module !== undefined) {
      throw new Error(`step "${step.id}": api.module requires a module registry`);
    }

    return { registry: registrySource };
  }

  const moduleName = step.api.module ?? options.defaultModuleName;

  if (moduleName === undefined) {
    throw new Error(`step "${step.id}": api.module is required because no fallback module was selected`);
  }

  const registry = registrySource.get(moduleName);

  if (!registry) {
    throw new Error(`step "${step.id}": api.module "${moduleName}" was not found`);
  }

  return { registry, moduleName };
}
