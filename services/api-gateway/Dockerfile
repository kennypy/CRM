FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# Full workspace install so hoisted deps (e.g. ioredis, otel, fastify plugins)
# resolve exactly as they do in the monorepo dev env.
FROM base AS deps
COPY . .
RUN npm install

FROM base AS builder
COPY --from=deps /app ./
WORKDIR /app/services/api-gateway
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/services/api-gateway/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/services/api-gateway/package.json ./package.json
RUN if [ -d dist/packages/shared-types/src ]; then \
      rm -rf node_modules/@nexcrm/shared-types && \
      cp -r dist/packages/shared-types/src node_modules/@nexcrm/shared-types && \
      printf '{"name":"@nexcrm/shared-types","main":"index.js"}' > node_modules/@nexcrm/shared-types/package.json && \
      chown -R node:node node_modules/@nexcrm; \
    fi
USER node
EXPOSE 4000
CMD ["node", "dist/services/api-gateway/src/index.js"]
