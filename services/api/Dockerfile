# syntax=docker/dockerfile:1.7
# Imagen de la API de COROC (Node.js 22 LTS). Se construye desde la raíz del monorepo:
#   docker build -f services/api/Dockerfile -t coroc-api .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY services/api/package.json services/api/
COPY apps/prototype/package.json apps/prototype/
RUN npm ci --workspace @coroc/core --workspace @coroc/api --include-workspace-root=false
COPY packages/core packages/core
COPY services/api services/api
RUN npm run build -w @coroc/core && npm run build -w @coroc/api \
 && npm prune --omit=dev --workspace @coroc/core --workspace @coroc/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN groupadd -r coroc && useradd -r -g coroc coroc
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/core/package.json ./packages/core/package.json
COPY --from=build /repo/packages/core/dist ./packages/core/dist
COPY --from=build /repo/services/api/package.json ./services/api/package.json
COPY --from=build /repo/services/api/dist ./services/api/dist
COPY --from=build /repo/services/api/i18n ./services/api/i18n
COPY --from=build /repo/services/api/db/migrations ./services/api/db/migrations
COPY --from=build /repo/services/api/openapi.yaml ./services/api/openapi.yaml
USER coroc
WORKDIR /app/services/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
