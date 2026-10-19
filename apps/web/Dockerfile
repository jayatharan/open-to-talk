# Build from the monorepo root:  docker build -f apps/web/Dockerfile -t open2talk .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# Prune the monorepo down to the web app and its workspace dependencies.
FROM base AS prune
COPY . .
RUN npx -y turbo@2 prune @open2talk/web --docker

FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm --filter @open2talk/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
