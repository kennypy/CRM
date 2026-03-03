FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY package*.json ./
COPY services/graph-core/package*.json ./services/graph-core/
COPY packages/shared-types/package*.json ./packages/shared-types/
RUN npm ci --workspace=@nexcrm/graph-core --workspace=@nexcrm/shared-types

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared-types ./packages/shared-types
COPY services/graph-core ./services/graph-core
COPY infra ./infra
WORKDIR /app/services/graph-core
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/services/graph-core/dist ./dist
COPY --from=builder /app/infra ./infra
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 4002
CMD ["node", "dist/index.js"]
