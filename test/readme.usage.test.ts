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
    expect(readme).toContain('AI coding agent에게 맡기려면 [AI agent로 시작하기](#ai-agent로-시작하기)를 먼저 보고, 직접 실행하려면 [빠른 시작](#빠른-시작)을 봅니다.');

    expect(readme).toContain('## AI agent로 시작하기');
    expect(readme).toContain('Codex를 사용한다면 `openapi-k6-scenario` 스킬을 설치한 뒤 시나리오를 요청하는 흐름을 권장합니다.');
    expect(readme).toContain('스킬은 Scenario YAML을 바로 쓰지 않고, 먼저 업무 프로세스와 호출할 API 순서를 정리한 뒤 사용자 확인을 받고 진행합니다.');
    expect(readme).toContain('npx --yes openapi-k6 install-skill --yes');
    expect(readme).toContain('$openapi-k6-scenario 회원 로그인 시나리오');
    expect(readme).toContain('`$openapi-k6-scenario` 스킬을 사용할 수 있는지 확인해.');
    expect(readme).toContain('기존 scenario 재사용 여부');
    expect(readme).toContain('npx --yes openapi-k6@latest install-skill --yes');
    expect(readme).toContain('기본 작업공간은 `openapi-k6/`야. 팀이나 프로젝트 규칙상 다른 이름이 필요하면 `init --dir <path>`를 사용해.');
    expect(readme).toContain('기존 `load-tests/config.yaml`이 있고 `openapi-k6/config.yaml`이 없으면 npx --yes openapi-k6@latest update로 `openapi-k6/`로 이전해.');
    expect(readme).toContain('작업공간 README.md가 있으면 먼저 읽고 그 지침을 따라.');
    expect(readme).toContain('같은 대화에서 최신 init, update, README 변경 이후 이미 읽었다면 전체를 다시 읽지 말고 필요한 섹션만 확인해.');
    expect(readme).toContain('이 README는 AI 작업 지침이므로, 이후 작업은 그 문서를 기준으로 진행해.');
    expect(readme).toContain('시나리오 파일을 작성하거나 수정하기 전에는 먼저 업무 프로세스와 호출할 API 순서를 요약해서 내 확인을 받아.');
    expect(readme).toContain('요약에는 scenario key와 파일 경로, API 호출 순서');
    expect(readme).toContain('run의 k6 check 실패는 명령 실패로 처리됩니다.');
    expect(readme).toContain('## 빠른 시작');
    expect(readme).toContain('npx --yes openapi-k6 init');
    expect(readme).toContain('npx --yes openapi-k6 sync');
    expect(readme).toContain('npx --yes openapi-k6 catalog --query <검색어>');
    expect(readme).toContain('npx --yes openapi-k6 catalog --query <검색어> --ai');
    expect(readme).toContain('npx --yes openapi-k6 catalog --sync --query <검색어> --ai');
    expect(readme).toContain('# openapi-k6/scenarios/<scenario-key>.yaml 작성');
    expect(readme).toContain('npx --yes openapi-k6 validate -s <scenario-key>');
    expect(readme).toContain('npx --yes openapi-k6 test -s <scenario-key>');
    expect(readme).toContain('npx --yes openapi-k6 generate -s <scenario-key>');
    expect(readme).toContain("k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 1 --iterations 1");
    expect(readme).toContain("k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --vus 10 --duration 30s");
    expect(readme).toContain("k6 run 'openapi-k6/generated/<scenario-key>.k6.js' --stage 30s:10 --stage 1m:50 --stage 30s:0");
    expect(readme).toContain('예를 들어 `-s auth/login`은 `openapi-k6/generated/auth/login.k6.js`로 생성됩니다.');
    expect(readme).toContain('시나리오가 많아지면 `openapi-k6/scenarios/auth/login.yaml`처럼 폴더로 묶고, CLI에서는 `-s auth/login`으로 실행합니다.');
    expect(readme).toContain('아래 예시는 이해를 돕기 위한 값입니다. 실제 명령에는 위 placeholder를 프로젝트에 맞게 바꿔 넣습니다.');
    expect(readme).toContain('처음 적용하는 프로젝트는 `init`부터 실행합니다.');
    expect(readme).toContain('기본 작업공간은 `openapi-k6/`이고, 팀이나 프로젝트 이름에 맞추려면 처음 만들 때 `npx --yes openapi-k6 init --dir <path>`를 사용합니다.');
    expect(readme).toContain('기존 기본 작업공간인 `load-tests/`가 있는 프로젝트는 `npx --yes openapi-k6 update`로 `openapi-k6/`로 이전하고 scaffold 안내를 갱신합니다.');
    expect(readme).toContain('기존 프로젝트에서 CLI가 `Scaffold update available`을 표시하면 안내된 `update` 명령을 실행하면 됩니다.');
    expect(readme).toContain('API base URL과 OpenAPI 경로가 확실하면 `init --sync`로 작업 공간 생성 직후 snapshot/catalog까지 만들 수 있습니다.');
    expect(readme).toContain('npx --yes openapi-k6 init --base-url <url> --openapi <path-or-url> --sync');

    const quickStartSection = readme.slice(readme.indexOf('## 빠른 시작'), readme.indexOf('## 1. 작업 공간 만들기'));
    const openapiCommandSection = readme.slice(readme.indexOf('## openapi-k6 명령 모음'), readme.indexOf('## k6 명령 모음'));
    const k6CommandSection = readme.slice(readme.indexOf('## k6 명령 모음'), readme.indexOf('## 지원 범위'));

    expect(quickStartSection).not.toContain('catalog --query login');
    expect(quickStartSection).not.toContain('-s smoke');
    expect(openapiCommandSection).not.toContain('catalog --query login');
    expect(openapiCommandSection).not.toContain('-s smoke');
    expect(openapiCommandSection).not.toContain("k6 run 'openapi-k6/generated");
    expect(openapiCommandSection).not.toContain('K6_WEB_DASHBOARD');
    expect(openapiCommandSection).toContain('| Codex 스킬 설치 | `npx --yes openapi-k6 install-skill --yes` |');
    expect(k6CommandSection).toContain('| 실시간 Web Dashboard | `K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_OPEN=true k6 run');
    expect(k6CommandSection).toContain('| HTML report 저장 | `K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=openapi-k6/logs/<scenario-key>-report.html k6 run');

    expect(readme).toContain('## 1. 작업 공간 만들기');
    expect(readme).toContain('API base URL [http://localhost:8080]: https://api.example.com');
    expect(readme).toContain('Swagger UI 주소가 아니라 실제 API 요청의 기본 주소를 입력합니다.');
    expect(readme).toContain('이미 `load-tests/`가 있으면 `init --force`로 새로 만들지 말고 먼저 `npx --yes openapi-k6 update`를 사용해 `openapi-k6/`로 이전합니다.');
    expect(readme).toContain('작업공간 이름을 바꾸려면 처음 만들 때 `npx --yes openapi-k6 init --dir <path>`를 사용합니다.');
    expect(readme).toContain('defaultModule: default');

    expect(readme).toContain('## 2. Endpoint 고르기');
    expect(readme).toContain('Catalog: openapi-k6/openapi/default.catalog.json');
    expect(readme).toContain('AI에게 scenario 초안까지 맡길 때는 `npx --yes openapi-k6 catalog --query <검색어> --ai`를 사용합니다.');
    expect(readme).toContain('Swagger/OpenAPI 변경을 바로 반영하려면 `npx --yes openapi-k6 catalog --sync --query <검색어> --ai`를 사용합니다.');
    expect(readme).toContain('OpenAPI schema/example이 있으면 request body 초안과 response extract 후보도 함께 보여줍니다.');
    expect(readme).toContain('아래는 검색어 `login`을 사용한 출력 예시입니다.');
    expect(readme).toContain('operationId: loginUser');
    expect(readme).toContain('`operationId`가 없거나 애매하면 `api.method`와 `api.path`를 쓸 수 있습니다.');

    expect(readme).toContain('## 3. Scenario 작성');
    expect(readme).toContain('폴더는 UI의 카테고리로 쓰입니다. 예를 들어 `openapi-k6/scenarios/auth/login.yaml`은 UI에서 `auth` 그룹에 표시되고, CLI에서는 `-s auth/login`으로 실행합니다.');
    expect(readme).toContain('각 step에는 `id`와 `api`가 필요합니다.');
    expect(readme).toContain('`request`, `extract`, `condition`은 필요한 경우만 둡니다.');
    expect(readme).toContain('`condition`을 생략하면 `test`와 `run`은 HTTP status `< 400`을 성공으로 봅니다.');
    expect(readme).toContain('name: smoke');
    expect(readme).toContain('Authorization: "Bearer {{token}}"');
    expect(readme).toContain('비밀값은 scenario YAML에 직접 쓰지 않습니다.');
    expect(readme).toContain('`catalog --ai` 초안의 `<...>` placeholder가 scenario에 남아 있으면 `validate`가 실패합니다.');

    expect(readme).toContain('## 4. 검증과 실행');
    expect(readme).toContain('| `validate` | 없음 | 없음 | YAML과 OpenAPI 정합성 확인 |');
    expect(readme).toContain('| `test` | 있음 | 없음 | 실제 API 흐름을 1회 실행 |');
    expect(readme).toContain('| `generate` | 없음 | 없음 | YAML과 OpenAPI 정합성 확인 후 k6 스크립트 생성 |');
    expect(readme).toContain('| `run` | 있음 | 있음 | 검증/생성 후 k6 실행 편의 명령 |');
    expect(readme).toContain('| 검증+생성+실행 편의 명령 | `npx --yes openapi-k6 run -s <scenario-key>` |');
    expect(readme).toContain('| 1회 smoke | `k6 run \'openapi-k6/generated/<scenario-key>.k6.js\' --vus 1 --iterations 1` |');
    expect(readme).toContain('`validate`가 통과한 scenario만 `generate`하고, `test`가 통과한 scenario만 `run`하는 흐름을 권장합니다.');

    expect(readme).toContain('## 필요할 때만');
    expect(readme).toContain('`npx --yes openapi-k6 ui`');
    expect(readme).toContain('| 다른 scenario 재사용 | `steps` 안에서 `- use: auth/login` |');
    expect(readme).toContain('`npx --yes openapi-k6 module add auth --base-url <url> --sync`');
    expect(readme).toContain('CLI가 `Scaffold update available`을 표시하면 `npx --yes openapi-k6 update`');
    expect(readme).toContain('use 경로는 `openapi-k6/scenarios` 기준 scenario key이며');
    expect(readme).toContain('`use`에는 확장자를 쓰지 않습니다.');
    expect(readme).toContain('<summary>재사용과 고급 설정 보기</summary>');
    expect(readme).toContain('### 다른 scenario use');
    expect(readme).toContain('- use: auth/login');
    expect(readme).toContain('`use` 값은 `auth/login`처럼 확장자 없는 scenario key여야 합니다.');
    expect(readme).toContain('`use` 대상 파일에는 반복 값을 두지 않고 entry scenario의 `vars:` 또는 CLI `--var-file`, `--var`에서 관리합니다.');
    expect(readme).toContain('### 테스트 데이터 재사용');
    expect(readme).toContain('npx --yes openapi-k6 test -s <scenario-key> --var-file openapi-k6/vars/stage.yaml');
    expect(readme).toContain('우선순위는 `vars:` < CLI `--var-file` < CLI `--var`입니다.');
    expect(readme).toContain('### 기존 호환 기능');
    expect(readme).toContain('기존 프로젝트의 `fixtures:`와 `include:`는 계속 동작합니다. 새 scenario는 `vars:`/`--var-file`과 `use`를 우선 사용합니다.');
    expect(readme).toContain('### 여러 서버 연결');
    expect(readme).toContain('npx --yes openapi-k6 module add auth --base-url https://auth-api.example.com --sync');
    expect(readme).toContain('baseUrl은 `BASE_URL_AUTH` 같은 module별 환경변수, `BASE_URL`, `modules.auth.baseUrl`, root `baseUrl`, OpenAPI snapshot의 `servers[0].url` 순서로 해석됩니다.');
    expect(readme).toContain('`doctor`는 각 module의 baseUrl이 어느 출처에서 해석되는지와 snapshot/catalog 파일 존재 여부를 같이 보여줍니다.');
    expect(readme).toContain('### UI, doctor, update');
    expect(readme).toContain('폴더별 scenario는 접어서 볼 수 있고, 요청 단계는 각 step이 `직접 정의`, `시나리오 사용: auth/login`처럼 어디서 온 것인지 표시합니다.');
    expect(readme).toContain('`test` 실행 결과는 최근 실행 결과에서 단계별 성공/실패, HTTP status, 소요시간, 출처를 함께 보여줍니다.');
    expect(readme).toContain('module별 baseUrl 출처');
    expect(readme).toContain('### generate와 runner');
    expect(readme).toContain('이 방식은 YAML/OpenAPI를 다시 검증하거나 최신 스크립트를 다시 만들지 않습니다.');
    expect(readme).toContain('### 제약');

    expect(readme).toContain('## 파일 규칙');
    expect(readme).toContain('`openapi-k6/config.yaml`');
    expect(readme).toContain('`openapi-k6/.env`');
    expect(readme).toContain('`openapi-k6/scenarios/**/*.yaml`');
    expect(readme).toContain('`openapi-k6/openapi/*.openapi.json`: `sync` 생성물');
    expect(readme).toContain('`openapi-k6/generated/**/*.k6.js`: `generate` 생성물');
    expect(readme).toContain('비밀값이 필요하면 `openapi-k6/.env.example`을 참고해 직접 만들고 commit하지 않습니다.');

    expect(readme).toContain('## 지원 범위');
    expect(readme).toContain('Node.js 20 이상');
    expect(readme).toContain('OpenAPI 3.x 문서');
    expect(readme).toContain('Swagger/OpenAPI 2.0 문서는 지원하지 않습니다.');

    expect(readme.indexOf('## AI agent로 시작하기')).toBeLessThan(readme.indexOf('## 빠른 시작'));
    expect(readme.indexOf('## 빠른 시작')).toBeLessThan(readme.indexOf('## 1. 작업 공간 만들기'));
    expect(readme.indexOf('## 4. 검증과 실행')).toBeLessThan(readme.indexOf('## 필요할 때만'));
    expect(readme.indexOf('## 필요할 때만')).toBeLessThan(readme.indexOf('## 파일 규칙'));
    expect(readme.indexOf('## openapi-k6 명령 모음')).toBeLessThan(readme.indexOf('## k6 명령 모음'));
    expect(readme.indexOf('## k6 명령 모음')).toBeLessThan(readme.indexOf('## 지원 범위'));
    expect(readme.indexOf('<summary>재사용과 고급 설정 보기</summary>')).toBeGreaterThan(readme.indexOf('## 필요할 때만'));
    expect(readme.indexOf('<summary>재사용과 고급 설정 보기</summary>')).toBeLessThan(readme.indexOf('## 파일 규칙'));
    expect(readme.indexOf('### 다른 scenario use')).toBeLessThan(readme.indexOf('### 테스트 데이터 재사용'));

    expect(readme).not.toContain('## 진행 방식 선택');
    expect(readme).not.toContain('## AI에게 맡기기');
    expect(readme).not.toContain('### 4-4. 선택: 데이터와 공통 step');
    expect(readme).not.toContain('docs/advanced-usage.md');
    expect(readme).not.toContain('npx --yes openapi-k6 run -s smoke --log -- --vus 1 --iterations 1');
    expect(readme).not.toContain('-- --vus');
    expect(readme).not.toContain('### 공통 step include');
    expect(readme).not.toContain('- include: ./partials/login.yaml');
    expect(readme).not.toContain('openapi-k6/scenarios/partials/login.yaml');
    expect(readme).not.toContain('파일 포함: ...');
  });

  it('keeps the docs index focused on secondary documents', async () => {
    const docsReadme = await readFile(path.join(repoRoot, 'docs/README.md'), 'utf8');

    expect(docsReadme).toContain('현재 사용자 사용법은 루트 [README](../README.md)를 기준으로 한다.');
    expect(docsReadme).toContain('[변경 이력](../CHANGELOG.md)');
    expect(docsReadme).toContain('[도구 개발/유지보수](./03-maintainer-notes.md)');
    expect(docsReadme).not.toContain('advanced-usage.md');
  });
});
