# The Dev Daily — Linux container image.
# Build:  docker build -t devdaily .
# Run:    docker run -d --name devdaily -p 8787:8787 -v ./editions:/data/editions:ro devdaily
FROM node:22-slim

ENV NODE_ENV=production \
    DEVDAILY_EDITIONS=/data/editions \
    DEVDAILY_HOST=0.0.0.0 \
    DEVDAILY_PORT=8787

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY server.js .

# Run as an unprivileged user; the content volume is read-only anyway.
# (the node base image ships a non-root "node" user)
USER node

VOLUME ["/data/editions"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
