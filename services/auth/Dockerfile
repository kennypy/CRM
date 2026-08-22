FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# Full workspace install so hoisted deps (e.g. ioredis, otel, fastify plugins)
# resolve exactly as they do in the monorepo dev env. Per-workspace installs
# miss deps that services rely on via hoisting.
FROM base AS deps
COPY . .
RUN npm install

FROM base AS builder
COPY --from=deps /app ./
WORKDIR /app/services/auth
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/services/auth/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/services/auth/package.json ./package.json
# @nexcrm/shared-types' package "main" points at .ts (unloadable at runtime).
# Replace the workspace symlink with the compiled JS emitted alongside dist.
RUN if [ -d dist/packages/shared-types/src ]; then \
      rm -rf node_modules/@nexcrm/shared-types && \
      cp -r dist/packages/shared-types/src node_modules/@nexcrm/shared-types && \
      printf '{"name":"@nexcrm/shared-types","main":"index.js"}' > node_modules/@nexcrm/shared-types/package.json && \
      chown -R node:node node_modules/@nexcrm; \
    fi
RUN if [ -d dist/packages/service-common/src ]; then \
      rm -rf node_modules/@nexcrm/service-common && \
      cp -r dist/packages/service-common/src node_modules/@nexcrm/service-common && \
      printf '{"name":"@nexcrm/service-common","exports":{"./*":"./*.js"}}' > node_modules/@nexcrm/service-common/package.json && \
      chown -R node:node node_modules/@nexcrm; \
    fi
USER node
EXPOSE 4001
CMD ["node", "dist/services/auth/src/index.js"]
