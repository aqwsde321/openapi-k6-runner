import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readUiScenarioStepSources } from '../src/cli/ui/scenario-files.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => (
    fs.rm(workspace, { recursive: true, force: true })
  )));
});

describe('UI scenario files', () => {
  it('keeps the full scenario lineage while preserving flat endpoint order', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'openapi-k6-ui-lineage-'));
    workspaces.push(workspace);
    await fs.mkdir(path.join(workspace, 'flow'), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(workspace, 'root.yaml'), [
        'name: root',
        'steps:',
        '  - use: flow/middle',
        '  - id: root-step',
        '    api:',
        '      operationId: rootStep',
      ].join('\n')),
      fs.writeFile(path.join(workspace, 'flow/middle.yaml'), [
        'name: middle',
        'steps:',
        '  - use: flow/leaf',
        '  - include: ./partial.yaml',
        '  - id: middle-step',
        '    api:',
        '      operationId: middleStep',
      ].join('\n')),
      fs.writeFile(path.join(workspace, 'flow/leaf.yaml'), [
        'name: leaf',
        'steps:',
        '  - id: leaf-step',
        '    api:',
        '      operationId: leafStep',
      ].join('\n')),
      fs.writeFile(path.join(workspace, 'flow/partial.yaml'), [
        'steps:',
        '  - id: partial-step',
        '    api:',
        '      operationId: partialStep',
      ].join('\n')),
    ]);

    await expect(readUiScenarioStepSources({
      resolveScenarioPath: (value) => path.join(workspace, `${value}.yaml`),
      formatDisplayPath: (filePath) => path.relative(workspace, filePath),
    }, path.join(workspace, 'root.yaml'))).resolves.toEqual([
      {
        kind: 'use',
        reference: 'flow/middle',
        lineage: [
          { kind: 'use', reference: 'flow/middle' },
          { kind: 'use', reference: 'flow/leaf' },
        ],
      },
      {
        kind: 'use',
        reference: 'flow/middle',
        lineage: [
          { kind: 'use', reference: 'flow/middle' },
          { kind: 'include', reference: './partial.yaml' },
        ],
      },
      { kind: 'use', reference: 'flow/middle' },
      { kind: 'direct' },
    ]);
  });
});
