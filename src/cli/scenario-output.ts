import { writeLine, type WritableLike } from './display.js';

export function writeValidationWarnings(stdout: WritableLike, warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  writeLine(stdout, 'Warnings:');

  for (const warning of warnings) {
    writeLine(stdout, `  - ${warning}`);
  }

  writeLine(stdout, '');
}

export function writeScaffoldUpdateNotice(
  stdout: WritableLike,
  warnings: string[],
  updateCommand: string | undefined,
): void {
  if (warnings.length === 0) {
    return;
  }

  writeLine(stdout, 'Scaffold update available:');

  for (const warning of warnings) {
    writeLine(stdout, `  reason   ${warning}`);
  }

  if (updateCommand !== undefined) {
    writeLine(stdout, `  command  ${updateCommand}`);
  }

  writeLine(stdout, '  keeps    config, scenarios, .env, snapshots, generated scripts, and logs unchanged');
  writeLine(stdout, '');
}
