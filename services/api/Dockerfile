# syntax=docker/dockerfile:1
#
# The REST API. Everything is copied from the `core` build context, which
# compose builds first from services/core/Dockerfile — so this image holds only
# what the service runs: production dependencies, the compiled API, and the
# compiled core it imports. No toolchain, no sources, no dev dependencies.

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=core /runtime/node_modules node_modules
COPY --from=core /runtime/package.json ./
COPY --from=core /services/core/package.json services/core/
COPY --from=core /services/core/dist services/core/dist
COPY --from=core /services/api/package.json services/api/
COPY --from=core /services/api/dist services/api/dist

USER node
EXPOSE 3000
CMD ["node", "services/api/dist/index.js"]
