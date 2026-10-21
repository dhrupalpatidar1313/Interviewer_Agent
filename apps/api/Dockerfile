# The API, built from the repository root so it installs exactly what package-lock.json says:
#   docker build -f apps/api/Dockerfile -t interviewer-api .
FROM node:22-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/agent/package.json apps/agent/

FROM deps AS build
RUN npm ci -w apps/api --no-audit --no-fund
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
RUN npm run build -w apps/api

FROM deps AS prod-deps
RUN npm ci -w apps/api --omit=dev --no-audit --no-fund

FROM node:22-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update -qq && apt-get install --no-install-recommends -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node --from=prod-deps /repo/node_modules ./node_modules
COPY --chown=node:node --from=build /repo/apps/api/dist ./apps/api/dist
COPY --chown=node:node apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/server.js"]
