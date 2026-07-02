FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# Full workspace install so the @nexcrm/ui-components (and other) workspaces are
# present for the Next build. Per-workspace installs miss sibling workspaces.
FROM base AS deps
COPY . .
RUN npm install

FROM base AS builder
COPY --from=deps /app ./
WORKDIR /app/apps/web
ENV NEXT_OUTPUT=standalone
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
# Next.js standalone output bundles the server + traced node_modules.
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
