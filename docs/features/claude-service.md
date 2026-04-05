# LLD — Claude API 서비스

> **관련 이슈**: -
> **상태**: implemented
> **최종 수정**: 2026-04-06

---

## 개요

Anthropic Claude API 클라이언트를 싱글톤으로 관리하는 서비스. `ANTHROPIC_API_KEY` 미설정 시 에러를 발생시키며, 처음 호출 시에만 인스턴스를 생성한다(지연 초기화).

## 목표

- Claude API 클라이언트를 중앙에서 단일 인스턴스로 관리
- API 키 미설정 시 명확한 에러 메시지 제공

## 범위 (Scope)

**포함**:
- Claude API 클라이언트 싱글톤 인스턴스 관리
- API 키 유효성 검사

**제외**:
- 실제 Claude API 호출 (각 기능에서 직접 호출)
- 응답 캐싱

---

## 권한

해당 없음 (내부 서비스)

---

## 슬래시 커맨드

해당 없음

---

## 데이터 흐름

```
기능에서 getClaudeClient() 호출
  → client 인스턴스 존재 여부 확인
  → 없으면: ANTHROPIC_API_KEY 확인
    → 미설정 시 Error("ANTHROPIC_API_KEY is not configured") throw
    → 설정 시 new Anthropic({ apiKey }) 인스턴스 생성
  → client 반환
```

---

## DB 스키마

해당 없음

---

## 배치 / 스케줄

해당 없음

---

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| `ANTHROPIC_API_KEY` 미설정 | `Error` throw → 호출한 기능에서 처리 |

---

## 미결 사항 (Open Questions)

- [ ] Claude API를 실제로 사용하는 기능 구현 시 모델명, 토큰 제한 등 파라미터 설계 필요
