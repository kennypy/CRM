FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY package*.json ./
COPY services/api-gateway/package*.json ./services/api-gateway/
COPY packages/shared-types/package*.json ./packages/shared-types/
RUN npm ci --workspace=@nexcrm/api-gateway --workspace=@nexcrm/shared-types

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared-types ./packages/shared-types
COPY services/api-gateway ./services/api-gateway
WORKDIR /app/services/api-gateway
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
# Run unprivileged using the "node" user (uid 1000) shipped by node:20-alpine.
COPY --from=builder --chown=node:node /app/services/api-gateway/dist ./dist
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
