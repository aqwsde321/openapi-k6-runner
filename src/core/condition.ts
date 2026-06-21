export interface StatusCondition {
  operator: '===' | '!==' | '>=' | '<';
  status: number;
}

const CONDITION_PATTERN = /^status\s*(==|!=|>=|<)\s*(\d{3})$/;

export function parseStatusCondition(condition: string): StatusCondition | undefined {
  const match = CONDITION_PATTERN.exec(condition.trim());

  if (!match) {
    return undefined;
  }

  const operator = match[1] === '=='
    ? '==='
    : match[1] === '!='
      ? '!=='
      : match[1];

  return {
    operator: operator as StatusCondition['operator'],
    status: Number(match[2]),
  };
}

export function isSupportedStatusCondition(condition: string): boolean {
  return parseStatusCondition(condition) !== undefined;
}

export function evaluateStatusCondition(status: number, condition: StatusCondition): boolean {
  switch (condition.operator) {
    case '===':
      return status === condition.status;
    case '!==':
      return status !== condition.status;
    case '>=':
      return status >= condition.status;
    case '<':
      return status < condition.status;
  }
}

export function formatUnsupportedConditionError(stepId: string, condition: string): string {
  return `step "${stepId}": unsupported condition "${condition}"`;
}
