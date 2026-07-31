import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LoadTestConfig } from '../src/config/load-test.config.js';
import {
  formatUiScenarioOption,
  resolveLoadTestDir,
  resolveUiEditableScenarioPath,
  resolveUiScenarioPath,
} from '../src/cli/ui/scenario-paths.js';

describe('UI scenario paths', () => {
  let workspace: string;
  let config: LoadTestConfig;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-ui-scenario-paths-'));
    config = {
      path: path.join(workspace, 'openapi-k6', 'config.yaml'),
      dir: path.join(workspace, 'openapi-k6'),
      modules: new Map([['app', { name: 'app' }]]),
    };
    await mkdir(path.join(config.dir, 'scenarios', 'auth'), { recursive: true });
    await writeFile(path.join(config.dir, 'scenarios', 'auth', 'login.yaml'), 'name: login\nsteps: []\n', 'utf8');
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('resolves scenario keys inside the configured scenarios directory', () => {
    expect(resolveUiScenarioPath({ cwd: workspace, config }, 'auth/login')).toBe(
      path.join(config.dir, 'scenarios', 'auth', 'login.yaml'),
    );
  });

  it('formats yaml scenario files as scenario keys', () => {
    const scenarioDir = path.join(resolveLoadTestDir(workspace, config), 'scenarios');

    expect(formatUiScenarioOption(
      workspace,
      scenarioDir,
      path.join(scenarioDir, 'auth', 'login.yaml'),
    )).toBe('auth/login');
  });

  it('rejects partials and fixtures as runnable scenarios', () => {
    expect(() => resolveUiScenarioPath(
      { cwd: workspace, config },
      path.join(config.dir, 'scenarios', 'partials', 'shared.yaml'),
    )).toThrow('scenario must be inside openapi-k6/scenarios');

    expect(() => resolveUiScenarioPath(
      { cwd: workspace, config },
      path.join(config.dir, 'scenarios', 'fixtures', 'users.yaml'),
    )).toThrow('scenario must be inside openapi-k6/scenarios');
  });

  it('rejects editable scenario symlinks that leave the scenario directory', async () => {
    const outsidePath = path.join(workspace, 'outside.yaml');
    await writeFile(outsidePath, 'name: outside\nsteps: []\n', 'utf8');
    await symlink(outsidePath, path.join(config.dir, 'scenarios', 'auth', 'outside.yaml'));

    await expect(resolveUiEditableScenarioPath({ cwd: workspace, config }, 'auth/outside'))
      .rejects.toThrow('scenario must be inside openapi-k6/scenarios');
  });

  it('edits only regular scenario files', async () => {
    const textPath = path.join(config.dir, 'scenarios', 'auth', 'notes.txt');
    await writeFile(textPath, 'not a scenario\n', 'utf8');

    await expect(resolveUiEditableScenarioPath({ cwd: workspace, config }, textPath))
      .rejects.toThrow('scenario must be inside openapi-k6/scenarios');
    await expect(resolveUiEditableScenarioPath(
      { cwd: workspace, config },
      path.join(config.dir, 'scenarios', 'auth'),
    )).rejects.toThrow('scenario must be inside openapi-k6/scenarios');
  });
});
