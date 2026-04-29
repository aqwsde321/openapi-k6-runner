import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('README usage guide', () => {
  it('documents the root entrypoint and delegates detailed work to generated README', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('## 핵심 흐름');
    expect(readme).toContain('scenario test로 실제 API 흐름 검증');
    expect(readme).toContain('`openapi-k6 test`는 보조 명령이 아니라 k6 실행 전 필수 gate입니다.');
    expect(readme).toContain('## 빠른 시작');
    expect(readme).toContain('테스트를 추가할 백엔드 프로젝트 루트 터미널에서 바로 실행합니다.');
    expect(readme).toContain('npx --yes openapi-k6 init');
    expect(readme).not.toContain('cd /path/to/backend-project');
    expect(readme).toContain('npx --yes openapi-k6 sync');
    expect(readme).toContain('npx --yes openapi-k6 test -s smoke');
    expect(readme).toContain('npx --yes openapi-k6 generate -s smoke');
    expect(readme).toContain('pnpm add -D openapi-k6');
    expect(readme).toContain('[도구 개발/유지보수](docs/03-maintainer-notes.md)');
    expect(readme).not.toContain('## 백엔드 프로젝트에 추가하기');
    expect(readme).toContain('## 생성되는 작업 공간');
    expect(readme).toContain('load-tests/run.sh');
    expect(readme).toContain('`--force`는 scaffold 관리 파일만 다시 쓰고');
    expect(readme).toContain('## AI에게 맡기기');
    expect(readme).toContain('생성된 `load-tests/README.md`의 "AI에게 작업 맡기기" 섹션을 AI coding agent에게 붙여넣으세요.');
    expect(readme).toContain('실제 작업 프롬프트는 init 시 선택한 디렉터리와 명령이 반영된 생성 README를 기준으로 합니다.');
    expect(readme).not.toContain('이 백엔드 프로젝트에 openapi-k6 시나리오 테스트와 k6 부하 테스트 준비를 적용해줘.');
    expect(readme).toContain('## 알아둘 점');
    expect(readme).toContain('`sync`는 외부 파일이나 URL을 가리키는 `$ref`를 snapshot 내부 참조로 묶어 저장합니다.');
    expect(readme).toContain('`npx --yes openapi-k6 test -s <scenario>`는 k6 파일을 만들기 전에 scenario YAML을 Node.js에서 1회 직접 실행해 API 흐름을 검증합니다.');
    expect(readme).toContain('`pathParams` 값은 URL path segment로 encode되어');
    expect(readme.indexOf('## AI에게 맡기기')).toBeGreaterThan(readme.indexOf('## 생성되는 작업 공간'));
  });
});
