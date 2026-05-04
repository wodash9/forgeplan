FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_FORGEPLAN_API_BASE_URL=""
ARG VITE_FORGEPLAN_USER_ADMIN_API_BASE_URL=""
ARG VITE_AUTH_MODE="keycloak"
ARG VITE_KEYCLOAK_URL="https://auth.etharlia.com"
ARG VITE_KEYCLOAK_REALM="etharlia"
ARG VITE_KEYCLOAK_CLIENT_ID="forgeplan-spa"
ARG VITE_KEYCLOAK_ROLE_CLIENT_ID="forgeplan-spa"
ENV VITE_FORGEPLAN_API_BASE_URL=$VITE_FORGEPLAN_API_BASE_URL
ENV VITE_FORGEPLAN_USER_ADMIN_API_BASE_URL=$VITE_FORGEPLAN_USER_ADMIN_API_BASE_URL
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
ENV VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM
ENV VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID
ENV VITE_KEYCLOAK_ROLE_CLIENT_ID=$VITE_KEYCLOAK_ROLE_CLIENT_ID
RUN npm run typecheck && npm test && npm run build && npm run build:web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
ENV FORGEPLAN_PORT=80
ENV FORGEPLAN_HOST=0.0.0.0
ENV FORGEPLAN_UNSAFE_BIND_ALL=1
ENV FORGEPLAN_STATIC_DIR=/app/dist-web
ENV FORGEPLAN_DB=/data/forgeplan.db
ENV FORGEPLAN_API_ACCESS_MODE=keycloak
ENV FORGEPLAN_CORS_ALLOW_ORIGIN=https://forgeplan.etharlia.com
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN mkdir -p /data
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-web ./dist-web
COPY scripts ./scripts
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/forgeplan-server.mjs"]
