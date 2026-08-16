import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { TodoService } from '@todo/core';
import type { Express } from 'express';
import type { Logger } from 'pino';
import type { AuditLog } from './audit.js';
import type { CredentialVerifier } from './auth/verifier.js';
import { buildServer } from './tools.js';

export interface McpAppOptions {
  readonly service: TodoService;
  readonly audit: AuditLog;
  readonly verifier: CredentialVerifier;
  readonly logger: Logger;
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
export function createMcpApp({ service, audit, verifier, logger }: McpAppOptions): Express {
  const app = createMcpExpressApp();

  const handler = createMcpHandler((ctx) =>
    buildServer({ service, audit, authInfo: ctx.authInfo }),
  );
  const node = toNodeHandler(handler);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mcp' });
  });

  app.all(
    '/mcp',
    requireBearerAuth({ verifier: { verifyAccessToken: verifier.verifyAccessToken } }),
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
