import { describe, expect, it } from 'vitest';

import type { Scenario } from '../src/core/types.js';
import { buildApiRegistry } from '../src/openapi/openapi.parser.js';
import {
  ScenarioValidationError,
  validateScenarioAgainstOpenApi,
} from '../src/validator/scenario.validator.js';

describe('scenario validator', () => {
  it('allows API steps to reference context values from previous input steps', () => {
    const scenario: Scenario = {
      name: 'signup-with-sms',
      steps: [
        {
          id: 'enter-phone-code',
          input: {
            name: 'signupPhoneCode',
            required: true,
          },
        },
        {
          id: 'verify-phone-code',
          api: { method: 'POST', path: '/phone-verification/verify' },
          request: {
            body: {
              code: '{{signupPhoneCode}}',
            },
          },
        },
      ],
    };

    const result = validateScenarioAgainstOpenApi(scenario, createRegistry());

    expect(result).toMatchObject({
      scenarioName: 'signup-with-sms',
      stepCount: 2,
    });
  });

  it('still rejects context values before the input step defines them', () => {
    const scenario: Scenario = {
      name: 'future-input',
      steps: [
        {
          id: 'verify-phone-code',
          api: { method: 'POST', path: '/phone-verification/verify' },
          request: {
            body: {
              code: '{{signupPhoneCode}}',
            },
          },
        },
        {
          id: 'enter-phone-code',
          input: {
            name: 'signupPhoneCode',
            required: true,
          },
        },
      ],
    };

    expect(() => validateScenarioAgainstOpenApi(scenario, createRegistry()))
      .toThrowError(ScenarioValidationError);
    expect(() => validateScenarioAgainstOpenApi(scenario, createRegistry()))
      .toThrowError('step "verify-phone-code": request.body.code references unknown context.signupPhoneCode');
  });
});

function createRegistry() {
  return buildApiRegistry({
    openapi: '3.0.3',
    info: { title: 'Fixture API', version: '1.0.0' },
    paths: {
      '/phone-verification/verify': {
        post: {
          responses: { 200: { description: 'OK' } },
        },
      },
    },
  });
}
