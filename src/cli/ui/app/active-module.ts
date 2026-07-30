import type { UiServerCheckResult } from '../server-checks.js';

export function resolveActiveModule(
  checks: UiServerCheckResult | undefined,
  scenarioDefault: string | undefined,
) {
  return checks?.moduleOption
    ?? checks?.defaultModule
    ?? scenarioDefault
    ?? (checks?.modules.length === 1 ? checks.modules[0]?.name : undefined);
}
