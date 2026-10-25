FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
COPY . .
RUN --mount=type=cache,target=/root/.npm --mount=type=secret,id=environment_proxy_ca,target=/tmp/environment-proxy-ca.crt \
    if [ -f /tmp/environment-proxy-ca.crt ]; then export NODE_EXTRA_CA_CERTS=/tmp/environment-proxy-ca.crt; fi; \
    apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -r /var/lib/apt/lists/* && npm ci --include=dev && npm run db:generate
EXPOSE 2567
CMD ["npm", "run", "game:start"]

FROM base AS web
ARG NEXT_PUBLIC_MULTIPLAYER_URL
ENV NEXT_PUBLIC_MULTIPLAYER_URL=$NEXT_PUBLIC_MULTIPLAYER_URL
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
