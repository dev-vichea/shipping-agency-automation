FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
ARG SHIPPING_INTERNAL_API_URL=http://api:8000
ENV SHIPPING_INTERNAL_API_URL=$SHIPPING_INTERNAL_API_URL NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN chown node:node /app && corepack enable
USER node
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
RUN pnpm build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
