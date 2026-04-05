# LLD 작성 스킬

새 기능의 LLD(Low-Level Design) 문서를 작성한다.

## 사용법

```
/lld <기능명>
```

예시: `/lld attendance`

## 절차

1. `docs/features/TEMPLATE.md`를 읽어 템플릿을 파악한다
2. `docs/features/<기능명>.md` 파일을 생성한다
   - 파일이 이미 존재하면 덮어쓰지 말고 사용자에게 알린다
3. 현재 기획 내용과 대화 컨텍스트를 바탕으로 템플릿의 각 섹션을 채운다
   - 확정되지 않은 항목은 비워두거나 `<!-- 미확정 -->` 으로 표시한다
   - Open Questions 섹션에 결정이 필요한 항목을 명시한다
4. `CLAUDE.md`의 LLD 목록에 새 파일 링크를 추가한다
   - `- (아직 작성된 LLD 없음)` 항목이 있으면 제거하고 링크로 교체한다
   - 이미 다른 LLD가 있으면 목록에 추가한다
5. 작성 완료 후 Open Questions 목록을 사용자에게 보여주고 확인을 요청한다

## 주의사항

- LLD는 구현 전에 작성한다
- HLD(`docs/HLD.md`)의 아키텍처와 일관성을 유지한다
- DB 스키마는 `src/db/schema.ts`의 기존 마이그레이션 패턴을 따른다
- 슬래시 커맨드 설계는 `src/types/index.ts`의 `Command` 인터페이스를 따른다
