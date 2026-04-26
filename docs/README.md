# 문서 색인

현재 사용법은 루트 [README](../README.md)를 기준으로 본다.

## 유지 문서

- [MVP 설계](./mvp-design.md): 현재 아키텍처, DSL, 실행 모델, 확정된 기술 선택
- [기능 세분화](./feature-breakdown.md): 구현된 기능 계약, 지원 범위, 후속 기능 경계

## 참고 문서

- [참조 프로젝트 분석](./reference-projects.md): `openapi-projector`, `swagger-flow-tester`에서 참고한 개념 기록
- [완료된 작업 계획](./work-plan.md): P-00부터 P-10까지의 구현 이력

## 정리 기준

1. 사용자 실행 방법은 루트 README에만 둔다.
2. 현재 설계 결정은 `mvp-design.md`에 둔다.
3. 기능별 입력, 출력, 완료 기준은 `feature-breakdown.md`에 둔다.
4. 과거 계획과 참조 분석은 구현 계약으로 보지 않는다.
5. 같은 내용이 여러 문서에 필요하면 README는 짧은 사용법, 설계 문서는 결정 이유, 기능 문서는 구현 경계만 남긴다.
