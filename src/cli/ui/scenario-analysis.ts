import { collectTemplateReferences } from '../../core/template.js';
import { isInputStep, type Scenario } from '../../core/types.js';

export function analyzeUiScenario(scenario: Scenario): {
  modules: string[];
  env: string[];
  vars: string[];
} {
  const modules = new Set<string>();
  const env = new Set<string>();
  const vars = new Set<string>();

  for (const step of scenario.steps) {
    if (isInputStep(step)) {
      continue;
    }

    if (step.api.module !== undefined) {
      modules.add(step.api.module);
    }

    collectUiTemplateReferences(step.request, env, vars);
  }

  collectUiTemplateReferences(scenario.vars, env, vars);

  return {
    modules: [...modules].sort(),
    env: [...env].sort(),
    vars: [...vars].sort(),
  };
}

function collectUiTemplateReferences(value: unknown, env: Set<string>, vars: Set<string>): void {
  if (typeof value === 'string') {
    try {
      for (const reference of collectTemplateReferences(value)) {
        if (reference.type === 'env') {
          env.add(reference.name);
        } else if (reference.type === 'vars') {
          vars.add(reference.name);
        }
      }
    } catch {
      return;
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUiTemplateReferences(item, env, vars);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectUiTemplateReferences(item, env, vars);
    }
  }
}
