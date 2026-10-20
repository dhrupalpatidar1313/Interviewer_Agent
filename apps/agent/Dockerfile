# Interviewer agent worker, built for `lk agent create` / `lk agent deploy` (run those from apps/agent).
# This directory is self-contained: it has no sibling workspace dependencies, so it builds on its own.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
# The LiveKit client reads the system CA bundle to reach wss:// servers, and slim Node images do not ship one.
# Without it Room.connect() fails against LiveKit Cloud with "failed to retrieve region info".
RUN apt-get update -qq && apt-get install --no-install-recommends -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
# Fetch the end-of-turn model files at build time so the first interview does not wait on a download.
RUN node dist/main.js download-files
CMD ["node", "dist/main.js", "start"]
