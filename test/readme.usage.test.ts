import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('README usage guide', () => {
  it('documents the root entrypoint and delegates detailed work to generated README', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('OpenAPI 기반으로 **Scenario YAML을 만들고**');
    expect(readme).toContain('`openapi-k6`의 중심은 k6 파일 생성이 아니라 scenario 작성입니다.');
    expect(readme).toContain('## 할 수 있는 것');
    expect(readme).toContain('이전 API 응답 값을 `extract`로 저장하고 다음 API의 header, query, path, body에 연결');
    expect(readme).toContain('## 핵심 흐름');
    expect(readme).toContain('scenario test로 실제 API 흐름 검증');
    expect(readme).toContain('`openapi-k6 test`는 보조 명령이 아니라 k6 실행 전 필수 gate입니다.');
    expect(readme).toContain('## Scenario YAML 예시');
    expect(readme).toContain('name: login-and-read-profile');
    expect(readme).toContain('Authorization: "Bearer {{token}}"');
    expect(readme).toContain('이 YAML은 `openapi-k6 test`에서는 실제 API 요청으로 실행되고');
    expect(readme).toContain('## 빠른 시작');
    expect(readme).toContain('### 1. 작업 공간 생성');
    expect(readme).toContain('npx --yes openapi-k6 init');
    expect(readme).toContain('테스트를 추가할 백엔드 프로젝트 루트 터미널에서 실행합니다.');
    expect(readme).toContain('대화형 터미널에서는 `baseUrl`만 묻고 `<baseUrl>/v3/api-docs`가 OpenAPI 3.x JSON인지 먼저 확인합니다.');
    expect(readme).toContain('그래도 찾지 못할 때만 OpenAPI spec URL 또는 파일 경로를 따로 묻습니다.');
    expect(readme).toContain('### 2. 설정 확인');
    expect(readme).toContain('OpenAPI URL을 찾았으면 `load-tests/config.yaml`의 `baseUrl`과 `openapi`가 바로 채워집니다.');
    expect(readme).toContain('자동 탐색이 실패하면 CLI 안내에 따라 직접 URL/파일 경로를 입력하거나 `skip`으로 넘어간 뒤 config를 나중에 수정할 수 있습니다.');
    expect(readme).toContain('### 3. OpenAPI snapshot/catalog 생성');
    expect(readme).not.toContain('cd /path/to/backend-project');
    expect(readme).toContain('npx --yes openapi-k6 sync');
    expect(readme).toContain('### 4. Scenario 검증');
    expect(readme).toContain('npx --yes openapi-k6 test -s smoke');
    expect(readme).toContain('`test`가 통과하기 전에는 k6 스크립트를 생성하거나 실행하지 않습니다.');
    expect(readme).toContain('### 5. k6 스크립트 생성 및 실행');
    expect(readme).toContain('npx --yes openapi-k6 generate -s smoke');
    expect(readme).toContain('### 선택: 버전 고정');
    expect(readme).toContain('pnpm add -D openapi-k6');
    expect(readme).toContain('[도구 개발/유지보수](https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/03-maintainer-notes.md)');
    expect(readme).not.toContain('## 백엔드 프로젝트에 추가하기');
    expect(readme).toContain('## 생성되는 작업 공간');
    expect(readme).toContain('load-tests/run.sh');
    expect(readme).toContain('`--force`는 scaffold 관리 파일만 다시 쓰고');
    expect(readme).toContain('## AI에게 맡기기');
    expect(readme).toContain('생성된 `load-tests/README.md`의 "AI에게 작업 맡기기" 섹션을 AI coding agent에게 붙여넣으세요.');
    expect(readme).toContain('실제 작업 프롬프트는 init 시 선택한 디렉터리와 명령이 반영된 생성 README를 기준으로 합니다.');
    expect(readme).not.toContain('이 백엔드 프로젝트에 openapi-k6 시나리오 테스트와 k6 부하 테스트 준비를 적용해줘.');
    expect(readme).not.toContain('## 알아둘 점');
    expect(readme).not.toContain('`sync`는 외부 파일이나 URL을 가리키는 `$ref`를 snapshot 내부 참조로 묶어 저장합니다.');
    expect(readme).not.toContain('`pathParams` 값은 URL path segment로 encode되어');
    expect(readme).toContain('https://github.com/aqwsde321/openapi-k6-runner/blob/main/docs/spec/mvp-design.md');
    expect(readme).not.toContain('## 라이선스');
    expect(readme).not.toContain('현재 공개 재사용 라이선스가 지정되어 있지 않습니다.');
    expect(readme.indexOf('## AI에게 맡기기')).toBeGreaterThan(readme.indexOf('## 생성되는 작업 공간'));
  });
});
