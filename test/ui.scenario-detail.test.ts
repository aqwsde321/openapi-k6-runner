import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { maskUiYamlDefinitionCode } from '../src/cli/ui/scenarios.js';

describe('UI scenario detail', () => {
  it('YAML 정의의 literal secret을 가리고 template은 유지한다', () => {
    const code = maskUiYamlDefinitionCode([
      '- id: login',
      '  api:',
      '    method: POST',
      '    path: /login',
      '  request:',
      '    headers:',
      '      Authorization: Bearer literal-auth',
      '    body:',
      '      username: tester',
      '      password:',
      '        literal: literal-password',
      '        template: "{{env.PASSWORD}}"',
      '      tokens:',
      '        - literal-token',
      '        - "{{vars.accessToken}}"',
    ].join('\n'));

    expect(parseYaml(code ?? '')).toEqual([{
      id: 'login',
      api: { method: 'POST', path: '/login' },
      request: {
        headers: { Authorization: '***' },
        body: {
          username: 'tester',
          password: {
            literal: '***',
            template: '{{env.PASSWORD}}',
          },
          tokens: ['***', '{{vars.accessToken}}'],
        },
      },
    }]);
    expect(code).not.toContain('literal-auth');
    expect(code).not.toContain('literal-password');
    expect(code).not.toContain('literal-token');
    expect(maskUiYamlDefinitionCode('[invalid')).toBeUndefined();
  });
});
