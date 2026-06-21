import type { DoctorResult } from './index.js';
import {
  formatDisplayPath,
  initStatusSymbol,
  writeLine,
  type WritableLike,
} from './display.js';
import { DEFAULT_LOAD_TEST_DIR } from './workspace-paths.js';

const DEFAULT_CONFIG_PATH = `${DEFAULT_LOAD_TEST_DIR}/config.yaml`;

export function writeDoctorOutput(
  stdout: WritableLike,
  result: DoctorResult,
  cwd: string,
  json: boolean | undefined,
): void {
  if (json === true) {
    writeLine(stdout, JSON.stringify(result, null, 2));
    return;
  }

  writeLine(stdout, `Doctor ${formatDisplayPath(cwd, result.configPath ?? DEFAULT_CONFIG_PATH)}`);

  for (const check of result.checks) {
    const status = check.status === 'pass'
      ? 'success'
      : check.status === 'fail'
        ? 'failure'
        : 'warning';
    writeLine(stdout, `  ${initStatusSymbol(stdout, status)} ${check.name}: ${check.message}`);
  }
}
