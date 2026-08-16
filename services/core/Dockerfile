# syntax=docker/dockerfile:1
#
# core is a library, not a service: it has no entrypoint and never runs on its
# own. This image is what the runnable services build from — the workspace
# installed once and every package compiled once — so api and mcp do not each
# repeat that work and cannot end up built from different code.
#
# It is referenced by the other Dockerfiles as a named build context, which
# compose wires up (see `additional_contexts` in docker-compose.yml). Building
# it directly is only useful for debugging:
#
#   docker build -f services/core/Dockerfile .

# Manifests alone, so editing a source file does not invalidate the install.
FROM node:22-alpine AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/core/package.json services/core/
COPY services/api/package.json services/api/
COPY services/mcp/package.json services/mcp/
COPY services/web/package.json services/web/

# What the services actually run with. A second install rather than a prune, so
# the result is exactly what the lockfile says production needs.
FROM manifests AS runtime-deps
RUN npm ci --omit=dev

FROM manifests AS compiled
RUN npm ci
COPY tsconfig.base.json tsconfig.json ./
COPY services services
RUN npm run build

# A file bundle rather than a runnable image: the services copy out of it.
FROM scratch
COPY --from=runtime-deps /app/node_modules /runtime/node_modules
COPY --from=runtime-deps /app/package.json /runtime/package.json
COPY --from=compiled /app/services /services
