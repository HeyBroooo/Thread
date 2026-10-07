FROM node:22-bookworm-slim AS base

WORKDIR /workspace
COPY . .
RUN npm ci --include=dev

FROM base AS api
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "run", "start", "--workspace", "@cbi/api"]

FROM base AS web
ARG API_PROXY_TARGET=http://localhost:8787
ENV API_PROXY_TARGET=${API_PROXY_TARGET}
ENV NODE_ENV=production
RUN npm run build --workspace @cbi/web
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@cbi/web"]