FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY agents/health-factor-monitor/package.json agents/health-factor-monitor/package.json

RUN pnpm install --filter @relic/health-factor-monitor... --frozen-lockfile

COPY agents/health-factor-monitor/tsconfig.json agents/health-factor-monitor/tsconfig.build.json agents/health-factor-monitor/
COPY agents/health-factor-monitor/src agents/health-factor-monitor/src

RUN pnpm --filter @relic/health-factor-monitor build
RUN pnpm --filter @relic/health-factor-monitor deploy --prod --legacy /opt/relic-reference-runtime

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS runtime

ENV NODE_ENV=production
ENV PORT=8003

WORKDIR /app

COPY --from=build --chown=node:node /opt/relic-reference-runtime/ ./

USER node

EXPOSE 8003

CMD ["node", "dist/service.js"]
