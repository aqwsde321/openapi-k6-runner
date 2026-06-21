import path from 'node:path';

import {
  resolveConfigModule,
  type LoadTestConfig,
  type LoadTestModuleConfig,
} from '../config/load-test.config.js';
import { syncOpenApiSnapshot } from '../openapi/openapi.catalog.js';
import {
  countCatalogTags,
  filterCatalogOperations,
  findDuplicateOperationWarnings,
  normalizeCatalogFilters,
  readCatalogFile,
  shouldListCatalogOperations,
  sortCatalogOperations,
} from './catalog.js';
import {
  resolveConfiguredFilePath,
  resolveConfiguredOpenApiInput,
} from './config-input.js';
import type {
  CatalogOptions,
  CatalogResult,
  CliContext,
  SyncOptions,
  SyncResult,
} from './index.js';
import { loadOptionalConfig } from './optional-config.js';

export async function runSyncCommand(
  options: SyncOptions,
  context: CliContext = {},
): Promise<SyncResult> {
  const cwd = resolveCwd(context);
  const config = await loadOptionalConfig(
    cwd,
    options.config,
    options.openapi === undefined || options.write === undefined || options.catalog === undefined,
  );
  const moduleConfig = selectConfigModule(config, options.module);
  const moduleName = moduleConfig?.name ?? '<none>';
  const openapiPath = resolveConfiguredOpenApiInput(
    cwd,
    config,
    options.openapi,
    moduleConfig?.openapi,
    '--openapi is required unless --config provides modules.<name>.openapi',
    `modules.${moduleName}.openapi`,
    'sync',
  );
  const snapshotPath = resolveConfiguredFilePath(
    cwd,
    config,
    options.write,
    moduleConfig?.snapshot,
    '--write is required unless --config provides modules.<name>.snapshot',
    `modules.${moduleName}.snapshot`,
    'sync',
  );
  const catalogPath = resolveConfiguredFilePath(
    cwd,
    config,
    options.catalog,
    moduleConfig?.catalog,
    '--catalog is required unless --config provides modules.<name>.catalog',
    `modules.${moduleName}.catalog`,
    'sync',
  );
  const result = await syncOpenApiSnapshot({
    openapi: openapiPath,
    write: snapshotPath,
    catalog: catalogPath,
  });

  return {
    openapiPath,
    snapshotPath: result.snapshotPath,
    catalogPath: result.catalogPath,
    operationCount: result.operationCount,
    ...(moduleConfig === undefined ? {} : { moduleName: moduleConfig.name }),
  };
}

export async function runCatalogCommand(
  options: CatalogOptions,
  context: CliContext = {},
): Promise<CatalogResult> {
  const cwd = resolveCwd(context);

  const synced = options.sync === true
    ? await runSyncCommand({
        config: options.config,
        module: options.module,
      }, context)
    : undefined;
  const config = await loadOptionalConfig(cwd, options.config, true);
  const moduleConfig = selectConfigModule(config, options.module);
  const moduleName = moduleConfig?.name ?? '<none>';
  const catalogPath = resolveConfiguredFilePath(
    cwd,
    config,
    undefined,
    moduleConfig?.catalog,
    'modules.<name>.catalog is required to search catalog',
    `modules.${moduleName}.catalog`,
    'catalog',
  );
  const catalog = await readCatalogFile(catalogPath, {
    cwd,
    config,
    moduleName: moduleConfig?.name,
    openapi: moduleConfig?.openapi,
    options,
  });
  const filters = normalizeCatalogFilters(options);
  const shouldList = shouldListCatalogOperations(filters) ||
    options.ai === true ||
    options.snippet === true;
  const operations = shouldList
    ? sortCatalogOperations(filterCatalogOperations(catalog.operations, filters))
    : [];

  return {
    catalogPath,
    source: catalog.source,
    generatedAt: catalog.generatedAt,
    totalOperationCount: catalog.operations.length,
    operations,
    tagCounts: countCatalogTags(catalog.operations),
    warnings: shouldList ? findDuplicateOperationWarnings(operations) : [],
    filters,
    ...(moduleConfig === undefined ? {} : { moduleName: moduleConfig.name }),
    ...(synced === undefined ? {} : { synced }),
  };
}

function selectConfigModule(
  config: LoadTestConfig | undefined,
  moduleName: string | undefined,
): LoadTestModuleConfig | undefined {
  if (config === undefined) {
    if (moduleName !== undefined) {
      throw new Error('--module requires --config');
    }

    return undefined;
  }

  return resolveConfigModule(config, moduleName);
}

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
}
