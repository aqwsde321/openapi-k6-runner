import { describe, expect, it } from 'vitest';

import {
  formatRequestPreview,
  formatResponsePreview,
  formatRunRequest,
  formatRunResponse,
  resolveScenarioTargetNames,
} from '../src/cli/ui/app/scenario-flow-format.js';
import { resolveActiveModule } from '../src/cli/ui/app/active-module.js';
import { groupExplorerItems } from '../src/cli/ui/app/explorer-groups.js';

describe('React UI explorer', () => {
  it('중첩 그룹별 항목 수를 집계한다', () => {
    const groups = groupExplorerItems([
      { group: 'account/recovery', id: 'one' },
      { group: 'account/recovery', id: 'two' },
      { group: 'account/auth', id: 'three' },
      { group: 'root', id: 'four' },
    ]);

    expect(groups.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: 'account', count: 3 },
      { key: 'root', count: 1 },
    ]);
    expect(groups[0]?.children.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: 'account/recovery', count: 2 },
      { key: 'account/auth', count: 1 },
    ]);

    expect(groupExplorerItems(
      Array.from({ length: 134 }, (_, index) => ({ group: 'large', id: String(index) })),
    )[0]?.count).toBe(134);
  });

  it('CLI module 옵션과 단일 모듈을 실행 대상으로 우선한다', () => {
    const module = (name: string) => ({
      name,
      snapshot: { status: 'missing' as const },
      status: 'unknown' as const,
    });

    expect(resolveActiveModule({
      checkedAt: '',
      configPath: 'config.yaml',
      defaultModule: 'default',
      moduleOption: 'selected',
      modules: [module('default'), module('selected')],
    }, undefined)).toBe('selected');
    expect(resolveActiveModule({
      checkedAt: '',
      configPath: 'config.yaml',
      modules: [module('only')],
    }, undefined)).toBe('only');
  });

  it('실행 전 요청과 예상 응답을 읽기 쉬운 텍스트로 만든다', () => {
    expect(formatRequestPreview({})).toBeUndefined();
    expect(formatRequestPreview({ body: {} })).toBe('body:\n{}');
    expect(formatRequestPreview({
      headers: { authorization: '***' },
      body: { loginId: '{{vars.loginId}}' },
    })).toBe([
      'headers:',
      '{\n  "authorization": "***"\n}',
      '',
      'body:',
      '{\n  "loginId": "{{vars.loginId}}"\n}',
    ].join('\n'));
    expect(formatResponsePreview({ status: '200' })).toBe('status: 200');
  });

  it('실행 후 실제 요청과 응답을 읽기 쉬운 텍스트로 만든다', () => {
    expect(formatRunRequest(undefined, undefined)).toBeUndefined();
    expect(formatRunRequest('https://api.test.local/users', {
      headers: { authorization: '***' },
      body: '{"name":"tester"}',
    })).toContain('body:\n{\n  "name": "tester"\n}');
    expect(formatRunResponse({
      status: 201,
      statusText: 'Created',
      body: '{"token":"***"}',
    })).toContain('status: 201 Created');
  });

  it('input 단계는 API 실행 대상으로 집계하지 않는다', () => {
    expect(resolveScenarioTargetNames({
      targetModules: ['app'],
      steps: [{ input: { name: 'otp', required: true } }],
    }, undefined, 'app')).toEqual([]);
    expect(resolveScenarioTargetNames({
      steps: [{ module: 'vendor' }, { input: { name: 'otp', required: true } }],
    }, undefined, 'app')).toEqual(['vendor']);
  });
});
