FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY server ./server
COPY shared ./shared
COPY web ./web
COPY scripts/build-server.mjs ./scripts/build-server.mjs
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/build-server ./build-server
COPY --from=build /app/dist ./dist
COPY sdk ./sdk
# Exported graphs read these originals; imported user source never executes.
COPY server/runtime.ts server/graph.ts server/sandbox.ts server/pricing.ts ./server/
COPY shared/types.ts ./shared/types.ts
USER node
ENV NODE_ENV=production NODE_OPTIONS=--max-old-space-size=512 PORT=3001 HOST=0.0.0.0 WORKBENCH_DEV=0 WORKBENCH_DATA_DIR=/app/uploads/workspaces WORKBENCH_SECRETS_FILE=/no-local-secrets PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build-server/index.mjs"]
