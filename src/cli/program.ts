import { Command, CommanderError } from 'commander';
import path from 'node:path';

import {
  CURRENT_SCAFFOLD_VERSION,
} from '../scaffold/load-test.init.js';
import {
  writeCatalogOutput,
} from './catalog.js';
import {
  runCatalogCommand,
  runSyncCommand,
} from './catalog-command.js';
import { runDoctorCommand } from './doctor-command.js';
import { writeDoctorOutput } from './doctor-output.js';
import {
  writeLine,
} from './display.js';
import {
  runModuleAddCommand,
  runModuleListCommand,
  runModuleRemoveCommand,
  runModuleSetDefaultCommand,
} from './module-command.js';
import {
  writeModuleAddSummary,
  writeModuleListOutput,
  writeModuleRemoveSummary,
  writeModuleSetDefaultSummary,
} from './module-output.js';
import {
  runGenerateCommand,
  runRunCommand,
  runSuiteTestCommand,
  runTestCommand,
  runValidateCommand,
} from './scenario-command.js';
import {
  writeScaffoldUpdateNotice,
  writeSuiteTestSummary,
  writeValidateSummary,
  writeValidationWarnings,
} from './scenario-output.js';
import { createScenarioConsoleReporter } from './test.reporter.js';
import type {
  CatalogOptions,
  CatalogResult,
  CliContext,
  DoctorOptions,
  DoctorResult,
  GenerateOptions,
  GenerateResult,
  InitOptions,
  InitResult,
  InstallSkillOptions,
  InstallSkillResult,
  ModuleAddOptions,
  ModuleAddResult,
  ModuleListOptions,
  ModuleListResult,
  ModuleRemoveOptions,
  ModuleRemoveResult,
  ModuleSetDefaultOptions,
  ModuleSetDefaultResult,
  RunOptions,
  RunResult,
  SuiteTestOptions,
  SuiteTestResult,
  SyncOptions,
  SyncResult,
  TestCommandOptions,
  TestOptions,
  TestResult,
  UiOptions,
  UiResult,
  UpdateOptions,
  UpdateResult,
  ValidateOptions,
  ValidateResult,
} from './types.js';
import { runUiServerCommand } from './ui/server.js';
import {
  DEFAULT_LOAD_TEST_DIR,
} from './workspace-paths.js';
import {
  runInitCommand,
  runInstallSkillCommand,
  runUpdateCommand,
} from './workspace-command.js';
import {
  writeInitSummary,
  writeInstallSkillSummary,
  writeSyncSummary,
  writeUpdateSummary,
} from './workspace-output.js';

type WritableLike = {
  write(chunk: string): unknown;
  isTTY?: boolean;
};

export interface CliProgramDeps {
  cliVersion: string;
  defaultLoadTestDir: string;
  defaultConfigPath: string;
  codexSkillName: string;
  resolveCwd(context: CliContext): string;
  runInitCommand(options: InitOptions, context: CliContext): Promise<InitResult>;
  writeInitSummary(stdout: WritableLike, result: InitResult, options: InitOptions, cwd: string): void;
  runUpdateCommand(options: UpdateOptions, context: CliContext): Promise<UpdateResult>;
  writeUpdateSummary(stdout: WritableLike, result: UpdateResult, cwd: string): void;
  runInstallSkillCommand(options: InstallSkillOptions, context: CliContext): Promise<InstallSkillResult>;
  writeInstallSkillSummary(stdout: WritableLike, result: InstallSkillResult, cwd: string): void;
  runDoctorCommand(options: DoctorOptions, context: CliContext): Promise<DoctorResult>;
  writeDoctorOutput(stdout: WritableLike, result: DoctorResult, cwd: string, json: boolean | undefined): void;
  runUiCommand(options: UiOptions, context: CliContext): Promise<UiResult>;
  runGenerateCommand(options: GenerateOptions, context: CliContext): Promise<GenerateResult>;
  writeValidationWarnings(stdout: WritableLike, warnings: string[]): void;
  writeScaffoldUpdateNotice(stdout: WritableLike, warnings: string[], command: string | undefined): void;
  writeLine(stdout: WritableLike, message: string): void;
  runRunCommand(options: RunOptions, context: CliContext): Promise<RunResult>;
  runSyncCommand(options: SyncOptions, context: CliContext): Promise<SyncResult>;
  writeSyncSummary(stdout: WritableLike, result: SyncResult, options: SyncOptions, cwd: string): void;
  runCatalogCommand(options: CatalogOptions, context: CliContext): Promise<CatalogResult>;
  writeCatalogOutput(stdout: WritableLike, result: CatalogResult, cwd: string, options: Pick<CatalogOptions, 'ai' | 'json' | 'snippet'>): void;
  runModuleListCommand(options: ModuleListOptions, context: CliContext): Promise<ModuleListResult>;
  writeModuleListOutput(stdout: WritableLike, result: ModuleListResult, cwd: string, json: boolean | undefined): void;
  runModuleAddCommand(options: ModuleAddOptions, context: CliContext): Promise<ModuleAddResult>;
  writeModuleAddSummary(stdout: WritableLike, result: ModuleAddResult, cwd: string): void;
  runModuleSetDefaultCommand(options: ModuleSetDefaultOptions, context: CliContext): Promise<ModuleSetDefaultResult>;
  writeModuleSetDefaultSummary(stdout: WritableLike, result: ModuleSetDefaultResult, cwd: string): void;
  runModuleRemoveCommand(options: ModuleRemoveOptions, context: CliContext): Promise<ModuleRemoveResult>;
  writeModuleRemoveSummary(stdout: WritableLike, result: ModuleRemoveResult, cwd: string): void;
  runValidateCommand(options: ValidateOptions, context: CliContext): Promise<ValidateResult>;
  writeValidateSummary(stdout: WritableLike, result: ValidateResult, cwd: string): void;
  shouldUseColor(stream: WritableLike, env: Record<string, string | undefined>, colorOption: boolean | undefined): boolean;
  shouldUseLiveOutput(stream: WritableLike, env: Record<string, string | undefined>): boolean;
  collectRepeatedOption(value: string, previous: string[] | undefined): string[];
  runTestCommand(options: TestOptions, context: CliContext): Promise<TestResult>;
  runSuiteTestCommand(options: SuiteTestOptions, context: CliContext): Promise<SuiteTestResult>;
  writeSuiteTestSummary(stdout: WritableLike, result: SuiteTestResult, cwd: string): void;
}

const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;
const CLI_VERSION = CURRENT_SCAFFOLD_VERSION;
const CODEX_SKILL_NAME = 'openapi-k6-scenario';

function resolveCwd(context: CliContext): string {
  return context.cwd ? path.resolve(context.cwd) : process.cwd();
}

export async function runUiCommand(
  options: UiOptions,
  context: CliContext = {},
): Promise<UiResult> {
  return runUiServerCommand(options, context, { runCli });
}

function shouldUseColor(
  stream: WritableLike,
  env: Record<string, string | undefined>,
  colorOption: boolean | undefined,
): boolean {
  if (colorOption === false) {
    return false;
  }

  if (env.NO_COLOR !== undefined || env.TERM === 'dumb') {
    return false;
  }

  return stream.isTTY === true;
}

function shouldUseLiveOutput(
  stream: WritableLike,
  env: Record<string, string | undefined>,
): boolean {
  if (env.TERM === 'dumb') {
    return false;
  }

  return stream.isTTY === true;
}

function collectRepeatedOption(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function parsePositiveIntegerOption(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CommanderError(1, 'openapi-k6.invalid-option', `--iterations must be a positive integer: ${JSON.stringify(value)}`);
  }

  return parsed;
}

export function createProgram(context: CliContext = {}): Command {
  return createCliProgram(context, {
    cliVersion: CLI_VERSION,
    defaultLoadTestDir: DEFAULT_LOAD_TEST_DIR,
    defaultConfigPath: DEFAULT_CONFIG_PATH,
    codexSkillName: CODEX_SKILL_NAME,
    resolveCwd,
    runInitCommand,
    writeInitSummary,
    runUpdateCommand,
    writeUpdateSummary,
    runInstallSkillCommand,
    writeInstallSkillSummary,
    runDoctorCommand,
    writeDoctorOutput,
    runUiCommand,
    runGenerateCommand,
    writeValidationWarnings,
    writeScaffoldUpdateNotice,
    writeLine,
    runRunCommand,
    runSyncCommand,
    writeSyncSummary,
    runCatalogCommand,
    writeCatalogOutput,
    runModuleListCommand,
    writeModuleListOutput,
    runModuleAddCommand,
    writeModuleAddSummary,
    runModuleSetDefaultCommand,
    writeModuleSetDefaultSummary,
    runModuleRemoveCommand,
    writeModuleRemoveSummary,
    runValidateCommand,
    writeValidateSummary,
    shouldUseColor,
    shouldUseLiveOutput,
    collectRepeatedOption,
    runTestCommand,
    runSuiteTestCommand,
    writeSuiteTestSummary,
  });
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  context: CliContext = {},
): Promise<void> {
  const program = createProgram(context);
  await program.parseAsync(argv, { from: 'user' });
}

export function createCliProgram(context: CliContext = {}, deps: CliProgramDeps): Command {
  const {
    cliVersion: CLI_VERSION,
    defaultLoadTestDir: DEFAULT_LOAD_TEST_DIR,
    defaultConfigPath: DEFAULT_CONFIG_PATH,
    codexSkillName: CODEX_SKILL_NAME,
    resolveCwd,
    runInitCommand,
    writeInitSummary,
    runUpdateCommand,
    writeUpdateSummary,
    runInstallSkillCommand,
    writeInstallSkillSummary,
    runDoctorCommand,
    writeDoctorOutput,
    runUiCommand,
    runGenerateCommand,
    writeValidationWarnings,
    writeScaffoldUpdateNotice,
    writeLine,
    runRunCommand,
    runSyncCommand,
    writeSyncSummary,
    runCatalogCommand,
    writeCatalogOutput,
    runModuleListCommand,
    writeModuleListOutput,
    runModuleAddCommand,
    writeModuleAddSummary,
    runModuleSetDefaultCommand,
    writeModuleSetDefaultSummary,
    runModuleRemoveCommand,
    writeModuleRemoveSummary,
    runValidateCommand,
    writeValidateSummary,
    shouldUseColor,
    shouldUseLiveOutput,
    collectRepeatedOption,
    runTestCommand,
    runSuiteTestCommand,
    writeSuiteTestSummary,
  } = deps;
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const program = new Command();

  program
    .name('openapi-k6')
    .description('Generate k6 scripts from OpenAPI specs and Scenario DSL files.')
    .version(CLI_VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (value) => stdout.write(value),
      writeErr: (value) => stderr.write(value),
    });

  program
    .command('init')
    .description('Create an openapi-k6 workspace in the target project.')
    .option('--dir <path>', 'openapi-k6 workspace directory path', DEFAULT_LOAD_TEST_DIR)
    .option('-m, --module <name>', 'Initial module name', 'default')
    .option('--base-url <url>', 'API base URL for generated k6 scripts')
    .option('--openapi <path-or-url>', 'OpenAPI spec file path or URL')
    .option('--smoke-path <path>', 'Smoke scenario GET endpoint path', '/health')
    .option('--force', 'Overwrite existing scaffold files')
    .option('--sync', 'Run sync after creating the scaffold')
    .option('--no-input', 'Do not prompt for missing init values')
    .action(async (options: InitOptions) => {
      const result = await runInitCommand(options, context);
      writeInitSummary(stdout, result, options, resolveCwd(context));
    });

  program
    .command('update')
    .description('Update existing openapi-k6 workspace files without touching config or scenarios.')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .action(async (options: UpdateOptions) => {
      const result = await runUpdateCommand(options, context);
      writeUpdateSummary(stdout, result, resolveCwd(context));
    });

  program
    .command('install-skill')
    .description('Install the bundled openapi-k6 Codex skill.')
    .option('--agent <agent>', 'Agent to install for (currently only codex)', 'codex')
    .option('--target-dir <path>', `Install to a custom skill directory instead of ~/.codex/skills/${CODEX_SKILL_NAME}`)
    .option('--force', 'Replace an existing installed skill')
    .option('--dry-run', 'Print source and target paths without writing files')
    .option('--yes', 'Accepted for agent-driven flows; install-skill does not prompt')
    .action(async (options: InstallSkillOptions) => {
      const result = await runInstallSkillCommand(options, context);
      writeInstallSkillSummary(stdout, result, resolveCwd(context));
    });

  program
    .command('doctor')
    .description('Check config, snapshots, catalogs, scaffold metadata, module env names, and k6 availability.')
    .option('--config <path>', 'Load test config file path')
    .option('--json', 'Print JSON output')
    .action(async (options: DoctorOptions) => {
      const result = await runDoctorCommand(options, context);
      writeDoctorOutput(stdout, result, resolveCwd(context), options.json);

      if (!result.passed) {
        throw new CommanderError(1, 'openapi-k6.doctor.failed', 'Doctor checks failed');
      }
    });

  program
    .command('ui')
    .description('Start a local web UI for selecting scenarios and running validate/test.')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--host <host>', 'Host to bind (defaults to 127.0.0.1)')
    .option('--port <port>', 'Port to bind (defaults to 3766 and tries nearby ports)')
    .option('--show-sensitive-values', 'Show unmasked request, response, YAML, and log values')
    .action(async (options: UiOptions) => {
      await runUiCommand(options, context);
    });

  program
    .command('generate')
    .description('Generate a k6 script for the configured scenario.')
    .requiredOption('-s, --scenario <path-or-key>', 'Scenario DSL file path or openapi-k6 scenario key')
    .option('-o, --openapi <path>', 'OpenAPI spec file path')
    .option('-w, --write <path>', `Output k6 script path (defaults to ${DEFAULT_LOAD_TEST_DIR}/generated/<scenario-key>.k6.js)`)
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--var-file <path>', 'Load scenario vars from a YAML object file; repeatable', collectRepeatedOption)
    .option('--var <name=value>', 'Override one scenario var; repeatable and parsed as a YAML value', collectRepeatedOption)
    .action(async (options: GenerateOptions) => {
      const result = await runGenerateCommand(options, context);
      writeValidationWarnings(stdout, result.warnings);
      writeScaffoldUpdateNotice(stdout, result.scaffoldWarnings ?? [], result.scaffoldUpdateCommand);
      writeLine(stdout, `Generated ${result.outputPath}`);
    });

  program
    .command('run')
    .description('Validate, generate, and run a scenario with k6.')
    .requiredOption('-s, --scenario <path-or-key>', 'Scenario DSL file path or openapi-k6 scenario key')
    .option('-w, --write <path>', `Output k6 script path (defaults to ${DEFAULT_LOAD_TEST_DIR}/generated/<scenario-key>.k6.js)`)
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--var-file <path>', 'Load scenario vars from a YAML object file; repeatable', collectRepeatedOption)
    .option('--var <name=value>', 'Override one scenario var; repeatable and parsed as a YAML value', collectRepeatedOption)
    .option('--log', `Save k6 output to ${DEFAULT_LOAD_TEST_DIR}/logs/<scenario-key>.log`)
    .option('--trace', 'Print OpenAPI step start/end logs from the generated k6 script')
    .option('--report', `Export k6 Web Dashboard HTML to ${DEFAULT_LOAD_TEST_DIR}/logs/<scenario-key>-report.html`)
    .option('--open-dashboard', 'Open the k6 Web Dashboard while the test is running')
    .argument('[k6Args...]', 'k6 run options after --')
    .action(async (k6Args: string[], options: RunOptions) => {
      const result = await runRunCommand({ ...options, k6Args }, context);

      if (result.exitCode !== 0 || result.signal !== null) {
        throw new CommanderError(
          result.exitCode ?? 1,
          'openapi-k6.k6.failed',
          result.signal === null ? 'k6 run failed' : `k6 run failed with signal ${result.signal}`,
        );
      }
    });

  program
    .command('sync')
    .description('Write an OpenAPI snapshot and endpoint catalog.')
    .option('-o, --openapi <path-or-url>', 'OpenAPI spec file path or URL')
    .option('-w, --write <path>', 'Output OpenAPI snapshot path')
    .option('-c, --catalog <path>', 'Output endpoint catalog path')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .action(async (options: SyncOptions) => {
      const result = await runSyncCommand(options, context);
      writeSyncSummary(stdout, result, options, resolveCwd(context));
    });

  program
    .command('catalog')
    .description('Search the configured endpoint catalog for scenario YAML authoring.')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('-q, --query <text>', 'Search operationId, path, tags, summary, description, or parameters')
    .option('--method <method>', 'Filter by HTTP method')
    .option('--tag <tag>', 'Filter by exact tag')
    .option('--all', 'List all operations instead of only the summary')
    .option('--sync', 'Run sync before reading the catalog')
    .option('--ai', 'Print AI-friendly scenario authoring guidance')
    .option('--snippet', 'Print scenario YAML step snippets')
    .option('--json', 'Print JSON output')
    .action(async (options: CatalogOptions) => {
      const result = await runCatalogCommand(options, context);
      writeCatalogOutput(stdout, result, resolveCwd(context), options);
    });

  const moduleCommand = program
    .command('module')
    .description(`Manage OpenAPI modules in ${DEFAULT_CONFIG_PATH}.`);

  moduleCommand
    .command('list')
    .description('List configured OpenAPI modules.')
    .option('--config <path>', 'Load test config file path')
    .option('--json', 'Print JSON output')
    .action(async (options: ModuleListOptions) => {
      const result = await runModuleListCommand(options, context);
      writeModuleListOutput(stdout, result, resolveCwd(context), options.json);
    });

  moduleCommand
    .command('add')
    .description('Add or update an OpenAPI module in config.')
    .argument('<name>', 'Module name')
    .option('-o, --openapi <path-or-url>', 'OpenAPI spec file path or URL; auto-discovered from --base-url when omitted')
    .option('--base-url <url>', 'Module-specific API base URL')
    .option('--snapshot <path>', 'OpenAPI snapshot path in config')
    .option('--catalog <path>', 'Endpoint catalog path in config')
    .option('--set-default', 'Set this module as defaultModule')
    .option('--sync', 'Create snapshot and catalog before saving config')
    .option('--force', 'Update an existing module')
    .option('--config <path>', 'Load test config file path')
    .action(async (name: string, options: Omit<ModuleAddOptions, 'name'>) => {
      const result = await runModuleAddCommand({ ...options, name }, context);
      writeModuleAddSummary(stdout, result, resolveCwd(context));
    });

  moduleCommand
    .command('set-default')
    .description('Set defaultModule in config.')
    .argument('<name>', 'Module name')
    .option('--config <path>', 'Load test config file path')
    .action(async (name: string, options: Omit<ModuleSetDefaultOptions, 'name'>) => {
      const result = await runModuleSetDefaultCommand({ ...options, name }, context);
      writeModuleSetDefaultSummary(stdout, result, resolveCwd(context));
    });

  moduleCommand
    .command('remove')
    .description('Remove an OpenAPI module from config without deleting snapshot or catalog files.')
    .argument('<name>', 'Module name')
    .option('--config <path>', 'Load test config file path')
    .option('--force', 'Remove even if the module is defaultModule or referenced by scenarios')
    .action(async (name: string, options: Omit<ModuleRemoveOptions, 'name'>) => {
      const result = await runModuleRemoveCommand({ ...options, name }, context);
      writeModuleRemoveSummary(stdout, result, resolveCwd(context));
    });

  program
    .command('validate')
    .description('Validate a scenario YAML against the configured OpenAPI snapshot without calling the API.')
    .requiredOption('-s, --scenario <path-or-key>', 'Scenario DSL file path or openapi-k6 scenario key')
    .option('-o, --openapi <path>', 'OpenAPI spec file path')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--var-file <path>', 'Load scenario vars from a YAML object file; repeatable', collectRepeatedOption)
    .option('--var <name=value>', 'Override one scenario var; repeatable and parsed as a YAML value', collectRepeatedOption)
    .action(async (options: ValidateOptions) => {
      const result = await runValidateCommand(options, context);
      writeValidateSummary(stdout, result, resolveCwd(context));
    });

  program
    .command('test')
    .description('Run a scenario once with Node.js to validate API flow before generating k6.')
    .option('-s, --scenario <path-or-key>', 'Scenario DSL file path or openapi-k6 scenario key')
    .option('--suite <path-or-key>', 'Suite YAML file path or openapi-k6 suite key')
    .option('--config <path>', 'Load test config file path')
    .option('-m, --module <name>', 'Module name from config')
    .option('--var-file <path>', 'Load scenario vars from a YAML object file; repeatable', collectRepeatedOption)
    .option('--var <name=value>', 'Override one scenario var; repeatable and parsed as a YAML value', collectRepeatedOption)
    .option('--iterations <count>', 'Run the Node.js API-flow test this many times', parsePositiveIntegerOption)
    .option('--no-color', 'Disable ANSI color output')
    .action(async (options: TestCommandOptions) => {
      const hasScenario = options.scenario !== undefined;
      const hasSuite = options.suite !== undefined;

      if (hasScenario === hasSuite) {
        throw new CommanderError(1, 'openapi-k6.invalid-option', 'Specify exactly one of --scenario or --suite');
      }

      const colorEnv = context.env ?? process.env;
      const testReporter = context.testReporter ?? createScenarioConsoleReporter(stdout, {
        color: shouldUseColor(stdout, colorEnv, options.color),
        live: shouldUseLiveOutput(stdout, colorEnv),
      });

      if (options.suite !== undefined) {
        const result = await runSuiteTestCommand({
          suite: options.suite,
          ...(options.config === undefined ? {} : { config: options.config }),
          ...(options.module === undefined ? {} : { module: options.module }),
          ...(options.color === undefined ? {} : { color: options.color }),
          ...(options.iterations === undefined ? {} : { iterations: options.iterations }),
          ...(options.varFile === undefined ? {} : { varFile: options.varFile }),
          ...(options.var === undefined ? {} : { var: options.var }),
        }, {
          ...context,
          testReporter,
        });

        writeSuiteTestSummary(stdout, result, resolveCwd(context));
        writeScaffoldUpdateNotice(stdout, result.scaffoldWarnings ?? [], result.scaffoldUpdateCommand);

        if (!result.passed) {
          throw new CommanderError(1, 'openapi-k6.suite-test.failed', 'Suite test failed');
        }

        return;
      }

      if (options.scenario === undefined) {
        throw new CommanderError(1, 'openapi-k6.invalid-option', 'Specify exactly one of --scenario or --suite');
      }

      const result = await runTestCommand({
        scenario: options.scenario,
        ...(options.config === undefined ? {} : { config: options.config }),
        ...(options.module === undefined ? {} : { module: options.module }),
        ...(options.color === undefined ? {} : { color: options.color }),
        ...(options.iterations === undefined ? {} : { iterations: options.iterations }),
        ...(options.varFile === undefined ? {} : { varFile: options.varFile }),
        ...(options.var === undefined ? {} : { var: options.var }),
      }, {
        ...context,
        testReporter,
      });
      writeScaffoldUpdateNotice(stdout, result.scaffoldWarnings ?? [], result.scaffoldUpdateCommand);

      if (!result.passed) {
        throw new CommanderError(1, 'openapi-k6.test.failed', 'Scenario test failed');
      }
    });

  return program;
}
