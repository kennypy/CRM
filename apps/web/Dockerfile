FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages/shared-types/package*.json ./packages/shared-types/
RUN npm ci --workspace=@nexcrm/web --workspace=@nexcrm/shared-types

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared-types ./packages/shared-types
COPY apps/web ./apps/web
WORKDIR /app/apps/web
ENV NEXT_OUTPUT=standalone
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
# Run unprivileged. The node:20-alpine image ships a "node" user (uid 1000);
# chown the copied artifacts so the standalone server runs as non-root.
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
