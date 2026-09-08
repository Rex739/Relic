# Public Layer B gateway for the Relic Grid Trader.
#
# Northflank currently supplies the repository root as the effective Docker
# context for this service, even when the service UI is set to this agent
# directory. Keep the Dockerfile rooted at the repository so both the build
# context and every COPY source are unambiguous.
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

WORKDIR /workspace

COPY agents/RelicGridTrader/package.json ./package.json
COPY agents/RelicGridTrader/pnpm-lock.yaml ./pnpm-lock.yaml
COPY agents/RelicGridTrader/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY agents/RelicGridTrader/app/service/package.json ./app/service/package.json
RUN pnpm install --frozen-lockfile

COPY agents/RelicGridTrader/app/service ./app/service
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
