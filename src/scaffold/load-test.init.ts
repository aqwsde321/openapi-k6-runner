import { readFileSync } from 'node:fs';
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

const README_TEMPLATE = readFileSync(
  new URL('./templates/load-tests.README.md', import.meta.url),
  'utf8',
);

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
    '# Copy this file to .env next to run.sh and fill local secret values.',
    '# run.sh auto-loads this .env file. Plain k6 run does not.',
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
    'logs/',
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
    'SCENARIO_CAN_BE_SET=true',
    'LOG_ENABLED=false',
    'TRACE_ENABLED=false',
    'REPORT_ENABLED=false',
    'DASHBOARD_OPEN_ENABLED=false',
    'K6_ARGS=()',
    '',
    'print_usage() {',
    '  printf "\\n"',
    '  cat <<EOF',
    'Usage: $0 [scenario] [run.sh flags] [k6 run options]',
    '',
    'Examples:',
    '  $0 smoke',
    '  $0 smoke --vus 1 --iterations 1',
    '  $0 smoke --log',
    '  $0 smoke --trace --log --report --duration 10s --vus 1',
    '',
    'run.sh flags:',
    '  --log             Save console output to logs/<scenario>.log',
    '  --trace           Print OpenAPI step start/end logs',
    '  --report          Export k6 Web Dashboard HTML to logs/<scenario>-report.html',
    '  --open-dashboard  Open the k6 Web Dashboard while the test is running',
    '  -h, --help        Show this help',
    '',
    'Notes:',
    '  The default scenario is smoke.',
    '  k6 options must come after the scenario name.',
    '  This script loads only the .env file next to run.sh.',
    '  It does not load the backend project root .env.',
    '  Create it from .env.example when scenarios use {{env.NAME}}.',
    '  See README.md in this directory for the full workflow.',
    'EOF',
    '}',
    '',
    'while [[ $# -gt 0 ]]; do',
    '  case "$1" in',
    '    -h|--help)',
    '      print_usage',
    '      exit 0',
    '      ;;',
    '    --log)',
    '      LOG_ENABLED=true',
    '      shift',
    '      ;;',
    '    --trace)',
    '      TRACE_ENABLED=true',
    '      shift',
    '      ;;',
    '    --report)',
    '      REPORT_ENABLED=true',
    '      shift',
    '      ;;',
    '    --open-dashboard)',
    '      DASHBOARD_OPEN_ENABLED=true',
    '      shift',
    '      ;;',
    '    --)',
    '      shift',
    '      K6_ARGS+=("$@")',
    '      break',
    '      ;;',
    '    -*)',
    '      SCENARIO_CAN_BE_SET=false',
    '      K6_ARGS+=("$1")',
    '      shift',
    '      ;;',
    '    *)',
    '      if [[ "$SCENARIO_CAN_BE_SET" == "true" ]]; then',
    '        SCENARIO="$1"',
    '        SCENARIO_CAN_BE_SET=false',
    '      else',
    '        K6_ARGS+=("$1")',
    '      fi',
    '      shift',
    '      ;;',
    '  esac',
    'done',
    '',
    'SCRIPT_PATH="$SCRIPT_DIR/generated/$SCENARIO.k6.js"',
    'ENV_FILE="$SCRIPT_DIR/.env"',
    'LOG_DIR="$SCRIPT_DIR/logs"',
    'LOG_FILE="$LOG_DIR/$SCENARIO.log"',
    'REPORT_FILE="$LOG_DIR/$SCENARIO-report.html"',
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
    'if [[ "$TRACE_ENABLED" == "true" ]]; then',
    '  export OPENAPI_K6_TRACE=1',
    'fi',
    '',
    'if [[ "$REPORT_ENABLED" == "true" ]]; then',
    '  export K6_WEB_DASHBOARD=true',
    '  export K6_WEB_DASHBOARD_PERIOD="${K6_WEB_DASHBOARD_PERIOD:-1s}"',
    '  export K6_WEB_DASHBOARD_EXPORT="${K6_WEB_DASHBOARD_EXPORT:-$REPORT_FILE}"',
    '  mkdir -p "$(dirname "$K6_WEB_DASHBOARD_EXPORT")"',
    '  echo "Writing k6 HTML report to $K6_WEB_DASHBOARD_EXPORT"',
    'fi',
    '',
    'if [[ "$DASHBOARD_OPEN_ENABLED" == "true" ]]; then',
    '  export K6_WEB_DASHBOARD=true',
    '  export K6_WEB_DASHBOARD_OPEN=true',
    'fi',
    '',
    'if [[ "$LOG_ENABLED" == "true" ]]; then',
    '  mkdir -p "$LOG_DIR"',
    '  echo "Writing k6 output to $LOG_FILE"',
    '  set +e',
    '  k6 run ${K6_ARGS[@]+"${K6_ARGS[@]}"} "$SCRIPT_PATH" 2>&1 | tee "$LOG_FILE"',
    '  status="${PIPESTATUS[0]}"',
    '  set -e',
    '  exit "$status"',
    'fi',
    '',
    'exec k6 run ${K6_ARGS[@]+"${K6_ARGS[@]}"} "$SCRIPT_PATH"',
    '',
  ].join('\n');
}

function renderReadme(moduleName: string, directory: string, cliPath: string | undefined): string {
  const configPath = directory + '/config.yaml';
  const scenarioPath = directory + '/scenarios/smoke.yaml';
  const outputPath = directory + '/generated/smoke.k6.js';
  const snapshotPath = directory + '/openapi/' + moduleName + '.openapi.json';
  const catalogPath = directory + '/openapi/' + moduleName + '.catalog.json';
  const logPath = directory + '/logs/smoke.log';
  const reportPath = directory + '/logs/smoke-report.html';
  const runScriptPath = directory + '/run.sh';
  const scenarioTemplatePath = directory + '/scenarios/<name>.yaml';
  const outputTemplatePath = directory + '/generated/<name>.k6.js';
  const workflowScenarioPath = directory + '/scenarios/login-flow.yaml';
  const workflowOutputPath = directory + '/generated/login-flow.k6.js';
  const fixturesPath = directory + '/fixtures/';
  const envPath = directory + '/.env';
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

  const syncCommand = usesDefaultDirectory
    ? 'openapi-k6 sync'
    : 'openapi-k6 sync --config ' + configArg + ' --module ' + moduleName;
  const testNameCommand = usesDefaultDirectory
    ? 'openapi-k6 test -s <name>'
    : 'openapi-k6 test --config ' + configArg + ' --module ' + moduleName + ' --scenario ' + shellQuote(scenarioTemplatePath);
  const generateNameCommand = usesDefaultDirectory
    ? 'openapi-k6 generate -s <name>'
    : 'openapi-k6 generate --config ' + configArg + ' --module ' + moduleName + ' --scenario ' + shellQuote(scenarioTemplatePath) + ' --write ' + shellQuote(outputTemplatePath);
  const testSmokeCommand = usesDefaultDirectory
    ? 'openapi-k6 test -s smoke'
    : 'openapi-k6 test --config ' + configArg + ' --module ' + moduleName + ' --scenario ' + scenarioArg;
  const generateSmokeCommand = usesDefaultDirectory
    ? 'openapi-k6 generate \\\n  -s smoke'
    : [
        'openapi-k6 generate \\',
        '  --config ' + configArg + ' \\',
        '  --module ' + moduleName + ' \\',
        '  --scenario ' + scenarioArg + ' \\',
        '  --write ' + outputArg,
      ].join('\n');
  const testWorkflowCommand = usesDefaultDirectory
    ? 'openapi-k6 test -s login-flow'
    : 'openapi-k6 test --config ' + configArg + ' --module ' + moduleName + ' --scenario ' + workflowScenarioArg;
  const generateWorkflowCommand = usesDefaultDirectory
    ? 'openapi-k6 generate -s login-flow'
    : 'openapi-k6 generate --config ' + configArg + ' --module ' + moduleName + ' --scenario ' + workflowScenarioArg + ' --write ' + workflowOutputArg;

  return renderReadmeTemplate({
    ALIAS_COMMAND: aliasCommand,
    BASE_URL_RUN_COMMAND: 'BASE_URL=https://api.example.com ' + runScriptArg + ' smoke',
    BUILD_DIRECTORY: shellQuote(buildDirectory),
    CATALOG_PATH: catalogPath,
    CONFIG_PATH: configPath,
    DIRECTORY: directory,
    DIRECTORY_SHELL_ARG: shellQuote(directory),
    ENV_COPY_COMMAND: 'cp ' + shellQuote(directory + '/.env.example') + ' ' + envArg,
    ENV_PATH: envPath,
    FIXTURES_PATH: fixturesPath,
    GENERATE_NAME_COMMAND: generateNameCommand,
    GENERATE_SMOKE_COMMAND: generateSmokeCommand,
    GENERATE_WORKFLOW_COMMAND: generateWorkflowCommand,
    LOG_PATH: logPath,
    MODULE_NAME: moduleName,
    OUTPUT_PATH: outputPath,
    OUTPUT_TEMPLATE_PATH: outputTemplatePath,
    REPORT_PATH: reportPath,
    RUN_SCRIPT_ARG: runScriptArg,
    RUN_SCRIPT_PATH: runScriptPath,
    RUN_SMOKE_COMMAND: runScriptArg + ' smoke',
    RUN_SMOKE_ITERATIONS_COMMAND: runScriptArg + ' smoke --vus 1 --iterations 1',
    RUN_SMOKE_LOG_COMMAND: runScriptArg + ' smoke --log',
    RUN_SMOKE_REPORT_COMMAND: runScriptArg + ' smoke --report --duration 10s --vus 1',
    RUN_SMOKE_TRACE_REPORT_COMMAND: runScriptArg + ' smoke --trace --log --report --duration 10s --vus 1',
    SCENARIO_PATH: scenarioPath,
    SCENARIO_TEMPLATE_PATH: scenarioTemplatePath,
    SNAPSHOT_PATH: snapshotPath,
    SYNC_COMMAND: syncCommand,
    TEST_NAME_COMMAND: testNameCommand,
    TEST_SMOKE_COMMAND: testSmokeCommand,
    TEST_WORKFLOW_COMMAND: testWorkflowCommand,
    WORKFLOW_OUTPUT_PATH: workflowOutputPath,
    WORKFLOW_SCENARIO_PATH: workflowScenarioPath,
  });
}

function renderReadmeTemplate(values: Record<string, string>): string {
  return README_TEMPLATE.replace(/__([A-Z0-9_]+)__/g, (match, key: string) => {
    const value = values[key];

    if (value === undefined) {
      throw new InitLoadTestsError('README template variable is not defined: ' + match);
    }

    return value;
  }).trimEnd() + '\n';
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
