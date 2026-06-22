import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LoadTestConfig, LoadTestModuleConfig } from '../src/config/load-test.config.js';
import { resolveUiModuleBaseUrl } from '../src/cli/ui/base-url.js';

describe('UI baseUrl resolver', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'openapi-k6-ui-base-url-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('resolves configured baseUrl sources by documented priority', async () => {
    const config = createConfig({ baseUrl: 'https://root.test.local' });
    const moduleConfig = createModuleConfig({ baseUrl: 'https://module.test.local' });

    await expect(resolveUiModuleBaseUrl({ config }, moduleConfig, {
      BASE_URL_APP: ' https://module-env.test.local ',
      BASE_URL: 'https://root-env.test.local',
    })).resolves.toEqual({
      baseUrl: 'https://module-env.test.local',
      source: 'BASE_URL_APP',
    });

    await expect(resolveUiModuleBaseUrl({ config }, moduleConfig, {
      BASE_URL: 'https://root-env.test.local',
    })).resolves.toEqual({
      baseUrl: 'https://root-env.test.local',
      source: 'BASE_URL',
    });

    await expect(resolveUiModuleBaseUrl({ config }, moduleConfig, {})).resolves.toEqual({
      baseUrl: 'https://module.test.local',
      source: 'modules.app.baseUrl',
    });

    await expect(resolveUiModuleBaseUrl({ config }, createModuleConfig(), {})).resolves.toEqual({
      baseUrl: 'https://root.test.local',
      source: 'baseUrl',
    });
  });

  it('falls back to snapshot servers[0].url', async () => {
    await mkdir(path.join(workspace, 'openapi'), { recursive: true });
    await writeFile(
      path.join(workspace, 'openapi', 'app.openapi.json'),
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'App API', version: '1.0.0' },
        servers: [{ url: 'https://snapshot.test.local' }],
        paths: {},
      }),
      'utf8',
    );

    const config = createConfig();
    const moduleConfig = createModuleConfig({ snapshot: 'openapi/app.openapi.json' });

    await expect(resolveUiModuleBaseUrl({ config }, moduleConfig, {})).resolves.toEqual({
      baseUrl: 'https://snapshot.test.local',
      source: 'modules.app.snapshot servers[0].url',
    });
  });

  it('ignores blank and TODO configured values', async () => {
    const config = createConfig({ baseUrl: ' TODO ' });
    const moduleConfig = createModuleConfig({
      baseUrl: ' ',
      snapshot: 'TODO',
    });

    await expect(resolveUiModuleBaseUrl({ config }, moduleConfig, {
      BASE_URL_APP: 'TODO',
      BASE_URL: ' ',
    })).resolves.toEqual({});
  });

  function createConfig(options: { baseUrl?: string } = {}): LoadTestConfig {
    return {
      path: path.join(workspace, 'config.yaml'),
      dir: workspace,
      baseUrl: options.baseUrl,
      modules: new Map([['app', createModuleConfig()]]),
    };
  }

  function createModuleConfig(options: Partial<LoadTestModuleConfig> = {}): LoadTestModuleConfig {
    return {
      name: 'app',
      ...options,
    };
  }
});
