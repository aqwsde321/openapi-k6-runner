import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('README usage guide', () => {
  it('documents the root entrypoint and delegates detailed work to generated README', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('## 용도');
    expect(readme).toContain('## 핵심 흐름');
    expect(readme).toContain('scenario test로 API 흐름 검증');
    expect(readme).toContain('`openapi-k6 test`는 보조 명령이 아니라 k6 실행 전 필수 확인 단계입니다.');
    expect(readme).toContain('## 빠른 시작');
    expect(readme).toContain('npx --yes openapi-k6 init');
    expect(readme).toContain('npx --yes openapi-k6 sync');
    expect(readme).toContain('npx --yes openapi-k6 test -s smoke');
    expect(readme).toContain('npx --yes openapi-k6 generate -s smoke');
    expect(readme).toContain('pnpm add -D openapi-k6');
    expect(readme).toContain('[도구 개발/유지보수](docs/03-maintainer-notes.md)');
    expect(readme).toContain('## 백엔드 프로젝트에 추가하기');
    expect(readme).toContain('load-tests/run.sh');
    expect(readme).toContain('`--force`는 `config.yaml`, `.env.example`, `.gitignore`, `run.sh`, `scenarios/smoke.yaml`, `README.md`만 다시 씁니다.');
    expect(readme).toContain('## 다음 단계는 AI에게 맡기기');
    expect(readme).toContain('## 생성 후 구조');
    expect(readme).toContain('Read load-tests/README.md first and follow it.');
    expect(readme).toContain('Fill TODO values in load-tests/config.yaml for this backend project.');
    expect(readme).toContain('Run the OpenAPI snapshot command from load-tests/README.md to create the catalog.');
    expect(readme).toContain('Run the scenario validation command from load-tests/README.md before generating k6.');
    expect(readme).toContain('Do not generate or run k6 until the scenario validation passes.');
    expect(readme).toContain('Create load-tests/scenarios/basic-read.yaml');
    expect(readme).toContain('Validate the scenario using the command documented in load-tests/README.md.');
    expect(readme).toContain('Use Bearer {{token}} in the Authorization header of the next step.');
    expect(readme).toContain('Keep human-facing documentation in Korean. Keep AI instruction sections in English.');
    expect(readme).toContain('루트 README는 여기까지만 안내합니다.');
    expect(readme).toContain('## 알아둘 점');
    expect(readme).toContain('`sync`는 외부 파일이나 URL을 가리키는 `$ref`를 snapshot 내부 참조로 묶어 저장합니다.');
    expect(readme).toContain('`npx --yes openapi-k6 test -s <scenario>`는 k6 파일을 만들기 전에 scenario YAML을 Node.js에서 1회 직접 실행해 API 흐름을 검증하는 gate입니다.');
    expect(readme).toContain('`pathParams` 값은 URL path segment로 encode되어');
    expect(readme.indexOf('## 다음 단계는 AI에게 맡기기')).toBeGreaterThan(readme.indexOf('## 백엔드 프로젝트에 추가하기'));
  });
});
