# Build from the monorepo root: docker build -f apps/worker/Dockerfile .
FROM node:20-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN npm ci

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=apps/worker
RUN npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001

COPY --from=build --chown=worker:nodejs /repo/node_modules ./node_modules
COPY --from=build --chown=worker:nodejs /repo/package.json ./package.json
COPY --from=build --chown=worker:nodejs /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=worker:nodejs /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=worker:nodejs /repo/packages/db/dist ./packages/db/dist
COPY --from=build --chown=worker:nodejs /repo/packages/db/prisma ./packages/db/prisma
COPY --from=build --chown=worker:nodejs /repo/packages/db/package.json ./packages/db/package.json
COPY --from=build --chown=worker:nodejs /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=worker:nodejs /repo/apps/worker/package.json ./apps/worker/package.json

USER worker
CMD ["node", "apps/worker/dist/index.js"]
