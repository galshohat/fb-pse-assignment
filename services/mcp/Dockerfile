# syntax=docker/dockerfile:1
#
# The MCP server. Built the same way as the API — everything copied from the
# `core` build context — with one addition: a data directory for the hashed
# credentials and the audit trail, which compose mounts as a named volume so
# they outlive a rebuild.

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production MCP_DATA_DIR=/data

COPY --from=core /runtime/node_modules node_modules
COPY --from=core /runtime/package.json ./
COPY --from=core /services/core/package.json services/core/
COPY --from=core /services/core/dist services/core/dist
COPY --from=core /services/mcp/package.json services/mcp/
COPY --from=core /services/mcp/dist services/mcp/dist

# Owned by `node`, because the server writes to it as that user.
RUN mkdir /data && chown node:node /data

USER node
EXPOSE 3001
CMD ["node", "services/mcp/dist/index.js"]
