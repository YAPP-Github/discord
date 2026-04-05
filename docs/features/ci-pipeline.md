# LLD — CI 파이프라인

> **관련 이슈**: #3
> **상태**: implemented
> **최종 수정**: 2026-04-06

---

## 개요

PR 생성 및 main 브랜치 push 시 코드 품질 검사(lint, format, typecheck, build)를 자동으로 실행한다. Node.js 20, 22 두 버전에서 동시에 검증한다.

## 목표

- 코드 품질 기준 미달 코드가 main에 merge되는 것 방지
- 다중 Node.js 버전 호환성 보장

## 범위 (Scope)

**포함**:
- ESLint 검사
- Prettier 포맷 검사
- TypeScript 타입 검사
- TypeScript 빌드

**제외**:
- 테스트 실행 (테스트 코드 미작성)
- 서버 배포

---

## 권한

해당 없음 (GitHub Actions 파이프라인)

---

## 슬래시 커맨드

해당 없음

---

## 데이터 흐름

```
PR 생성 또는 main push
  → GitHub Actions 트리거 (ci.yml)
  → Node.js 20, 22 병렬 실행 (matrix)
    → npm ci
    → npm run lint
    → npm run format:check
    → npm run typecheck
    → npm run build
  → 모두 통과 시 merge 가능
```

---

## DB 스키마

해당 없음

---

## 배치 / 스케줄

| 항목 | 내용 |
|------|------|
| 트리거 | push to main, PR to main |
| 실행 환경 | ubuntu-latest |
| Node.js 버전 | 20, 22 (matrix) |

---

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| lint 실패 | Actions 실패 → PR merge 차단 |
| format 불일치 | Actions 실패 → PR merge 차단 |
| 타입 에러 | Actions 실패 → PR merge 차단 |
| 빌드 실패 | Actions 실패 → PR merge 차단 |

---

## 미결 사항 (Open Questions)

- [ ] PR merge 차단 규칙(Branch Protection Rule) 설정 여부
