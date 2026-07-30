import { describe, expect, it } from 'vitest';

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
});
