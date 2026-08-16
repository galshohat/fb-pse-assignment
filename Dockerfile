# syntax=docker/dockerfile:1
#
# One file, three images.
#
# The three services are deployed independently, but in a workspace monorepo
# they install and compile identically, so the install and build stages are
# shared. Docker's layer cache is then warm for all three, and the services
# cannot drift apart at build time the way three near-identical Dockerfiles
# eventually do. Each `target` below still produces its own standalone image
# with only what that service runs.

# --- shared: the manifests, which are all `npm ci` needs -------------------
# Copied separately from the sources so that editing code does not invalidate
# the install layer.
FROM node:22-alpine AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/mcp/package.json packages/mcp/
COPY packages/web/package.json packages/web/

# --- shared: compile everything --------------------------------------------
FROM manifests AS build
RUN npm ci
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
RUN npm run build

# --- shared: runtime dependencies only --------------------------------------
# A second install rather than a prune, so the result is exactly what the
# lockfile says production needs.
FROM manifests AS runtime-deps
RUN npm ci --omit=dev

# --- REST API ---------------------------------------------------------------
FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=runtime-deps /app/node_modules node_modules
COPY --from=runtime-deps /app/package.json ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/api/package.json packages/api/
COPY --from=build /app/packages/api/dist packages/api/dist
USER node
EXPOSE 3000
CMD ["node", "packages/api/dist/index.js"]

# --- MCP server -------------------------------------------------------------
FROM node:22-alpine AS mcp
WORKDIR /app
ENV NODE_ENV=production MCP_DATA_DIR=/data
COPY --from=runtime-deps /app/node_modules node_modules
COPY --from=runtime-deps /app/package.json ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/mcp/package.json packages/mcp/
COPY --from=build /app/packages/mcp/dist packages/mcp/dist
# Hashed credentials and the audit trail live on a volume mounted here. It is
# created owned by `node` because the server writes to it as that user.
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3001
CMD ["node", "packages/mcp/dist/index.js"]

# --- Web client -------------------------------------------------------------
# Static assets built above, served by nginx. The API URL is compiled into the
# bundle, and the browser resolves it from the host, not from this container.
FROM nginx:alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
