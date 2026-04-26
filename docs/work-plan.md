# 문서 기반 작업 계획

## 1. 진행 방식

이 프로젝트는 기능을 먼저 문서로 고정하고, 문서 단위로 구현한다.

각 작업 단위는 다음 순서를 따른다.

1. 문서에서 책임, 입력, 출력, 완료 기준 확인
2. 해당 범위만 구현
3. 해당 범위 테스트 추가
4. README 또는 사용 예시 갱신
5. 다음 문서 단위로 이동

## 2. 전체 단계

| 단계 | 문서 기준 | 산출물 | 상태 |
| --- | --- | --- | --- |
| P-00 | MVP 설계/기능 세분화 | 문서 확정 | 완료 |
| P-01 | CLI 골격 | TypeScript CLI 실행 가능 | 완료 |
| P-02 | Parser | Scenario DSL parse 가능 | 완료 |
| P-03 | OpenAPI Registry | OpenAPI operation resolve 가능 | 완료 |
| P-04 | AST Builder | DSL + OpenAPI -> AST | 완료 |
| P-05 | k6 Generator | AST -> k6 script | 완료 |
| P-06 | OpenAPI Snapshot/Catalog | snapshot 저장 및 endpoint catalog 생성 | 완료 |
| P-07 | Fixture/Test | 대상 프로젝트형 fixture | 완료 |
| P-08 | README/사용법 | 최소 실행 가이드 | 완료 |
| P-09 | 멀티모듈 OpenAPI 설정 | module별 registry 선택 | 필수 후속 |
| P-10 | UI Adapter 설계 | UI flow -> Scenario DSL 변환 문서 | 후순위 |

## 3. P-00 문서 확정

### 범위

- MVP 설계 문서
- 기능 세분화 문서
- 참조 프로젝트 분석 문서
- 작업 계획 문서

### 완료 기준

- MVP 포함/제외 기능이 명확하다.
- 기능별 책임과 완료 기준이 존재한다.
- 참조 프로젝트 활용 기준이 정리되어 있다.
- 다음 구현 순서가 문서에 있다.

## 4. P-01 CLI 골격

### 기능 기준

- F-01 프로젝트/CLI 골격
- F-02 설정 로딩 일부

### 작업

- `package.json` 생성
- TypeScript 설정 생성
- CLI entrypoint 생성
- `generate` command option parsing
- output 파일 쓰기까지의 빈 pipeline 연결

### 완료 기준

- `openapi-k6 generate -s scenario.yaml -o openapi.yaml -w output.js` 형태가 동작한다.
- 아직 실제 k6 생성은 placeholder여도 CLI 흐름은 검증된다.
- 필수 옵션이 없으면 실패한다.

### 테스트

- CLI 옵션 parser 테스트
- output path 생성 테스트

## 5. P-02 Scenario Parser

### 기능 기준

- F-03 Scenario DSL Parser

### 작업

- YAML/JSON 파일 로드
- `Scenario` 타입 정의
- step 구조 검증
- 사람이 읽을 수 있는 parser 에러 작성

### 완료 기준

- 정상 YAML scenario가 `Scenario` 객체로 변환된다.
- JSON scenario도 변환된다.
- 중복 step id, 누락 api, 누락 name이 에러로 처리된다.

### 테스트

- valid YAML
- valid JSON
- invalid missing name
- invalid duplicate step id
- invalid api reference

## 6. P-03 OpenAPI Registry

### 기능 기준

- F-04 OpenAPI Parser / API Registry
- F-05 OpenAPI Resolver

### 작업

- OpenAPI 파일 로드
- OpenAPI 3.x 검사
- `$ref` dereference
- HTTP method/path 순회
- `byOperationId` index 생성
- `byMethodPath` index 생성
- resolver 구현

### 완료 기준

- OpenAPI 3.0/3.1 fixture가 registry로 변환된다.
- `operationId`로 operation을 찾을 수 있다.
- `method + path`로 operation을 찾을 수 있다.
- 중복 operationId는 에러가 난다.

### 테스트

- oas30 fixture
- oas31 fixture
- operationId resolve
- method/path resolve
- missing operation error
- duplicate operationId error

## 7. P-04 AST Builder

### 기능 기준

- F-06 AST Builder
- F-07 Template Compiler 일부

### 작업

- Scenario step과 resolved operation 결합
- request 기본값 정규화
- method/path/request/extract/condition 보존
- pathParams metadata 보존

### 완료 기준

- DSL step 순서가 AST step 순서와 같다.
- operationId 기반 step과 method/path 기반 step이 모두 AST로 변환된다.
- request가 없는 step도 안정적으로 처리된다.

### 테스트

- operationId scenario
- method/path scenario
- pathParams scenario
- headers/body/query 포함 scenario

## 8. P-05 k6 Generator

### 기능 기준

- F-07 Template Compiler
- F-08 JSONPath Extract
- F-09 Condition Compiler
- F-10 k6 Generator

### 작업

- k6 import 생성
- `BASE_URL` 상수 생성
- URL 생성
- pathParams 치환
- query string 생성
- headers/body 생성
- response 변수 생성
- extract 코드 생성
- condition check 코드 생성

### 완료 기준

- 생성된 k6 script가 문법적으로 유효하다.
- `GET`, `POST`, `PUT`, `PATCH`, `DELETE` 기본 호출을 생성한다.
- `{{token}}` template이 `context.token`으로 변환된다.
- `$.data.id` extract가 context 저장 코드로 변환된다.
- `status == 200` condition이 k6 check로 변환된다.

### 테스트

- generated script snapshot
- template 변환
- pathParams 치환
- query 생성
- JSONPath 지원 범위
- condition 지원 범위

## 9. P-06 OpenAPI Snapshot/Catalog

### 기능 기준

- F-15 OpenAPI snapshot / catalog

### 작업

- `sync` 또는 `inspect` 계열 CLI 명령 추가
- 원격 OpenAPI URL을 snapshot 파일로 저장
- snapshot 파일을 파싱해 `catalog.json` 생성
- catalog에 method/path, operationId, tags, summary, parameters, requestBody 여부 포함
- 대상 프로젝트 권장 구조인 `load-tests/openapi` 기준 예시 작성

### 완료 기준

- OpenAPI URL에서 `load-tests/openapi/dev.openapi.json`을 생성할 수 있다.
- snapshot 파일에서 `load-tests/openapi/catalog.json`을 생성할 수 있다.
- catalog를 보고 scenario YAML 작성에 필요한 endpoint 정보를 확인할 수 있다.
- `generate`는 snapshot OpenAPI 파일을 입력으로 사용한다.

### 테스트

- OpenAPI fixture에서 catalog 생성
- tags/summary/operationId 보존
- requestBody 여부 표시
- 지원 method만 catalog 포함
- snapshot 파일 쓰기

## 10. P-07 Fixture/Test 정리

### 기능 기준

- F-11 Fixture 기반 테스트

### 작업

- `test/fixtures/openapi`
- `test/fixtures/scenarios`
- `test/fixtures/expected`
- generator snapshot 관리

### 완료 기준

- 테스트 fixture 구조가 문서화된다.
- 최소 happy path 테스트가 있다.
- 주요 실패 케이스 테스트가 있다.

## 11. P-08 README/사용법

### 작업

- 설치 방법
- `.env` 예시
- 테스트 대상 프로젝트에 scenario/OpenAPI/`.env`를 두는 운영 구조
- scenario 예시
- OpenAPI 예시
- generate 명령 예시
- k6 실행 예시

### 완료 기준

- 처음 보는 사용자가 README만 보고 script를 생성할 수 있다.

## 12. P-09 멀티모듈 OpenAPI 설정

### 시점

CLI/compiler MVP가 동작하고 README 사용법이 정리된 뒤 진행한다.

### 기능 기준

- F-14 멀티모듈 OpenAPI 설정

### 작업

- `.env` module path 규칙 확정
- `--module` CLI option 추가
- module별 OpenAPI spec resolve
- module별 `ApiRegistry` 생성 또는 선택
- Scenario DSL v2의 `api.module` 도입 여부 결정
- default module fallback 규칙 작성

### 완료 기준

- 단일 모듈 scenario는 기존 방식으로 계속 동작한다.
- `--module bos`로 module별 OpenAPI spec을 선택할 수 있다.
- module별 registry가 섞이지 않는다.
- module이 없거나 잘못되면 명확한 에러가 발생한다.

### 테스트

- default module resolve
- `--module` 기반 OpenAPI path 선택
- unknown module error
- module별 duplicate operationId 격리
- 기존 단일 모듈 scenario 호환

## 13. P-10 UI Adapter 설계

### 시점

CLI/compiler MVP가 동작한 뒤 진행한다.

### 작업

- `swagger-flow-tester` flow model 문서화
- UI flow -> Scenario DSL 변환 규칙 작성
- header-config 병합 규칙 작성
- binding -> extract/template 변환 규칙 작성

### 완료 기준

- UI 저장 flow를 Scenario DSL로 export할 수 있는 변환 규칙이 문서화된다.
- 구현은 별도 단계에서 진행한다.

## 14. 우선 구현 순서

1. P-01 CLI 골격
2. P-02 Scenario Parser
3. P-03 OpenAPI Registry
4. P-04 AST Builder
5. P-05 k6 Generator
6. P-06 OpenAPI Snapshot/Catalog
7. P-07 Fixture/Test
8. P-08 README/사용법
9. P-09 멀티모듈 OpenAPI 설정

## 15. 보류 결정

| 항목 | 현재 결정 | 재검토 시점 |
| --- | --- | --- |
| UI 통합 | MVP 제외 | P-10 |
| Supabase 저장소 | 제외 | UI 구현 시 |
| Swagger URL 자동 탐색 | 제외 | 멀티모듈 module 등록 시 |
| Auth scheme 자동 적용 | 제외 | UI header 제안 시 |
| k6 실행 자동화 | 제외 | generator 안정화 후 |
| branch/loop/retry | 제외 | MVP 완료 후 |
