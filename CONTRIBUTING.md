# 기여 가이드

## 브랜치 전략

```
main           # 배포 브랜치
feat/기능명     # 새로운 기능
fix/버그명      # 버그 수정
chore/작업명    # 설정, 의존성 등 기타 작업
docs/문서명     # 문서 수정
```

## 커밋 컨벤션

[Conventional Commits](https://www.conventionalcommits.org/) 를 따릅니다.

```
<type>: <제목>

<본문> (선택)
```

### 타입

| 타입 | 설명 |
|------|------|
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `refactor` | 리팩토링 (기능 변경 없음) |
| `chore` | 빌드, 설정, 의존성 변경 |
| `docs` | 문서 수정 |
| `style` | 코드 포맷, 세미콜론 누락 등 (로직 변경 없음) |
| `test` | 테스트 추가 또는 수정 |

### 예시

```
feat: 스터디 모집 슬래시 커맨드 추가
fix: 출결 채널 메시지 중복 발송 버그 수정
chore: discord.js 버전 업데이트
```

## PR 가이드

1. `main` 브랜치에서 작업 브랜치를 생성합니다
2. 작업 완료 후 PR을 생성합니다
3. PR 제목은 커밋 컨벤션과 동일한 형식을 사용합니다
4. PR 템플릿의 체크리스트를 모두 확인합니다

## 개발 환경 설정

```bash
git clone https://github.com/YAPP-Github/slack.git yapp-slack
cd yapp-slack
npm install
cp .env.example .env
# .env에 토큰 입력 후
npm run dev
```
