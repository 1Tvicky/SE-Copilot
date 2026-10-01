# Build from the monorepo root: docker build -f apps/web/Dockerfile .
FROM node:20-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN npm ci

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=apps/web

FROM node:20-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
