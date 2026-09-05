# Public Layer B gateway for the Relic Grid Trader.
# Build context: agents/RelicGridTrader
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/service/package.json ./app/service/package.json
RUN pnpm install --frozen-lockfile

COPY app/service ./app/service
RUN pnpm --filter relic-grid-trader-service build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# The gateway has no runtime package dependencies; only its compiled code is
# copied into the production image. Private-agent credentials are injected by
# Northflank at runtime and never enter the image.
COPY --from=build /workspace/app/service/dist ./dist

USER node
EXPOSE 8003
CMD ["node", "dist/server.js"]
