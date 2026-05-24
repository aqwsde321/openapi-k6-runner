import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('README usage guide', () => {
  it('keeps the root entrypoint scannable and delegates detailed work to generated README', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('OpenAPI에서 API 흐름을 **Scenario YAML**로 만들고');
    expect(readme).toContain('`openapi-k6`의 중심은 k6 파일 생성이 아니라 scenario 작성과 검증입니다.');

    expect(readme).toContain('## 한눈에 보기');
    expect(readme).toContain('init -> sync -> catalog 검색 -> scenario YAML 수정 -> validate -> test -> run');
    expect(readme).toContain('| 1 | `npx --yes openapi-k6 init` | 백엔드 프로젝트에 `load-tests/` 생성 |');
    expect(readme).toContain('| 3 | `npx --yes openapi-k6 catalog --query login` | scenario에 쓸 endpoint 후보 검색 |');
    expect(readme).toContain('| 5 | `npx --yes openapi-k6 validate -s smoke` | OpenAPI snapshot 기준 정적 검증 |');
    expect(readme).toContain('| 6 | `npx --yes openapi-k6 test -s smoke` | Node.js에서 scenario 1회 실행 검증 |');
    expect(readme).toContain('| 7 | `npx --yes openapi-k6 run -s smoke --log -- --vus 1` | 정적 검증, k6 스크립트 생성, k6 실행 |');
    expect(readme).toContain('| 8 | `npx --yes openapi-k6 generate -s smoke`, `./load-tests/run.sh smoke --log` | 스크립트만 생성하거나 runner로 실행 |');
    expect(readme).toContain('`openapi-k6 validate`와 `openapi-k6 test`는 보조 명령이 아니라 k6 실행 전 검증 관문입니다.');
    expect(readme).toContain('`validate`는 API 호출 없이 operation/path/query/header/body 정합성, context template 참조, condition/extract 문법을 확인하고');

    expect(readme).toContain('## 핵심 기능');
    expect(readme).toContain('| Scenario YAML | 로그인, 추출, 인증 요청 같은 API 흐름을 YAML로 표현합니다. |');
    expect(readme).toContain('| 재사용 step include | 로그인/seed 같은 공통 step YAML을 여러 scenario에서 include해 반복을 줄입니다. |');
    expect(readme).toContain('| 검증 관문 | k6 실행 전에 OpenAPI 정합성, 요청 구성, 추출, 설정 오류를 잡습니다. |');
    expect(readme).toContain('| OpenAPI catalog | `catalog` 명령으로 scenario에 쓸 `operationId`, `method`, `path`를 찾습니다. |');
    expect(readme).toContain('| 멀티모듈/멀티서버 | `module add`와 `api.module`로 서로 다른 OpenAPI/Swagger 서버를 하나의 scenario에서 연결합니다. |');
    expect(readme).toContain('| `load-tests/` 작업 공간 | config, scenario, snapshot, 생성된 k6 스크립트, runner를 백엔드 프로젝트 안에서 관리합니다. |');
    expect(readme).toContain('| AI 작업 프롬프트 | 루트 README에서 시작하고 생성 README로 이어지는 작업 지침을 제공합니다. |');

    expect(readme).toContain('<summary>작동 예시와 test 출력</summary>');
    expect(readme).toContain('`login` 응답에서 `token`을 추출해 다음 API의 `Authorization` header에 넣는 흐름입니다.');
    expect(readme).toContain('name: login-and-read-profile');
    expect(readme).toContain('operationId: loginUser');
    expect(readme).toContain('Authorization: "Bearer {{token}}"');
    expect(readme).toContain('`openapi-k6 test`는 이 YAML을 먼저 실행하고, 실패한 step과 검증식을 출력합니다.');
    expect(readme).toContain('$ npx --yes openapi-k6 test -s login-and-read-profile');
    expect(readme).toContain('scenario: login-and-read-profile');
    expect(readme).toContain('[1/2] login');
    expect(readme).toContain('extract: ✓ token');
    expect(readme).toContain('[2/2] get-me');
    expect(readme).toContain('summary: ✓ PASS');
    expect(readme).toContain('`test`가 통과한 scenario만 `openapi-k6 run`으로 k6까지 실행하거나 `openapi-k6 generate`로 스크립트를 생성합니다.');

    expect(readme).toContain('## 지원 범위');
    expect(readme).toContain('Node.js 20 이상');
    expect(readme).toContain('OpenAPI 3.x 문서');
    expect(readme).toContain('검증과 실행 시 접근 가능한 백엔드 서버');
    expect(readme).toContain('k6 스크립트 실행용 k6 별도 설치');
    expect(readme).toContain('Swagger/OpenAPI 2.0 문서는 지원하지 않습니다.');
    expect(readme).toContain('목표는 범용 API 테스트 플랫폼이 아니라 OpenAPI 기반 scenario 검증과 k6 스크립트 생성입니다.');

    expect(readme).toContain('## 빠른 시작');
    expect(readme).toContain('### 1. 작업 공간 생성');
    expect(readme).toContain('npx --yes openapi-k6 init');
    expect(readme).toContain('백엔드 프로젝트 루트에서 실행합니다.');
    expect(readme).toContain('대화형 터미널에서는 `baseUrl`만 묻고 `<baseUrl>/v3/api-docs`가 OpenAPI 3.x JSON인지 확인합니다.');
    expect(readme).toContain('그래도 찾지 못할 때만 OpenAPI spec URL 또는 파일 경로를 묻습니다.');
    expect(readme).toContain('### 2. 설정 확인');
    expect(readme).toContain('OpenAPI URL이 확인되면 `load-tests/config.yaml`의 `baseUrl`과 `modules.<name>.openapi`가 채워집니다.');
    expect(readme).toContain('자동 탐색이 실패하면 CLI 안내에 따라 URL/파일 경로를 입력하거나 `skip`으로 넘어간 뒤 config를 나중에 수정할 수 있습니다.');
    expect(readme).toContain('### 3. OpenAPI snapshot/catalog 생성');
    expect(readme).toContain('npx --yes openapi-k6 sync');
    expect(readme).toContain('### 4. Scenario 작성/수정');
    expect(readme).toContain('`catalog` 명령으로 테스트할 endpoint의 `operationId`, `method`, `path`, request body 여부를 확인합니다.');
    expect(readme).toContain('npx --yes openapi-k6 catalog --query login');
    expect(readme).toContain('그 다음 `load-tests/scenarios/smoke.yaml`을 API 흐름에 맞게 수정합니다.');
    expect(readme).toContain('반복되는 로그인, seed, cleanup 흐름은 별도 YAML로 분리한 뒤 scenario의 원하는 위치에서 include할 수 있습니다.');
    expect(readme).toContain('- include: ./partials/login.yaml');
    expect(readme).toContain('`partials/login.yaml`은 `name` 없이 `steps`만 둘 수 있고, 포함된 step의 `extract` 값은 뒤 step에서 그대로 참조할 수 있습니다.');
    expect(readme).toContain('### 5. Scenario 정적 검증');
    expect(readme).toContain('npx --yes openapi-k6 validate -s smoke');
    expect(readme).toContain('`validate`는 백엔드에 요청하지 않고 scenario YAML을 OpenAPI snapshot과 대조합니다.');
    expect(readme).toContain('필수 path/query/header/body 누락, `{{token}}` 같은 context template 참조, `condition`, `extract.from` 문법을 확인합니다.');
    expect(readme).toContain('### 6. Scenario 실행 검증');
    expect(readme).toContain('npx --yes openapi-k6 test -s smoke');
    expect(readme).toContain('`test`가 통과해야 k6 스크립트를 생성하거나 실행합니다.');
    expect(readme).toContain('### 7. k6 실행');
    expect(readme).toContain('npx --yes openapi-k6 run -s smoke --log -- --vus 1 --iterations 1');
    expect(readme).toContain('`run`은 scenario를 정적 검증하고, k6 스크립트를 다시 생성한 뒤 `k6 run`을 실행합니다.');
    expect(readme).toContain('k6 옵션은 `--` 뒤에 붙입니다.');
    expect(readme).toContain('npx --yes openapi-k6 generate -s smoke');
    expect(readme).toContain('./load-tests/run.sh smoke --log');
    expect(readme).toContain('k6 스크립트 실행에는 k6 설치가 필요합니다.');
    expect(readme).toContain('### 여러 백엔드 서버를 연결할 때');
    expect(readme).toContain('인증 서버와 업무 서버처럼 Swagger/OpenAPI 주소가 다른 백엔드를 하나의 scenario에서 이어야 하면 module을 추가합니다.');
    expect(readme).toContain('npx --yes openapi-k6 module add auth --base-url https://auth-api.example.com --sync');
    expect(readme).toContain('npx --yes openapi-k6 module add bos --base-url https://bos-api.example.com --sync');
    expect(readme).toContain('생성된 k6 스크립트는 `BASE_URL_AUTH`, `BASE_URL_BOS` 같은 module별 환경변수를 먼저 읽습니다.');
    expect(readme).toContain('같은 `operationId`가 여러 module에 있어도 step의 `api.module` 안에서만 찾습니다.');
    expect(readme).not.toContain('cd /path/to/backend-project');

    expect(readme).not.toContain('<summary>Scenario YAML 예시</summary>');

    expect(readme).toContain('<summary>수정할 파일과 생성물</summary>');
    expect(readme).toContain('보통 직접 수정하는 파일은 `load-tests/config.yaml`, `load-tests/.env`, `load-tests/scenarios/*.yaml`입니다.');
    expect(readme).toContain('OpenAPI snapshot과 생성된 k6 스크립트는 명령으로 다시 만듭니다.');
    expect(readme).toContain('load-tests/run.sh');
    expect(readme).toContain('기본 `load-tests/.gitignore`는 `scenarios/**`만 git 추적 대상에 남기고 scaffold/config/생성물은 제외합니다.');
    expect(readme).toContain('기존 `load-tests/config.yaml`과 scenario를 보존한 채 README, runner, `.env.example`, `.gitignore`, `.openapi-k6.json` 같은 scaffold 파일만 최신화하려면 `update`를 사용합니다.');
    expect(readme).toContain('`update`는 `load-tests/config.yaml`, `.env`, `scenarios/`, `openapi/`, `generated/`, `logs/`를 보존합니다.');
    expect(readme).toContain('오래된 scaffold에서 `validate`, `test`, `generate`, `run`을 실행하면 최신 README/runner를 받을 수 있도록 `Scaffold update available` notice와 `npx --yes openapi-k6 update` 명령이 표시됩니다.');

    expect(readme).toContain('<summary>검증 규칙과 제약</summary>');
    expect(readme).toContain('OpenAPI 3.x 문서를 대상으로 합니다. Swagger/OpenAPI 2.0 문서는 지원하지 않습니다.');
    expect(readme).toContain('`condition`은 분기가 아니라 검증식입니다.');
    expect(readme).toContain('비밀값은 scenario YAML에 직접 쓰지 않고 `{{env.NAME}}`으로 참조합니다.');
    expect(readme).toContain('`steps` 안에서 `- include: ./partials/login.yaml`로 공통 step 파일을 펼칠 수 있습니다.');
    expect(readme).toContain('`validate`는 지원하지 않는 `condition` 표현식, `extract.from` JSONPath, 아직 이전 step에서 추출되지 않은 `{{token}}` 같은 context template 참조를 API 호출 전에 실패로 처리합니다.');
    expect(readme).toContain('`body`와 `multipart`는 같은 step에서 함께 쓰지 않습니다.');

    expect(readme).toContain('## 명령 모음');
    expect(readme).toContain('| 작업 공간 생성 | `npx --yes openapi-k6 init` |');
    expect(readme).toContain('| OpenAPI snapshot/catalog 갱신 | `npx --yes openapi-k6 sync` |');
    expect(readme).toContain('| scenario용 endpoint 검색 | `npx --yes openapi-k6 catalog --query login` |');
    expect(readme).toContain('| scenario 정적 검증 | `npx --yes openapi-k6 validate -s <name>` |');
    expect(readme).toContain('| scenario 실행 검증 | `npx --yes openapi-k6 test -s <name>` |');
    expect(readme).toContain('| 정적 검증, 생성, k6 실행 | `npx --yes openapi-k6 run -s <name> --log -- --vus 1` |');
    expect(readme).toContain('| k6 스크립트 생성 | `npx --yes openapi-k6 generate -s <name>` |');
    expect(readme).toContain('| k6 설치 후 실행 | `./load-tests/run.sh <name> --log` |');
    expect(readme).toContain('| 기존 scaffold 안전 갱신 | `npx --yes openapi-k6 update` |');
    expect(readme).toContain('| scaffold 파일 재생성 | `npx --yes openapi-k6 init --force` |');

    expect(readme).toContain('## AI에게 맡기기');
    expect(readme).not.toContain('<summary>AI에게 맡기기</summary>');
    expect(readme).toContain('AI coding agent에게 아래 프롬프트를 붙여넣으세요.');
    expect(readme).toContain('이 백엔드 프로젝트에 openapi-k6 Scenario YAML 검증과 k6 부하 테스트 준비를 적용해줘.');
    expect(readme).toContain('아직 load-tests/README.md가 없으면 npx --yes openapi-k6 init을 실행해.');
    expect(readme).toContain('baseUrl 또는 OpenAPI spec URL을 확실히 모르면 나에게 물어봐.');
    expect(readme).toContain('init 후 생성된 load-tests/README.md를 읽고, 그 문서의 작업 순서와 규칙을 기준으로 진행해.');
    expect(readme).toContain('npx --yes openapi-k6 sync를 실행해서 OpenAPI snapshot과 catalog를 생성해.');
    expect(readme).toContain('npx --yes openapi-k6 catalog --query login처럼 적절한 검색어로 테스트할 endpoint 후보를 확인해.');
    expect(readme).toContain('반복되는 로그인/seed 흐름은 load-tests/scenarios/partials/*.yaml로 분리하고 steps에서 - include: ./partials/login.yaml로 재사용해.');
    expect(readme).toContain('npx --yes openapi-k6 validate -s <name>으로 YAML/OpenAPI 정합성을 먼저 확인해.');
    expect(readme).toContain('npx --yes openapi-k6 test -s <name>으로 실제 API 흐름을 검증해.');
    expect(readme).toContain('scenario test가 통과하기 전에는 k6 스크립트를 생성하거나 실행하지 마.');
    expect(readme).toContain('통과한 scenario만 npx --yes openapi-k6 run -s <name> --log -- --vus 1 --iterations 1로 짧게 실행해.');
    expect(readme).toContain('스크립트만 필요하면 npx --yes openapi-k6 generate -s <name>으로 생성해.');
    expect(readme).toContain('load-tests/README.md, load-tests/run.sh, load-tests/.env.example, load-tests/.gitignore, load-tests/.openapi-k6.json은 scaffold 파일이므로 명시 요청 없이는 수정하지 마.');
    expect(readme).toContain('비밀값은 scenario YAML에 직접 쓰지 말고 {{env.NAME}}으로 참조해. 실제 값은 load-tests/.env에만 둬.');
    expect(readme).toContain('작업 중간부터는 생성 README를 기준으로 따르세요.');

    expect(readme).toContain('<summary>버전 고정</summary>');
    expect(readme).toContain('pnpm add -D openapi-k6');
    expect(readme).toContain('새 배포본을 명시하려면 `npx --yes openapi-k6@latest <command>`를 사용할 수 있습니다.');
    expect(readme).toContain('팀/CI에서는 `openapi-k6@<version>`처럼 버전을 고정하는 편이 재현성에 유리합니다.');
    expect(readme).toContain('[도구 개발/유지보수](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/03-maintainer-notes.md)');

    expect(readme).toContain('## 참고문서');
    expect(readme).toContain('[변경 이력](https://github.com/aqwsde321/openapi-k6-runner/blob/main/CHANGELOG.md)');
    expect(readme).toContain('[문서 색인](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/README.md)');
    expect(readme).toContain('https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/spec/mvp-design.md');
    expect(readme).not.toContain('## 라이선스');
    expect(readme).not.toContain('현재 공개 재사용 라이선스가 지정되어 있지 않습니다.');

    expect(readme.indexOf('## 핵심 기능')).toBeLessThan(readme.indexOf('## 빠른 시작'));
    expect(readme.indexOf('## 지원 범위')).toBeLessThan(readme.indexOf('## 빠른 시작'));
    expect(readme.indexOf('## 빠른 시작')).toBeLessThan(readme.indexOf('<summary>작동 예시와 test 출력</summary>'));
    expect(readme.indexOf('<summary>작동 예시와 test 출력</summary>')).toBeLessThan(readme.indexOf('<summary>수정할 파일과 생성물</summary>'));
    expect(readme.indexOf('## 명령 모음')).toBeLessThan(readme.indexOf('## AI에게 맡기기'));
    expect(readme.indexOf('## AI에게 맡기기')).toBeLessThan(readme.indexOf('## 참고문서'));
  });
});
