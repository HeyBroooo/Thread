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
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NODE_ENV=production
RUN npm run build --workspace @cbi/web
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@cbi/web"]