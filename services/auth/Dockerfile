FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY package*.json ./
COPY services/auth/package*.json ./services/auth/
COPY packages/shared-types/package*.json ./packages/shared-types/
RUN npm ci --workspace=@nexcrm/auth --workspace=@nexcrm/shared-types

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared-types ./packages/shared-types
COPY services/auth ./services/auth
WORKDIR /app/services/auth
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/services/auth/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 4001
CMD ["node", "dist/index.js"]
