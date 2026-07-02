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
# next.config headers() are baked at build time. COOKIE_SECURE=false drops the
# HTTPS-forcing headers (HSTS + CSP upgrade-insecure-requests) so plain-HTTP
# LAN/self-hosted deploys work; set to "true" for HTTPS builds.
ARG COOKIE_SECURE=false
ENV COOKIE_SECURE=$COOKIE_SECURE
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
# Next.js standalone output bundles the server + traced node_modules.
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
