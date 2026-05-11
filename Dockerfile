# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────
# Stage 1: base — 공통 베이스 (Node 버전 고정)
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app

# ─────────────────────────────────────────────────────────────
# Stage 2: deps — 모든 의존성 설치 (better-sqlite3 네이티브 빌드용 toolchain 포함)
# ─────────────────────────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare && npm ci

# ─────────────────────────────────────────────────────────────
# Stage 3: build — TypeScript 컴파일 → dist/
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─────────────────────────────────────────────────────────────
# Stage 4: prod-deps — production 의존성만 (네이티브 모듈 재빌드)
# ─────────────────────────────────────────────────────────────
FROM base AS prod-deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare && npm ci --omit=dev && npm cache clean --force

# ─────────────────────────────────────────────────────────────
# Stage 5: runtime — 최종 실행 이미지
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=prod \
    HTTP_PORT=3000 \
    DATABASE_PATH=/app/data/bot.db

RUN apk add --no-cache tini \
    && addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/data \
    && chown -R app:app /app

COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build     --chown=app:app /app/dist         ./dist
COPY --chown=app:app package.json ./

USER app

VOLUME ["/app/data"]
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
