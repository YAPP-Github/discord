# YAPP Discord Bot

YAPP 커뮤니티 운영을 위한 Discord 봇입니다.

## 기능 (예정)

- GitHub 이메일 입력 -> 자동 멤버 추가
- 채널 히스토리/위키 기반 Q&A 자동 응답 (Claude API + RAG)
- 출석 체크 공지 (cron 기반)
- 스터디 모집 게시
- 스터디 승인 -> 자동 채널 생성 및 관리

## 시작하기

### 사전 준비

- Node.js 20 이상
- Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- Claude API Key ([Anthropic Console](https://console.anthropic.com/))

### 설치

```bash
git clone https://github.com/YAPP-Github/slack.git yapp-slack
cd yapp-slack
npm install
```

### 환경 변수 설정

```bash
cp .env.example .env
# .env 파일을 열어 토큰과 키를 입력하세요
```

### Discord Bot 설정

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 봇의 **Privileged Gateway Intents**를 활성화하세요:
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT`
2. 봇을 서버에 초대하세요 (필요 권한: `bot`, `applications.commands`)

### 슬래시 커맨드 등록

```bash
npm run deploy-commands
```

### 실행

```bash
# 개발 모드 (자동 재시작)
npm run dev

# 프로덕션
npm run build
npm start
```

## 프로젝트 구조

```
src/
├── index.ts          # 엔트리 포인트
├── config.ts         # 환경 변수 관리
├── client.ts         # Discord 클라이언트 확장
├── commands/         # 슬래시 커맨드
├── events/           # Discord 이벤트 핸들러
├── services/         # 비즈니스 로직 (Claude, GitHub 등)
├── db/               # 데이터베이스 (SQLite)
├── types/            # TypeScript 타입 정의
├── loaders/          # 커맨드/이벤트 동적 로더
└── utils/            # 유틸리티 함수
```

## 기여 방법

1. 이슈를 생성하거나 기존 이슈를 확인합니다
2. 브랜치를 생성합니다: `git checkout -b feature/기능명`
3. 변경사항을 커밋합니다: `git commit -m "feat: 기능 설명"`
4. PR을 생성합니다

## 라이선스

MIT
