import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('README usage guide', () => {
  it('keeps the root entrypoint focused on the first successful scenario run', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('OpenAPI에서 API 흐름을 **Scenario YAML**로 작성하고');
    expect(readme).toContain('OpenAPI 가져오기 -> scenario 작성 -> validate/test -> run');
    expect(readme).toContain('직접 실행하려면 [빠른 시작](#빠른-시작)을 보고, AI coding agent에게 맡기려면 [AI에게 맡기기](#ai에게-맡기기)를 복사합니다.');

    expect(readme).toContain('## 빠른 시작');
    expect(readme).toContain('npx --yes openapi-k6 init');
    expect(readme).toContain('npx --yes openapi-k6 sync');
    expect(readme).toContain('npx --yes openapi-k6 catalog --query <검색어>');
    expect(readme).toContain('# load-tests/scenarios/<scenario-name>.yaml 작성');
    expect(readme).toContain('npx --yes openapi-k6 validate -s <scenario-name>');
    expect(readme).toContain('npx --yes openapi-k6 test -s <scenario-name>');
    expect(readme).toContain('npx --yes openapi-k6 run -s <scenario-name> --log -- --vus 1 --iterations 1');
    expect(readme).toContain('아래 예시는 이해를 돕기 위한 값입니다. 실제 명령에는 위 placeholder를 프로젝트에 맞게 바꿔 넣습니다.');
    expect(readme).toContain('처음 적용하는 프로젝트는 `init`부터 실행하고, 이미 `load-tests/`가 있는 프로젝트는 `init`을 다시 실행하지 말고 `update`로 scaffold 안내만 갱신합니다.');
    expect(readme).toContain('기존 프로젝트에서 CLI가 `Scaffold update available`을 표시하면 안내된 `update` 명령을 실행하면 됩니다.');

    const quickStartSection = readme.slice(readme.indexOf('## 빠른 시작'), readme.indexOf('## 1. 작업 공간 만들기'));
    const commandSection = readme.slice(readme.indexOf('## 명령 모음'), readme.indexOf('## 지원 범위'));

    expect(quickStartSection).not.toContain('catalog --query login');
    expect(quickStartSection).not.toContain('-s smoke');
    expect(commandSection).not.toContain('catalog --query login');
    expect(commandSection).not.toContain('-s smoke');

    expect(readme).toContain('## 1. 작업 공간 만들기');
    expect(readme).toContain('API base URL [http://localhost:8080]: https://api.example.com');
    expect(readme).toContain('Swagger UI 주소가 아니라 실제 API 요청의 기본 주소를 입력합니다.');
    expect(readme).toContain('이미 `load-tests/`가 있으면 `init --force`로 덮어쓰지 말고 먼저 `npx --yes openapi-k6 update`를 사용합니다.');
    expect(readme).toContain('defaultModule: default');

    expect(readme).toContain('## 2. Endpoint 고르기');
    expect(readme).toContain('Catalog: load-tests/openapi/default.catalog.json');
    expect(readme).toContain('아래는 검색어 `login`을 사용한 출력 예시입니다.');
    expect(readme).toContain('operationId: loginUser');
    expect(readme).toContain('`operationId`가 없거나 애매하면 `api.method`와 `api.path`를 쓸 수 있습니다.');

    expect(readme).toContain('## 3. Scenario 작성');
    expect(readme).toContain('name: smoke');
    expect(readme).toContain('Authorization: "Bearer {{token}}"');
    expect(readme).toContain('비밀값은 scenario YAML에 직접 쓰지 않습니다.');

    expect(readme).toContain('## 4. 검증과 실행');
    expect(readme).toContain('| `validate` | 없음 | 없음 | YAML과 OpenAPI 정합성 확인 |');
    expect(readme).toContain('| `test` | 있음 | 없음 | 실제 API 흐름을 1회 실행 |');
    expect(readme).toContain('| `generate` | 없음 | 없음 | k6 스크립트 생성 |');
    expect(readme).toContain('| `run` | 있음 | 있음 | k6 실행 |');
    expect(readme).toContain('`test`가 통과한 scenario만 `run`하거나 `generate`하는 흐름을 권장합니다.');

    expect(readme).toContain('## 필요할 때만');
    expect(readme).toContain('`npx --yes openapi-k6 ui`');
    expect(readme).toContain('`npx --yes openapi-k6 module add auth --base-url <url> --sync`');
    expect(readme).toContain('CLI가 `Scaffold update available`을 표시하면 `npx --yes openapi-k6 update`');
    expect(readme).toContain('include와 fixture 경로는 실행하는 scenario 파일 기준 상대 경로이며');
    expect(readme).toContain('<summary>고급 기능 예시 보기</summary>');
    expect(readme).toContain('### 테스트 데이터 재사용');
    expect(readme).toContain('우선순위는 `fixtures:` < `vars:` < `--var-file` < `--var`입니다.');
    expect(readme).toContain('### 공통 step include');
    expect(readme).toContain('include 파일에는 `vars:`나 `fixtures:`를 두지 않습니다.');
    expect(readme).toContain('### 여러 서버 연결');
    expect(readme).toContain('npx --yes openapi-k6 module add auth --base-url https://auth-api.example.com --sync');
    expect(readme).toContain('### UI, doctor, update');
    expect(readme).toContain('### generate와 runner');
    expect(readme).toContain('### 제약');

    expect(readme).toContain('## 파일 규칙');
    expect(readme).toContain('`load-tests/config.yaml`');
    expect(readme).toContain('`load-tests/.env`');
    expect(readme).toContain('`load-tests/scenarios/*.yaml`');
    expect(readme).toContain('`load-tests/openapi/*.openapi.json`: `sync` 생성물');
    expect(readme).toContain('`load-tests/generated/*.k6.js`: `generate` 생성물');
    expect(readme).toContain('비밀값이 필요하면 `load-tests/.env.example`을 참고해 직접 만들고 commit하지 않습니다.');

    expect(readme).toContain('## 지원 범위');
    expect(readme).toContain('Node.js 20 이상');
    expect(readme).toContain('OpenAPI 3.x 문서');
    expect(readme).toContain('Swagger/OpenAPI 2.0 문서는 지원하지 않습니다.');

    expect(readme).toContain('## AI에게 맡기기');
    expect(readme).toContain('먼저 이 openapi-k6 루트 README 전체를 읽어.');
    expect(readme).toContain('접힌 고급 기능 예시도 읽고 진행해.');
    expect(readme).toContain('모든 명령은 적용할 백엔드 프로젝트 루트에서 실행해.');
    expect(readme).toContain('백엔드 프로젝트에 load-tests/README.md가 없으면 npx --yes openapi-k6 init을 실행해.');
    expect(readme).toContain('이미 load-tests/README.md가 있으면 init을 다시 실행하지 말고 기존 문서를 먼저 읽어.');
    expect(readme).toContain('CLI가 Scaffold update available을 표시하거나 scaffold README/runner를 최신화해야 하면 npx --yes openapi-k6 update를 실행해.');
    expect(readme).toContain('init 또는 update 후 백엔드 프로젝트의 load-tests/README.md를 다시 읽고, 그 문서의 실제 경로와 명령을 기준으로 진행해.');
    expect(readme).toContain('operationId가 없거나 애매하면 api.method와 api.path를 사용해.');
    expect(readme).toContain('여러 서버를 이어야 할 때만 module add와 api.module을 사용해.');
    expect(readme).toContain('load-tests/openapi/*.openapi.json, load-tests/openapi/*.catalog.json, load-tests/generated/*.k6.js도 직접 수정하지 말고 sync/generate로 다시 만들어.');
    expect(readme).toContain('validate와 test가 통과하기 전에는 run이나 generate를 하지 마.');

    expect(readme.indexOf('## 빠른 시작')).toBeLessThan(readme.indexOf('## 1. 작업 공간 만들기'));
    expect(readme.indexOf('## 4. 검증과 실행')).toBeLessThan(readme.indexOf('## 필요할 때만'));
    expect(readme.indexOf('## 필요할 때만')).toBeLessThan(readme.indexOf('## 파일 규칙'));
    expect(readme.indexOf('## 명령 모음')).toBeLessThan(readme.indexOf('## 지원 범위'));
    expect(readme.indexOf('<summary>고급 기능 예시 보기</summary>')).toBeGreaterThan(readme.indexOf('## 필요할 때만'));
    expect(readme.indexOf('<summary>고급 기능 예시 보기</summary>')).toBeLessThan(readme.indexOf('## 파일 규칙'));

    expect(readme).not.toContain('## 진행 방식 선택');
    expect(readme).not.toContain('### 4-4. 선택: 데이터와 공통 step');
    expect(readme).not.toContain('docs/advanced-usage.md');
    expect(readme).not.toContain('npx --yes openapi-k6 run -s smoke --log -- --vus 1 --iterations 1');
  });

  it('keeps the docs index focused on secondary documents', async () => {
    const docsReadme = await readFile(path.join(repoRoot, 'docs/README.md'), 'utf8');

    expect(docsReadme).toContain('현재 사용자 사용법은 루트 [README](../README.md)를 기준으로 한다.');
    expect(docsReadme).toContain('[변경 이력](../CHANGELOG.md)');
    expect(docsReadme).toContain('[도구 개발/유지보수](./03-maintainer-notes.md)');
    expect(docsReadme).not.toContain('advanced-usage.md');
  });
});
