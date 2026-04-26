import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('README usage guide', () => {
  it('documents the complete target project workflow', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('## 설치');
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
    expect(readme).toContain('modules:');
    expect(readme).toContain('openapi-k6 init \\');
    expect(readme).toContain('--smoke-path /__dev/error-codes');
    expect(readme).toContain('openapi-k6 sync \\');
    expect(readme).toContain('--config load-tests/config.yaml');
    expect(readme).toContain('--module pharma');
    expect(readme).toContain('openapi-k6 generate \\');
    expect(readme).toContain('--config load-tests/config.yaml');
    expect(readme).toContain('--scenario load-tests/scenarios/smoke.yaml');
    expect(readme).toContain('--write load-tests/generated/smoke.k6.js');
    expect(readme).toContain('k6 run load-tests/generated/smoke.k6.js');
    expect(readme).toContain('condition`은 흐름 분기가 아니라 k6 `check`');
  });
});
