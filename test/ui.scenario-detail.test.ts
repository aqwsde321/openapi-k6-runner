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
      '      X-Mixed-Token: Bearer literal-mixed {{env.ACCESS_TOKEN}}',
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
        headers: {
          Authorization: '***',
          'X-Mixed-Token': '{{env.ACCESS_TOKEN}}',
        },
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

  it('JSON 정의와 외부 anchor fallback도 안전한 상세로 유지한다', () => {
    const json = maskUiYamlDefinitionCode(JSON.stringify({
      id: 'json-login',
      api: { method: 'POST', path: '/login' },
      request: { body: { password: 'literal-password' } },
    }));
    const fallback = maskUiYamlDefinitionCode('request: *shared', {
      id: 'anchor-login',
      api: { method: 'POST', path: '/login' },
      request: { body: { password: 'literal-password' } },
    });

    expect(JSON.parse(json ?? '')).toEqual({
      id: 'json-login',
      api: { method: 'POST', path: '/login' },
      request: { body: { password: '***' } },
    });
    expect(parseYaml(fallback ?? '')).toEqual([{
      id: 'anchor-login',
      api: { method: 'POST', path: '/login' },
      request: { body: { password: '***' } },
    }]);
    expect(fallback).not.toContain('literal-password');
  });
});
