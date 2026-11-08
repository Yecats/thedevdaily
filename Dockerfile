# The Dev Daily — home-server image: nginx serving the static build.
#
# There is no Node and no content in the image. Build the static pages on
# the host (`npm run build`), then mount ./dist read-only — mirroring how
# ./editions used to be mounted. Republishing an edition is another host-side
# `npm run build`; no container rebuild or restart involved.
#
# Build:  docker build -t devdaily .
# Run:    docker run -d --name devdaily -p 8787:80 -v ./dist:/usr/share/nginx/html:ro devdaily
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
