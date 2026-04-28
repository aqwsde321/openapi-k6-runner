import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('README usage guide', () => {
  it('documents the root entrypoint and delegates detailed work to generated README', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('## 용도');
    expect(readme).toContain('## 설치');
    expect(readme).toContain('pnpm run build');
    expect(readme).toContain('로컬 코드만 수정했을 때:');
    expect(readme).toContain('generator 저장소를 pull/checkout해서 새 버전으로 업데이트했을 때:');
    expect(readme).toContain('pnpm run build:watch');
    expect(readme).toContain('새 버전으로 업데이트한 뒤에는 watch를 다시 시작하는 편이 안전합니다.');
    expect(readme).toContain('pnpm link --global');
    expect(readme).toContain('<summary>`pnpm link --global`에서 global bin directory 오류가 날 때</summary>');
    expect(readme).toContain('pnpm setup');
    expect(readme).toContain('node /path/to/openapi-k6-runner/dist/cli/index.js --help');
    expect(readme).toContain('## 백엔드 프로젝트에 추가하기');
    expect(readme).toContain('openapi-k6 init');
    expect(readme).toContain('load-tests/run.sh');
    expect(readme).toContain('`--force`는 `config.yaml`, `.env.example`, `.gitignore`, `run.sh`, `scenarios/smoke.yaml`, `README.md`만 다시 씁니다.');
    expect(readme).toContain('## 다음 단계는 AI에게 맡기기');
    expect(readme).toContain('## 생성 후 구조');
    expect(readme).toContain('Read load-tests/README.md first and follow it.');
    expect(readme).toContain('Fill TODO values in load-tests/config.yaml for this backend project.');
    expect(readme).toContain('Run the OpenAPI snapshot command from load-tests/README.md to create the catalog.');
    expect(readme).toContain('Run the scenario validation command from load-tests/README.md.');
    expect(readme).toContain('Create load-tests/scenarios/basic-read.yaml');
    expect(readme).toContain('Validate the scenario using the command documented in load-tests/README.md.');
    expect(readme).toContain('Use Bearer {{token}} in the Authorization header of the next step.');
    expect(readme).toContain('Keep human-facing documentation in Korean. Keep AI instruction sections in English.');
    expect(readme).toContain('루트 README는 여기까지만 안내합니다.');
    expect(readme).toContain('## 알아둘 점');
    expect(readme).toContain('`sync`는 외부 파일이나 URL을 가리키는 `$ref`를 snapshot 내부 참조로 묶어 저장합니다.');
    expect(readme).toContain('`openapi-k6 test -s <scenario>`는 k6 파일을 만들기 전에 scenario YAML을 Node.js에서 1회 직접 실행해 API 흐름을 검증합니다.');
    expect(readme).toContain('`pathParams` 값은 URL path segment로 encode되어');
    expect(readme).toContain('pnpm run typecheck');
    expect(readme.indexOf('## 다음 단계는 AI에게 맡기기')).toBeGreaterThan(readme.indexOf('## 백엔드 프로젝트에 추가하기'));
  });
});
