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
  runScriptPath: string;
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
  const runScriptPath = path.join(directoryPath, 'run.sh');
  const scenarioPath = path.join(directoryPath, 'scenarios/smoke.yaml');
  const readmePath = path.join(directoryPath, 'README.md');
  const smokePath = normalizeEndpointPath(options.smokePath ?? '/health');

  await fs.mkdir(path.join(directoryPath, 'openapi'), { recursive: true });
  await fs.mkdir(path.join(directoryPath, 'scenarios'), { recursive: true });
  await fs.mkdir(path.join(directoryPath, 'generated'), { recursive: true });

  const openapi = normalizeOpenApiForConfig(options.cwd, directoryPath, options.openapi);

  await writeTextFile(configPath, renderConfig(moduleName, options.baseUrl, openapi), options.force);
  await writeTextFile(envExamplePath, renderEnvExample(), options.force);
  await writeTextFile(gitignorePath, renderGitignore(), options.force);
  await writeTextFile(runScriptPath, renderRunScript(), options.force);
  await fs.chmod(runScriptPath, 0o755);
  await writeTextFile(scenarioPath, renderSmokeScenario(smokePath), options.force);
  await writeTextFile(readmePath, renderReadme(moduleName, directory, options.cliPath), options.force);

  return {
    directoryPath,
    configPath,
    envExamplePath,
    gitignorePath,
    runScriptPath,
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
    '# API 호출 기준 URL입니다. 생성된 k6 스크립트의 기본 BASE_URL로 사용됩니다.',
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

function renderEnvExample(): string {
  return [
    '# Copy this file to .env and fill local secret values.',
    '# k6 does not auto-load .env files. Export these variables before running k6.',
    '',
    '# Add or rename variables to match {{env.NAME}} templates in scenario YAML.',
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

function renderRunScript(): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
    'SCENARIO="smoke"',
    '',
    'if [[ $# -gt 0 && "$1" != -* ]]; then',
    '  SCENARIO="$1"',
    '  shift',
    'fi',
    '',
    'SCRIPT_PATH="$SCRIPT_DIR/generated/$SCENARIO.k6.js"',
    'ENV_FILE="$SCRIPT_DIR/.env"',
    '',
    'if [[ ! -f "$SCRIPT_PATH" ]]; then',
    '  echo "Missing generated k6 script: $SCRIPT_PATH" >&2',
    '  echo "Run: openapi-k6 generate -s $SCENARIO" >&2',
    '  exit 1',
    'fi',
    '',
    'if [[ -f "$ENV_FILE" ]]; then',
    '  set -a',
    '  # shellcheck disable=SC1091',
    '  source "$ENV_FILE"',
    '  set +a',
    'fi',
    '',
    'exec k6 run "$@" "$SCRIPT_PATH"',
    '',
  ].join('\n');
}

function renderReadme(moduleName: string, directory: string, cliPath: string | undefined): string {
  const configPath = `${directory}/config.yaml`;
  const scenarioPath = `${directory}/scenarios/smoke.yaml`;
  const outputPath = `${directory}/generated/smoke.k6.js`;
  const runScriptPath = `${directory}/run.sh`;
  const workflowScenarioPath = `${directory}/scenarios/login-flow.yaml`;
  const workflowOutputPath = `${directory}/generated/login-flow.k6.js`;
  const envPath = `${directory}/.env`;
  const configArg = shellQuote(configPath);
  const scenarioArg = shellQuote(scenarioPath);
  const outputArg = shellQuote(outputPath);
  const runScriptArg = shellCommandPath(runScriptPath);
  const workflowScenarioArg = shellQuote(workflowScenarioPath);
  const workflowOutputArg = shellQuote(workflowOutputPath);
  const envArg = shellQuote(envPath);
  const aliasCommand = renderAliasCommand(cliPath);
  const buildDirectory = inferBuildDirectory(cliPath);
  const usesDefaultDirectory = directory === 'load-tests';

  return [
    `# ${directory}`,
    '',
    '이 폴더는 백엔드 프로젝트 안에서 OpenAPI snapshot, scenario YAML, 생성된 k6 스크립트를 관리합니다.',
    '',
    '사람이 꼭 이해해야 하는 내용은 이 README 앞부분에 있습니다. 자세한 scenario 작성 규칙과 반복 작업 절차는 아래 `AI Work Guide`를 AI에게 읽히면 됩니다.',
    '',
    '## 사람이 꼭 알아야 하는 것',
    '',
    '- 직접 수정하는 파일은 `config.yaml`, `.env`, `scenarios/*.yaml`입니다.',
    '- `openapi/*.openapi.json`은 `openapi-k6 sync`로 갱신합니다. 직접 고치지 않습니다.',
    '- `generated/*.k6.js`는 `openapi-k6 generate`로 다시 만듭니다. 직접 고치지 않습니다.',
    '- 실제 비밀 값은 YAML에 쓰지 말고 `.env`에만 둡니다. YAML에서는 `{{env.NAME}}`으로 참조합니다.',
    '',
    '## 0. openapi-k6 명령 준비',
    '',
    '이 README는 `openapi-k6 init`으로 생성되었습니다. 먼저 현재 shell에서 명령이 실행되는지 확인합니다.',
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
    'generator 로컬 코드만 수정한 뒤에는 generator 저장소에서 다시 빌드합니다.',
    '',
    '```bash',
    `cd ${shellQuote(buildDirectory)}`,
    'pnpm run build',
    '```',
    '',
    'generator 저장소를 pull/checkout해서 새 버전으로 업데이트한 뒤에는 의존성도 다시 설치하고 빌드합니다.',
    '',
    '```bash',
    `cd ${shellQuote(buildDirectory)}`,
    'pnpm install',
    'pnpm run build',
    '```',
    '',
    '개발 중 수동 빌드가 번거로우면 generator 저장소의 별도 터미널에서 watch 빌드를 켜둡니다.',
    '',
    '```bash',
    `cd ${shellQuote(buildDirectory)}`,
    'pnpm run build:watch',
    '```',
    '',
    '새 버전으로 업데이트한 뒤에는 watch를 다시 시작하는 편이 안전합니다.',
    '',
    '## 생성된 구조',
    '',
    '```text',
    `${directory}/`,
    '├── README.md',
    '├── config.yaml',
    '├── .env.example',
    '├── .gitignore',
    '├── run.sh',
    '├── openapi/',
    `│   ├── ${moduleName}.openapi.json`,
    `│   └── ${moduleName}.catalog.json`,
    '├── scenarios/',
    '│   └── smoke.yaml',
    '└── generated/',
    '    └── smoke.k6.js',
    '```',
    '',
    '## 1. 최소 설정',
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
    '- `baseUrl`: 생성된 k6 스크립트가 호출할 API base URL 기본값',
    '- `openapi`: `sync`가 읽을 OpenAPI URL 또는 파일 경로',
    '- `snapshot`: `sync`가 저장하고 `generate`가 읽을 OpenAPI snapshot',
    '- `catalog`: scenario 작성 시 참고할 endpoint 목록',
    '',
    '외부 파일이나 URL을 가리키는 `$ref`는 snapshot 내부 참조로 묶어 저장하므로, 이후 `generate`는 원격 원본 없이 snapshot 파일만으로 실행할 수 있습니다.',
    '',
    '## 2. 기본 실행 흐름',
    '',
    '```bash',
    usesDefaultDirectory
      ? 'openapi-k6 sync'
      : `openapi-k6 sync --config ${configArg} --module ${moduleName}`,
    '```',
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
    '```bash',
    `${runScriptArg} smoke`,
    '```',
    '',
    '`run.sh`는 같은 폴더의 `.env`를 자동으로 로드한 뒤 `generated/<scenario>.k6.js`를 실행합니다.',
    '',
    'k6 옵션을 넘길 때는 scenario 이름 뒤에 붙입니다.',
    '',
    '```bash',
    `${runScriptArg} smoke --vus 1 --iterations 1`,
    '```',
    '',
    'API base URL은 `openapi-k6 generate` 실행 시점의 `config.yaml` `baseUrl` 값이 생성된 k6 스크립트에 기본값으로 들어갑니다.',
    '`config.yaml`을 수정한 뒤에는 스크립트를 다시 생성해야 반영됩니다.',
    '실행 시점에 `BASE_URL` 환경 변수를 넘기면 스크립트에 들어간 기본값보다 우선합니다.',
    '',
    '```bash',
    `BASE_URL=https://api.example.com ${runScriptArg} smoke`,
    '```',
    '',
    '## 3. 비밀 값 사용',
    '',
    '시나리오에서 `{{env.NAME}}`을 사용한다면 `.env.example`을 `.env`로 복사한 뒤 비밀 값을 채웁니다.',
    '',
    '```bash',
    `cp ${shellQuote(`${directory}/.env.example`)} ${envArg}`,
    `${runScriptArg} smoke`,
    '```',
    '',
    '`run.sh`가 실행할 때 `.env`를 자동으로 export합니다.',
    '',
    '## 4. 자주 하는 수정',
    '',
    '- endpoint 변경: `scenarios/smoke.yaml`의 `api.path`',
    '- header/body/query 추가: `scenarios/*.yaml`의 `request`',
    '- 대상 API 변경: `config.yaml`의 `baseUrl`, `modules.<name>.openapi` 수정 후 `openapi-k6 sync`와 `openapi-k6 generate` 재실행',
    '- module 추가: `config.yaml`의 `modules` 항목 추가 후 `openapi-k6 sync --module <name>`',
    '',
    '## 5. 제거 방법',
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
    `주의: 이 명령은 \`${directory}/config.yaml\`, \`${directory}/.env.example\`, \`${directory}/.gitignore\`, \`${directory}/run.sh\`, \`${directory}/scenarios/\`, \`${directory}/openapi/\`, \`${directory}/generated/\`를 모두 삭제합니다.`,
    '필요한 scenario, snapshot, catalog가 있으면 먼저 백업합니다.',
    '',
    '## AI Work Guide',
    '',
    'This section is for AI agents. Human users only need the Korean sections above unless they want implementation details.',
    '',
    '### Workflow',
    '',
    '1. Read this README before editing files.',
    '2. Check whether `TODO` values remain in `config.yaml`.',
    '3. If `TODO` values exist, fill `baseUrl` and `modules.<name>.openapi` with project-specific values.',
    '4. Run `openapi-k6 sync` to create the OpenAPI snapshot and endpoint catalog.',
    '5. Read `openapi/*.catalog.json` and inspect `operationId`, `method`, `path`, `parameters`, and `hasRequestBody` for target endpoints.',
    '6. Update or create `scenarios/*.yaml`.',
    '7. Run `openapi-k6 generate` to regenerate the k6 script.',
    '8. For scenarios that need secrets, copy `.env.example` to `.env` and fill local values.',
    `9. Run the generated script with \`${runScriptArg} <scenario>\` or the directory-specific run command shown above.`,
    '',
    '### Rules',
    '',
    '- Keep human-facing documentation in Korean.',
    '- Keep AI-only instructions in English.',
    '- Do not edit `generated/*.k6.js` directly. Edit scenario YAML and regenerate.',
    '- Do not edit `openapi/*.openapi.json` directly. Refresh snapshots with `sync`.',
    '- `catalog.json` is for humans and AI agents. The generator reads the snapshot OpenAPI file, not the catalog.',
    '- For authenticated APIs, define header templates under `scenarios/*.yaml` `request.headers`.',
    '- Do not write secrets such as passwords directly in YAML. Use `{{env.NAME}}`.',
    '- Store real secret values in `.env` and do not commit it. Keep placeholders only in `.env.example`.',
    '- `condition` compiles to a k6 `check`; it is not a branch. Later steps still run even if a check fails.',
    '- `pathParams` values are encoded as URL path segments.',
    '- Resolve config-relative paths from the directory containing `config.yaml`.',
    '',
    '### Scenario DSL Reference',
    '',
    'Endpoint selection:',
    '',
    '1. Prefer `api.operationId` when the catalog has a stable operationId.',
    '2. Use `api.method` and `api.path` when operationId is missing or unclear.',
    '3. Add `request.pathParams` for OpenAPI path templates such as `/orders/{orderId}`.',
    '4. Use `extract` to save response values into shared context.',
    '5. Reference extracted values with `{{variableName}}` in later steps.',
    '',
    'Supported request fields:',
    '',
    '- `headers`: HTTP headers',
    '- `query`: query string',
    '- `pathParams`: values for OpenAPI path template placeholders',
    '- `body`: JSON request body',
    '',
    'Supported templates:',
    '',
    '- `{{variableName}}`: value extracted into context by a previous step',
    '- `{{env.NAME}}`: runtime environment variable exported before k6 execution',
    '',
    'Supported conditions:',
    '',
    '- `status == 200`',
    '- `status != 500`',
    '- `status >= 200`',
    '- `status < 300`',
    '',
    'OperationId-based example:',
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
    'Method-and-path example:',
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
    'Generate a new scenario:',
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
    `Generated output: \`${workflowOutputPath}\``,
    '',
    '### Files to inspect',
    '',
    `- \`${directory}/config.yaml\`: base URL, OpenAPI URL, snapshot/catalog paths`,
    `- \`${directory}/.env.example\`: local secret environment variable example`,
    `- \`${directory}/run.sh\`: k6 runner that auto-loads local .env values`,
    `- \`${directory}/openapi/${moduleName}.catalog.json\`: endpoint catalog`,
    `- \`${directory}/scenarios/smoke.yaml\`: scenario DSL`,
    `- \`${directory}/generated/smoke.k6.js\`: generated k6 script`,
    '',
    '### Prompt Examples',
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
    'Keep human-facing documentation in Korean. Keep AI instruction sections in English.',
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
    'Keep human-facing documentation in Korean. Keep AI instruction sections in English.',
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
    'Use {{env.NAME}} for secrets and keep real values in .env only.',
    'Then generate the k6 script using the new scenario generation command in this README.',
    'Keep human-facing documentation in Korean. Keep AI instruction sections in English.',
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

function shellCommandPath(value: string): string {
  if (path.isAbsolute(value) || value.startsWith('./') || value.startsWith('../')) {
    return shellQuote(value);
  }

  return shellQuote(`./${value}`);
}
