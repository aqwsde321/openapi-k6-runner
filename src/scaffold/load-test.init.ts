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
  cliPath?: string;
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
  await writeTextFile(readmePath, renderReadme(moduleName, directory, options.cliPath), options.force);

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
    '# API 호출 기준 URL입니다. generated k6 script의 fallback BASE_URL로 사용됩니다.',
    '# k6 실행 시 BASE_URL 환경 변수를 넘기면 이 값보다 우선합니다.',
    `baseUrl: ${baseUrl ?? 'TODO'}`,
    '',
    '# 기본으로 사용할 OpenAPI module 이름입니다.',
    '# 아래 modules.<name> 중 하나와 같아야 합니다.',
    '# module이 1개뿐이면 보통 default 그대로 둬도 됩니다.',
    `defaultModule: ${moduleName}`,
    '',
    '# OpenAPI module 목록입니다.',
    '# module을 여러 개 두면 openapi-k6 sync/generate에서 --module <name>으로 선택할 수 있습니다.',
    'modules:',
    `  ${moduleName}:`,
    '    # sync가 읽을 OpenAPI URL 또는 파일 경로입니다.',
    '    # 예: https://api.example.com/v3/api-docs',
    `    openapi: ${openapi ?? 'TODO'}`,
    '',
    '    # sync가 저장하고 generate가 읽을 OpenAPI snapshot 경로입니다.',
    '    # 상대 경로는 이 config.yaml 위치 기준입니다.',
    `    snapshot: openapi/${moduleName}.openapi.json`,
    '',
    '    # scenario 작성자가 endpoint를 고를 때 참고할 catalog 경로입니다.',
    '    # generate 입력은 catalog가 아니라 snapshot입니다.',
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

function renderReadme(moduleName: string, directory: string, cliPath: string | undefined): string {
  const configPath = `${directory}/config.yaml`;
  const scenarioPath = `${directory}/scenarios/smoke.yaml`;
  const outputPath = `${directory}/generated/smoke.k6.js`;
  const workflowScenarioPath = `${directory}/scenarios/login-flow.yaml`;
  const workflowOutputPath = `${directory}/generated/login-flow.k6.js`;
  const configArg = shellQuote(configPath);
  const scenarioArg = shellQuote(scenarioPath);
  const outputArg = shellQuote(outputPath);
  const workflowScenarioArg = shellQuote(workflowScenarioPath);
  const workflowOutputArg = shellQuote(workflowOutputPath);
  const aliasCommand = renderAliasCommand(cliPath);
  const usesDefaultDirectory = directory === 'load-tests';

  return [
    `# ${directory}`,
    '',
    'OpenAPI 기반 k6 기본 동작 확인용 테스트 자산입니다.',
    '',
    '## 0. openapi-k6 명령 준비',
    '',
    '이 문서의 명령은 `openapi-k6`가 현재 shell에서 실행 가능하다는 전제입니다.',
    '',
    '```bash',
    'openapi-k6 --help',
    '```',
    '',
    '`command not found`가 나오면 generator 저장소를 빌드한 뒤 대상 백엔드 프로젝트 터미널에서 alias를 설정합니다.',
    '',
    '```bash',
    '# generator 저장소',
    'cd /path/to/openapi-k6-runner',
    'pnpm install',
    'pnpm run build',
    '',
    '# 대상 백엔드 프로젝트 터미널',
    aliasCommand,
    'openapi-k6 --help',
    '```',
    '',
    'alias의 경로는 현재 `init`을 실행한 CLI 경로입니다. generator 저장소를 옮기거나 다시 clone하면 alias도 다시 설정합니다.',
    '',
    'alias는 현재 터미널 세션에만 적용됩니다. 새 터미널에서는 같은 alias를 다시 설정해야 합니다.',
    '',
    '## AI 작업 가이드',
    '',
    'AI가 이 폴더를 기준으로 작업할 때는 아래 순서를 따릅니다.',
    '',
    '1. `config.yaml`에서 `TODO` 값이 남아 있는지 확인합니다.',
    '2. `TODO`가 있으면 `baseUrl`과 `modules.<name>.openapi`를 실제 값으로 채웁니다.',
    '3. `openapi-k6 sync`를 실행해 OpenAPI snapshot과 catalog를 만듭니다.',
    '4. `openapi/*.catalog.json`에서 테스트할 endpoint의 `operationId`, `method`, `path`, `parameters`, `hasRequestBody`를 확인합니다.',
    '5. `scenarios/smoke.yaml`을 실제 endpoint에 맞게 수정합니다.',
    '6. `openapi-k6 generate`로 k6 script를 다시 생성합니다.',
    '7. 필요하면 `k6 run`으로 생성된 script를 실행합니다.',
    '8. 새 테스트가 필요하면 `scenarios/<name>.yaml` 파일을 추가하고 `openapi-k6 generate -s <name>`으로 생성합니다.',
    '',
    '작업 규칙:',
    '',
    '- `generated/*.k6.js`는 직접 고치지 말고 scenario를 수정한 뒤 다시 generate합니다.',
    '- `openapi/*.openapi.json`은 원격 OpenAPI snapshot이므로 직접 고치지 말고 `sync`로 갱신합니다.',
    '- `catalog.json`은 참고용입니다. generator 입력은 catalog가 아니라 snapshot OpenAPI입니다.',
    '- 인증이 필요한 API는 `scenarios/*.yaml`의 `request.headers`에 header template을 명시합니다.',
    '- `condition`은 흐름 분기가 아니라 k6 `check`입니다. 실패해도 다음 step은 계속 실행됩니다.',
    '- config 상대 경로는 `config.yaml` 위치 기준입니다.',
    '',
    'AI가 확인해야 할 핵심 파일:',
    '',
    `- \`${directory}/config.yaml\`: base URL, OpenAPI URL, snapshot/catalog 경로`,
    `- \`${directory}/openapi/${moduleName}.catalog.json\`: endpoint 목록`,
    `- \`${directory}/scenarios/smoke.yaml\`: scenario DSL`,
    `- \`${directory}/generated/smoke.k6.js\`: 생성된 k6 script`,
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
    '## 새 scenario 작성',
    '',
    '새 테스트는 `scenarios/<name>.yaml` 파일로 추가합니다. 파일명과 `name`은 같은 값을 쓰는 것을 권장합니다.',
    '',
    'endpoint 선택 기준:',
    '',
    '1. 먼저 `openapi/*.catalog.json`에서 사용할 endpoint를 찾습니다.',
    '2. `operationId`가 있으면 `api.operationId`를 우선 사용합니다.',
    '3. `operationId`가 없거나 불명확하면 `api.method`와 `api.path`를 사용합니다.',
    '4. path parameter가 있으면 `request.pathParams`에 값을 넣습니다.',
    '5. 이전 step 응답값이 필요하면 `extract`로 context에 저장한 뒤 `{{variableName}}`으로 참조합니다.',
    '',
    '### operationId 기반 예시',
    '',
    `\`${directory}/scenarios/login-flow.yaml\`:`,
    '',
    '```yaml',
    'name: login-flow',
    '',
    'steps:',
    '  - id: login',
    '    api:',
    '      operationId: loginUser',
    '    request:',
    '      body:',
    '        username: test-user',
    '        password: test-password',
    '    extract:',
    '      token:',
    '        from: $.token',
    '    condition: status == 200',
    '',
    '  - id: get-me',
    '    api:',
    '      operationId: getMe',
    '    request:',
    '      headers:',
    '        Authorization: "Bearer {{token}}"',
    '    condition: status < 300',
    '```',
    '',
    '### method + path 기반 예시',
    '',
    '```yaml',
    'name: order-read',
    '',
    'steps:',
    '  - id: get-order',
    '    api:',
    '      method: GET',
    '      path: /orders/{orderId}',
    '    request:',
    '      pathParams:',
    '        orderId: "123"',
    '      query:',
    '        includeItems: true',
    '    condition: status == 200',
    '```',
    '',
    '지원되는 request 필드:',
    '',
    '- `headers`: HTTP headers',
    '- `query`: query string',
    '- `pathParams`: OpenAPI path template의 `{name}` 값',
    '- `body`: JSON request body',
    '',
    '지원되는 condition:',
    '',
    '- `status == 200`',
    '- `status != 500`',
    '- `status >= 200`',
    '- `status < 300`',
    '',
    '새 scenario 생성:',
    '',
    '```bash',
    ...(usesDefaultDirectory
      ? ['openapi-k6 generate -s login-flow']
      : [
          'openapi-k6 generate \\',
          `  --config ${configArg} \\`,
          `  --module ${moduleName} \\`,
          `  --scenario ${workflowScenarioArg} \\`,
          `  --write ${workflowOutputArg}`,
        ]),
    '```',
    '',
    `생성 결과: \`${workflowOutputPath}\``,
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

function renderAliasCommand(cliPath: string | undefined): string {
  const resolvedCliPath = cliPath ?? '/path/to/openapi-k6-runner/dist/cli/index.js';
  const command = `node ${shellQuote(resolvedCliPath)}`;

  return `alias openapi-k6=${shellQuote(command)}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}
