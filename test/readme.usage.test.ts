import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('README usage guide', () => {
  it('documents the complete target project workflow', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('## 설치');
    expect(readme).toContain('pnpm run build');
    expect(readme).toContain('pnpm link --global');
    expect(readme).toContain('<summary>`pnpm link --global`에서 global bin directory 오류가 날 때</summary>');
    expect(readme).toContain('pnpm setup');
    expect(readme).toContain('node /path/to/openapi-k6-runner/dist/cli/index.js --help');
    expect(readme).toContain('## 빠른 시작');
    expect(readme).toContain('## 사용 위치');
    expect(readme).toContain('## Config');
    expect(readme).toContain('## OpenAPI Snapshot');
    expect(readme).toContain('## OpenAPI 예시');
    expect(readme).toContain('## Scenario 예시');
    expect(readme).toContain('## k6 Script 생성');
    expect(readme).toContain('## k6 실행');
    expect(readme).toContain('baseUrl: https://dev-api.example.com');
    expect(readme).toContain('defaultModule: pharma');
    expect(readme).toContain('baseUrl: TODO');
    expect(readme).toContain('openapi: TODO');
    expect(readme).toContain('modules:');
    expect(readme).toContain('openapi-k6 init');
    expect(readme).toContain('path: /__dev/error-codes');
    expect(readme).toContain('openapi-k6 sync');
    expect(readme).toContain('openapi-k6 generate -s smoke');
    expect(readme).toContain('k6 run load-tests/generated/smoke.k6.js');
    expect(readme).toContain('{{env.LOGIN_PASSWORD}}');
    expect(readme).toContain('source load-tests/.env');
    expect(readme).toContain('condition`은 흐름 분기가 아니라 k6 `check`');
    expect(readme).toContain('## AI Agent Instructions');
    expect(readme).toContain('Read load-tests/README.md first and follow it.');
    expect(readme).toContain('openapi-k6 generate -s basic-read');
    expect(readme).toContain('Use Bearer {{token}} in the Authorization header of the next step.');
    expect(readme.indexOf('## AI Agent Instructions')).toBeGreaterThan(readme.indexOf('## 문서'));
  });
});
