import fs from 'node:fs/promises';
import path from 'node:path';

export interface InitLoadTestsOptions {
  cwd: string;
  directory?: string;
  module?: string;
  baseUrl?: string;
  openapi?: string;
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

  const openapi = normalizeOpenApiForConfig(options.cwd, directoryPath, options.openapi);

  await writeTextFile(configPath, renderConfig(moduleName, options.baseUrl, openapi), options.force);
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

function normalizeOpenApiForConfig(
  cwd: string,
  configDirectoryPath: string,
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const openapi = value.trim();

  if (!openapi || isHttpUrl(openapi) || path.isAbsolute(openapi)) {
    return openapi || undefined;
  }

  const relativePath = path.relative(configDirectoryPath, path.resolve(cwd, openapi));

  return normalizePathSeparators(relativePath || '.');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizePathSeparators(value: string): string {
  return value.split(path.sep).join('/');
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

function renderConfig(moduleName: string, baseUrl: string | undefined, openapi: string | undefined): string {
  return [
    `baseUrl: ${baseUrl ?? 'TODO'}`,
    `defaultModule: ${moduleName}`,
    '',
    'modules:',
    `  ${moduleName}:`,
    `    openapi: ${openapi ?? 'TODO'}`,
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
  const configArg = shellQuote(configPath);
  const scenarioArg = shellQuote(scenarioPath);
  const outputArg = shellQuote(outputPath);
  const usesDefaultDirectory = directory === 'load-tests';

  return [
    `# ${directory}`,
    '',
    'OpenAPI 기반 k6 smoke script를 생성하기 위한 프로젝트 로컬 테스트 자산입니다.',
    '',
    '## 생성된 구조',
    '',
    '```text',
    `${directory}/`,
    '├── README.md',
    '├── config.yaml',
    '├── openapi/',
    `│   ├── ${moduleName}.openapi.json`,
    `│   └── ${moduleName}.catalog.json`,
    '├── scenarios/',
    '│   └── smoke.yaml',
    '└── generated/',
    '    └── smoke.k6.js',
    '```',
    '',
    '## 1. config.yaml 채우기',
    '',
    '`config.yaml`의 `TODO` 값을 실제 테스트 대상 값으로 바꿉니다.',
    '',
    '```yaml',
    'baseUrl: https://api.example.com',
    `defaultModule: ${moduleName}`,
    '',
    'modules:',
    `  ${moduleName}:`,
    '    openapi: https://api.example.com/v3/api-docs',
    `    snapshot: openapi/${moduleName}.openapi.json`,
    `    catalog: openapi/${moduleName}.catalog.json`,
    '```',
    '',
    '- `baseUrl`: generated k6 script가 호출할 API base URL',
    '- `openapi`: `sync`가 읽을 OpenAPI URL 또는 파일 경로',
    '- `snapshot`: `sync`가 저장하고 `generate`가 읽을 OpenAPI snapshot',
    '- `catalog`: scenario 작성 시 참고할 endpoint 목록',
    '',
    '## 2. smoke scenario 확인',
    '',
    '`scenarios/smoke.yaml`의 `path`를 인증 없이 호출 가능한 GET endpoint로 바꿉니다.',
    '',
    '```yaml',
    'name: smoke',
    '',
    'steps:',
    '  - id: smoke',
    '    api:',
    '      method: GET',
    '      path: /health',
    '    condition: status == 200',
    '```',
    '',
    '`condition`은 흐름 분기가 아니라 k6 `check`입니다. 실패해도 다음 step 실행은 계속됩니다.',
    '',
    '## 3. OpenAPI snapshot 생성',
    '',
    '```bash',
    usesDefaultDirectory
      ? 'openapi-k6 sync'
      : `openapi-k6 sync --config ${configArg} --module ${moduleName}`,
    '```',
    '',
    '생성 결과:',
    '',
    `- \`${directory}/openapi/${moduleName}.openapi.json\``,
    `- \`${directory}/openapi/${moduleName}.catalog.json\``,
    '',
    '`catalog.json`에서 `operationId`, `method`, `path`, `tags`, `parameters`, `hasRequestBody`를 확인할 수 있습니다.',
    '',
    '## 4. k6 script 생성',
    '',
    '```bash',
    'openapi-k6 generate \\',
    ...(usesDefaultDirectory
      ? ['  -s smoke']
      : [
          `  --config ${configArg} \\`,
          `  --module ${moduleName} \\`,
          `  --scenario ${scenarioArg} \\`,
          `  --write ${outputArg}`,
        ]),
    '```',
    '',
    `생성 결과: \`${directory}/generated/smoke.k6.js\``,
    '',
    '## 5. k6 실행',
    '',
    '```bash',
    `k6 run ${outputArg}`,
    '```',
    '',
    '실행 시 base URL을 바꾸려면 `BASE_URL` 환경 변수를 넘깁니다.',
    '',
    '```bash',
    `BASE_URL=https://api.example.com k6 run ${outputArg}`,
    '```',
    '',
    '## 자주 쓰는 수정 위치',
    '',
    '- endpoint 변경: `scenarios/smoke.yaml`의 `api.path`',
    '- header/body/query 추가: `scenarios/smoke.yaml`의 `request`',
    '- 대상 API 변경: `config.yaml`의 `baseUrl`, `modules.<name>.openapi`',
    '- module 추가: `config.yaml`의 `modules` 항목 추가 후 `openapi-k6 sync --module <name>`',
    '',
  ].join('\n');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}
