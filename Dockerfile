# Compile TypeScript and Angular once on BuildKit's native architecture; neither
# output contains platform-specific binaries.
FROM --platform=$BUILDPLATFORM node:25-alpine AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN apk add --no-cache python3 make g++ \
  && corepack enable \
  && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
COPY server/package.json ./server/package.json
RUN CI=true pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Native server dependencies (notably better-sqlite3) must match the target image.
FROM node:25-alpine AS runtime-deps
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN apk add --no-cache python3 make g++ \
  && corepack enable \
  && corepack prepare pnpm@10.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
COPY server/package.json ./server/package.json
RUN CI=true pnpm install --filter @hogaria/server --prod --frozen-lockfile \
  && pnpm --filter @hogaria/server --prod deploy --legacy /prod/server

# Runtime contains compiled assets and only server production dependencies.
FROM node:25-alpine AS production
WORKDIR /app

RUN apk add --no-cache curl tini libstdc++ \
  && mkdir -p /app/data

COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=runtime-deps /prod/server/node_modules ./server/node_modules

COPY --from=build /app/frontend/dist ./public

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/hogaria.sqlite
ENV PORT=3000
ENV NODE_OPTIONS=--max-old-space-size=256
ENV UV_THREADPOOL_SIZE=2

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]
