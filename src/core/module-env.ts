export function createModuleBaseUrlEnvName(moduleName: string): string {
  return `BASE_URL_${moduleName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export interface ModuleBaseUrlEnvNameCollision {
  envName: string;
  moduleNames: string[];
}

export function findModuleBaseUrlEnvNameCollisions(
  moduleNames: string[],
): ModuleBaseUrlEnvNameCollision[] {
  const namesByEnv = new Map<string, string[]>();

  for (const moduleName of moduleNames) {
    const envName = createModuleBaseUrlEnvName(moduleName);
    namesByEnv.set(envName, [...(namesByEnv.get(envName) ?? []), moduleName]);
  }

  return [...namesByEnv.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([envName, names]) => ({ envName, moduleNames: names }));
}
