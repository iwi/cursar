# Cursar game server: serves the page and the game connection on one port.
# HTTPS is handled in front of it (a hosting platform, or Caddy/nginx); see docs/DEPLOY.md.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/game-core/package.json packages/game-core/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=1
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://localhost:${PORT}/health" || exit 1
CMD ["npm", "run", "start", "-w", "@cursar/server"]
