import fs from 'node:fs/promises';
import path from 'node:path';

export interface InitLoadTestsOptions {
  cwd: string;
  directory?: string;
  module?: string;
  baseUrl: string;
  openapi: string;
  smokePath?: string;
  force?: boolean;
}

export interface InitLoadTestsResult {
  directoryPath: string;
  configPath: string;
  scenarioPath: string;
  readmePath: string;
}

export class InitLoadTestsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitLoadTestsError';
  }
}

export async function initLoadTests(
  options: InitLoadTestsOptions,
): Promise<InitLoadTestsResult> {
  const moduleName = normalizeModuleName(options.module ?? 'default');
  const directory = normalizeDirectory(options.directory ?? 'load-tests');
  const directoryPath = path.resolve(options.cwd, directory);
  const configPath = path.join(directoryPath, 'config.yaml');
  const scenarioPath = path.join(directoryPath, 'scenarios/smoke.yaml');
  const readmePath = path.join(directoryPath, 'README.md');
  const smokePath = normalizeEndpointPath(options.smokePath ?? '/health');

  await fs.mkdir(path.join(directoryPath, 'openapi'), { recursive: true });
  await fs.mkdir(path.join(directoryPath, 'scenarios'), { recursive: true });
  await fs.mkdir(path.join(directoryPath, 'generated'), { recursive: true });

  await writeTextFile(configPath, renderConfig(moduleName, options.baseUrl, options.openapi), options.force);
  await writeTextFile(scenarioPath, renderSmokeScenario(smokePath), options.force);
  await writeTextFile(readmePath, renderReadme(moduleName, directory), options.force);

  return {
    directoryPath,
    configPath,
    scenarioPath,
    readmePath,
  };
}

function normalizeDirectory(value: string): string {
  const directory = value.trim();

  if (!directory) {
    throw new InitLoadTestsError('dir must not be empty');
  }

  return directory;
}

function normalizeModuleName(value: string): string {
  const moduleName = value.trim();

  if (!/^[A-Za-z0-9_-]+$/.test(moduleName)) {
    throw new InitLoadTestsError(
      `module must contain only letters, numbers, "_" or "-": ${JSON.stringify(value)}`,
    );
  }

  return moduleName;
}

function normalizeEndpointPath(value: string): string {
  const endpointPath = value.trim();

  if (!endpointPath.startsWith('/')) {
    throw new InitLoadTestsError(`smokePath must start with "/": ${JSON.stringify(value)}`);
  }

  return endpointPath;
}

async function writeTextFile(
  filePath: string,
  content: string,
  force: boolean | undefined,
): Promise<void> {
  try {
    await fs.writeFile(filePath, content, { encoding: 'utf8', flag: force ? 'w' : 'wx' });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      throw new InitLoadTestsError(`${filePath}: already exists. Use --force to overwrite.`);
    }

    throw error;
  }
}

function renderConfig(moduleName: string, baseUrl: string, openapi: string): string {
  return [
    `baseUrl: ${baseUrl}`,
    `defaultModule: ${moduleName}`,
    '',
    'modules:',
    `  ${moduleName}:`,
    `    openapi: ${openapi}`,
    `    snapshot: openapi/${moduleName}.openapi.json`,
    `    catalog: openapi/${moduleName}.catalog.json`,
    '',
  ].join('\n');
}

function renderSmokeScenario(smokePath: string): string {
  return [
    'name: smoke',
    '',
    'steps:',
    '  - id: smoke',
    '    api:',
    '      method: GET',
    `      path: ${smokePath}`,
    '    condition: status == 200',
    '',
  ].join('\n');
}

function renderReadme(moduleName: string, directory: string): string {
  const configPath = `${directory}/config.yaml`;
  const scenarioPath = `${directory}/scenarios/smoke.yaml`;
  const outputPath = `${directory}/generated/smoke.k6.js`;

  return [
    `# ${directory}`,
    '',
    '```bash',
    `openapi-k6 sync --config ${configPath} --module ${moduleName}`,
    'openapi-k6 generate \\',
    `  --config ${configPath} \\`,
    `  --module ${moduleName} \\`,
    `  --scenario ${scenarioPath} \\`,
    `  --write ${outputPath}`,
    `k6 run ${outputPath}`,
    '```',
    '',
  ].join('\n');
}
