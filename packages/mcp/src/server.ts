import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
} from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { TodoService } from '@todo/core';
import type { Express, RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { AuditLog } from './audit.js';
import type { CredentialVerifier } from './auth/verifier.js';
import { buildServer } from './tools.js';

export interface McpAppOptions {
  readonly service: TodoService;
  readonly audit: AuditLog;
  readonly verifier: CredentialVerifier;
  readonly logger: Logger;
  /** Public base URL, used as the OAuth resource identifier. */
  readonly publicUrl: string;
  /** OAuth authorization-server routes, mounted at the application root. */
  readonly oauthRoutes?: RequestHandler[];
}

/**
 * Builds the MCP HTTP application.
 *
 * The transport is Streamable HTTP rather than stdio. That is what makes
 * authentication possible at all: stdio inherits whatever the parent process
 * can do, whereas an HTTP request carries a credential that this server can
 * verify on every call.
 *
 * A fresh MCP server is constructed for each request from that request's
 * identity, which is what lets the tool list itself depend on the caller's
 * scopes.
 */
export function createMcpApp({
  service,
  audit,
  verifier,
  logger,
  publicUrl,
  oauthRoutes = [],
}: McpAppOptions): Express {
  const app = createMcpExpressApp();

  // Must be mounted at the root: discovery paths are well-known and absolute.
  for (const route of oauthRoutes) app.use(route);

  const handler = createMcpHandler((ctx) =>
    buildServer({ service, audit, authInfo: ctx.authInfo }),
  );
  const node = toNodeHandler(handler);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mcp' });
  });

  app.all(
    '/mcp',
    requireBearerAuth({
      verifier: { verifyAccessToken: verifier.verifyAccessToken },
      // Points a rejected client at the metadata describing how to get a
      // token, which is what lets an MCP client start the OAuth flow from a
      // bare 401 without being configured for it.
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(publicUrl)),
    }),
    (req, res) => {
      void node(req, res, req.body);
    },
  );

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  logger.debug('MCP application constructed');
  return app;
}
