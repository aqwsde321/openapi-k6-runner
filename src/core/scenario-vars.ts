export const SCENARIO_VAR_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const RESERVED_VAR_NAMES = new Set(['__proto__']);

export function formatScenarioVarNameIssue(name: string, pathLabel: string): string | undefined {
  if (!name.trim()) {
    return `${pathLabel}: variable name must not be empty`;
  }

  if (!SCENARIO_VAR_NAME_PATTERN.test(name)) {
    return `${pathLabel} must match ${SCENARIO_VAR_NAME_PATTERN.source} for {{vars.NAME}} references`;
  }

  if (RESERVED_VAR_NAMES.has(name)) {
    return `${pathLabel} is reserved and cannot be referenced as {{vars.${name}}}`;
  }

  return undefined;
}
