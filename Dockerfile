# One image that serves both the API and the built Angular app on one port.
#   docker build -t casino .
#   docker run --env-file .env.production -p 3000:3000 casino

# ---------------------------------------------------------------- build
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NX_DAEMON=false \
    NX_NO_CLOUD=true \
    NX_SKIP_NX_CACHE=true \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm nx run-many -t build -p api web --configuration=production \
 && pnpm prune --prod

# ---------------------------------------------------------------- runtime
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/dist/apps/web/browser

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
# Migrations, the admin bootstrap script and the generated Prisma client they import.
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=node:node /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build --chown=node:node /app/apps/api/src/generated ./apps/api/src/generated
COPY --chown=node:node docker/start.sh ./start.sh

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "./start.sh"]
