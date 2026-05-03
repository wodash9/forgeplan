FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_FORGEPLAN_API_BASE_URL=""
ENV VITE_FORGEPLAN_API_BASE_URL=$VITE_FORGEPLAN_API_BASE_URL
RUN npm run typecheck && npm run build:web

FROM nginx:1.27-alpine
COPY ops/nginx/forgeplan.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist-web /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q --spider http://127.0.0.1/ || exit 1
