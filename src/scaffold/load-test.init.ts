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
  envExamplePath: string;
  gitignorePath: string;
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
  const envExamplePath = path.join(directoryPath, '.env.example');
  const gitignorePath = path.join(directoryPath, '.gitignore');
  const scenarioPath = path.join(directoryPath, 'scenarios/smoke.yaml');
  const readmePath = path.join(directoryPath, 'README.md');
  const smokePath = normalizeEndpointPath(options.smokePath ?? '/health');

  await fs.mkdir(path.join(directoryPath, 'openapi'), { recursive: true });
  await fs.mkdir(path.join(directoryPath, 'scenarios'), { recursive: true });
  await fs.mkdir(path.join(directoryPath, 'generated'), { recursive: true });

  const openapi = normalizeOpenApiForConfig(options.cwd, directoryPath, options.openapi);

  await writeTextFile(configPath, renderConfig(moduleName, options.baseUrl, openapi), options.force);
  await writeTextFile(envExamplePath, renderEnvExample(options.baseUrl), options.force);
  await writeTextFile(gitignorePath, renderGitignore(), options.force);
  await writeTextFile(scenarioPath, renderSmokeScenario(smokePath), options.force);
  await writeTextFile(readmePath, renderReadme(moduleName, directory, options.cliPath), options.force);

  return {
    directoryPath,
    configPath,
    envExamplePath,
    gitignorePath,
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

function renderEnvExample(baseUrl: string | undefined): string {
  return [
    '# Copy this file to .env and fill values for local k6 runs.',
    '# k6 does not auto-load .env files. Export these variables before running k6.',
    `BASE_URL=${baseUrl ?? 'http://localhost:8080'}`,
    '',
    '# Example scenario secrets. Add or rename variables as needed.',
    'LOGIN_ID=',
    'LOGIN_PASSWORD=',
    '',
  ].join('\n');
}

function renderGitignore(): string {
  return [
    '.env',
    '',
  ].join('\n');
}

function renderReadme(moduleName: string, directory: string, cliPath: string | undefined): string {
  const configPath = `${directory}/config.yaml`;
  const scenarioPath = `${directory}/scenarios/smoke.yaml`;
  const outputPath = `${directory}/generated/smoke.k6.js`;
  const workflowScenarioPath = `${directory}/scenarios/login-flow.yaml`;
  const workflowOutputPath = `${directory}/generated/login-flow.k6.js`;
  const envPath = `${directory}/.env`;
  const configArg = shellQuote(configPath);
  const scenarioArg = shellQuote(scenarioPath);
  const outputArg = shellQuote(outputPath);
  const workflowScenarioArg = shellQuote(workflowScenarioPath);
  const workflowOutputArg = shellQuote(workflowOutputPath);
  const envArg = shellQuote(envPath);
  const aliasCommand = renderAliasCommand(cliPath);
  const buildDirectory = inferBuildDirectory(cliPath);
  const usesDefaultDirectory = directory === 'load-tests';

  return [
    `# ${directory}`,
    '',
    '이 폴더는 OpenAPI 기반 k6 시나리오, OpenAPI snapshot, 생성된 k6 스크립트를 관리합니다.',
    '',
    '## 0. openapi-k6 명령 준비',
    '',
    '이 README는 `openapi-k6 init`으로 생성되었습니다. 이 문서의 명령은 `openapi-k6`가 현재 shell에서 실행 가능하다는 전제입니다.',
    '',
    '새 터미널이나 AI 세션에서 작업할 때는 먼저 명령이 잡혀 있는지 확인합니다.',
    '',
    '```bash',
    'openapi-k6 --help',
    '```',
    '',
    '`command not found`가 나오면 generator 저장소에서 CLI를 빌드하고 전역 link를 연결합니다.',
    '',
    '```bash',
    `cd ${shellQuote(buildDirectory)}`,
    'pnpm install',
    'pnpm run build',
    'pnpm link --global',
    'openapi-k6 --help',
    '```',
    '',
    '<details>',
    '<summary>`pnpm link --global`에서 global bin directory 오류가 날 때</summary>',
    '',
    'pnpm shell 설정을 적용한 뒤 다시 link합니다.',
    '',
    '```bash',
    'pnpm setup',
    'source ~/.zshrc',
    `cd ${shellQuote(buildDirectory)}`,
    'pnpm link --global',
    'openapi-k6 --help',
    '```',
    '',
    '</details>',
    '',
    '전역 link를 쓰지 않는 환경에서는 아래 alias를 현재 터미널에서 실행합니다. alias 경로는 `init`을 실행한 CLI 경로로 자동 기록됩니다.',
    '',
    '```bash',
    aliasCommand,
    'openapi-k6 --help',
    '```',
    '',
    'alias는 현재 터미널 세션에만 적용됩니다. 새 터미널에서는 같은 alias를 다시 설정해야 합니다.',
    'generator 저장소를 옮기거나 다시 clone하면 alias도 다시 설정합니다.',
    '',
    'generator 코드를 수정한 뒤에는 generator 저장소에서 다시 빌드합니다.',
    '',
    '```bash',
    `cd ${shellQuote(buildDirectory)}`,
    'pnpm run build',
    '```',
    '',
    '## 생성된 구조',
    '',
    '```text',
    `${directory}/`,
    '├── README.md',
    '├── config.yaml',
    '├── .env.example',
    '├── .gitignore',
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
    '        username: "{{env.LOGIN_ID}}"',
    '        password: "{{env.LOGIN_PASSWORD}}"',
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
    '지원되는 template:',
    '',
    '- `{{variableName}}`: 이전 step의 `extract`로 저장한 context 값',
    '- `{{env.NAME}}`: k6 실행 시 export된 환경변수 값. secret에 사용합니다.',
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
    'scenario에서 `{{env.NAME}}`을 사용한다면 `.env.example`을 `.env`로 복사한 뒤 실행 전에 export합니다.',
    '',
    '```bash',
    `cp ${shellQuote(`${directory}/.env.example`)} ${envArg}`,
    'set -a',
    `source ${envArg}`,
    'set +a',
    `k6 run ${outputArg}`,
    '```',
    '',
    '## 자주 쓰는 수정 위치',
    '',
    '- endpoint 변경: `scenarios/smoke.yaml`의 `api.path`',
    '- header/body/query 추가: `scenarios/smoke.yaml`의 `request`',
    '- 대상 API 변경: `config.yaml`의 `baseUrl`, `modules.<name>.openapi`',
    '- module 추가: `config.yaml`의 `modules` 항목 추가 후 `openapi-k6 sync --module <name>`',
    '',
    '## 제거 방법',
    '',
    `이 scaffold를 제거하려면 대상 프로젝트 루트에서 \`${directory}/\` 폴더를 삭제합니다.`,
    '',
    '삭제 전에 현재 위치와 삭제 대상을 확인합니다.',
    '',
    '```bash',
    'pwd',
    `ls ${shellQuote(directory)}`,
    `rm -rf ${shellQuote(directory)}`,
    '```',
    '',
    `주의: 이 명령은 \`${directory}/config.yaml\`, \`${directory}/.env.example\`, \`${directory}/.gitignore\`, \`${directory}/scenarios/\`, \`${directory}/openapi/\`, \`${directory}/generated/\`를 모두 삭제합니다.`,
    '필요한 scenario, snapshot, catalog가 있으면 먼저 백업합니다.',
    '',
    '## AI Work Guide',
    '',
    'This section is written for AI agents. Human users should read the usage sections above first.',
    '',
    'When an AI agent works in this folder, follow these steps.',
    '',
    '1. Check whether `TODO` values remain in `config.yaml`.',
    '2. If `TODO` values exist, fill `baseUrl` and `modules.<name>.openapi` with project-specific values.',
    '3. Run `openapi-k6 sync` to create the OpenAPI snapshot and endpoint catalog.',
    '4. Read `openapi/*.catalog.json` and inspect `operationId`, `method`, `path`, `parameters`, and `hasRequestBody` for target endpoints.',
    '5. Update `scenarios/smoke.yaml` for the selected endpoint.',
    '6. Run `openapi-k6 generate` to regenerate the k6 script.',
    '7. For scenarios that need secrets, copy `.env.example` to `.env` and fill local values.',
    '8. Run the generated script with `k6 run` when verification is needed.',
    '9. For a new test, add `scenarios/<name>.yaml` and run `openapi-k6 generate -s <name>`.',
    '',
    'Rules:',
    '',
    '- Do not edit `generated/*.k6.js` directly. Edit scenario YAML and regenerate.',
    '- Do not edit `openapi/*.openapi.json` directly. Refresh snapshots with `sync`.',
    '- `catalog.json` is for humans and AI agents. The generator reads the snapshot OpenAPI file, not the catalog.',
    '- For authenticated APIs, define header templates under `scenarios/*.yaml` `request.headers`.',
    '- Do not write secrets such as passwords directly in YAML. Use `{{env.NAME}}`.',
    '- Store real secret values in `.env` and do not commit it. Keep placeholders only in `.env.example`.',
    '- `condition` compiles to a k6 `check`; it is not a branch. Later steps still run even if a check fails.',
    '- Resolve config-relative paths from the directory containing `config.yaml`.',
    '',
    'Files to inspect:',
    '',
    `- \`${directory}/config.yaml\`: base URL, OpenAPI URL, snapshot/catalog paths`,
    `- \`${directory}/.env.example\`: local secret environment variable example`,
    `- \`${directory}/openapi/${moduleName}.catalog.json\`: endpoint catalog`,
    `- \`${directory}/scenarios/smoke.yaml\`: scenario DSL`,
    `- \`${directory}/generated/smoke.k6.js\`: generated k6 script`,
    '',
    '## AI Prompt Examples',
    '',
    'Basic smoke test:',
    '',
    '```text',
    `Read ${directory}/README.md first and follow it.`,
    `Fill TODO values in ${directory}/config.yaml for this project.`,
    'Run the OpenAPI snapshot command from this README to create the catalog.',
    `Read ${directory}/openapi/*.catalog.json and choose one unauthenticated GET endpoint.`,
    `Update ${directory}/scenarios/smoke.yaml for that endpoint.`,
    'Run the k6 script generation command from this README.',
    `Do not edit ${directory}/generated/*.k6.js or ${directory}/openapi/*.openapi.json directly.`,
    '```',
    '',
    'New scenario:',
    '',
    '```text',
    `Read ${directory}/README.md and ${directory}/openapi/*.catalog.json.`,
    'Choose one read endpoint that can be called without login.',
    `Create ${directory}/scenarios/basic-read.yaml.`,
    'Then generate the k6 script using the new scenario generation command in this README.',
    `Do not edit ${directory}/generated/*.k6.js directly.`,
    '```',
    '',
    'Authenticated flow:',
    '',
    '```text',
    `Read ${directory}/README.md and ${directory}/openapi/*.catalog.json.`,
    'Find the login API and a user-profile/read API.',
    'Create a login-flow scenario.',
    'Extract token from the login response.',
    'Use Bearer {{token}} in the Authorization header of the next step.',
    'Then generate the k6 script using the new scenario generation command in this README.',
    '```',
    '',
  ].join('\n');
}

function renderAliasCommand(cliPath: string | undefined): string {
  const resolvedCliPath = cliPath ?? '/path/to/openapi-k6-runner/dist/cli/index.js';
  const command = `node ${shellQuote(resolvedCliPath)}`;

  return `alias openapi-k6=${shellQuote(command)}`;
}

function inferBuildDirectory(cliPath: string | undefined): string {
  if (cliPath === undefined) {
    return '/path/to/openapi-k6-runner';
  }

  const cliDirectory = path.dirname(cliPath);
  const parent = path.basename(cliDirectory);
  const grandParent = path.basename(path.dirname(cliDirectory));

  if (parent === 'cli' && grandParent === 'dist') {
    return path.resolve(cliDirectory, '../..');
  }

  return path.dirname(cliPath);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}
