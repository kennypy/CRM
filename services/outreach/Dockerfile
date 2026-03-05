FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY services/outreach/package*.json ./services/outreach/
COPY packages/shared-types/package*.json ./packages/shared-types/
RUN npm ci --workspace=@nexcrm/outreach --workspace=@nexcrm/shared-types

COPY packages/shared-types ./packages/shared-types
COPY services/outreach ./services/outreach
RUN npm run build --workspace=@nexcrm/outreach

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/services/outreach/dist ./dist
COPY --from=builder /app/services/outreach/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 4003
CMD ["node", "dist/index.js"]
