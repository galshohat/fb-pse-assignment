import { join } from 'node:path';
import { ConfigError, createChainClients, TodoService } from '@todo/core';
import { pino } from 'pino';
import { AuditLog } from './audit.js';
import { CredentialStore } from './auth/store.js';
import { createOAuthRoutes } from './auth/oauth/router.js';
import { TodoOAuthProvider } from './auth/oauth/provider.js';
import { AccessTokenRegistry, CredentialVerifier } from './auth/verifier.js';
import { loadMcpConfig } from './config.js';
import { createMcpApp } from './server.js';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: ['req.headers.authorization', '*.privateKey', '*.token'],
});

function start(): void {
  let config;

  try {
    config = loadMcpConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.fatal(`${error.message}\n\nCopy .env.example to .env and fill in the missing values.`);
      process.exit(1);
    }
    throw error;
  }

  const store = CredentialStore.forDataDir(config.dataDir);
  const accessTokens = new AccessTokenRegistry();
  const verifier = new CredentialVerifier(store, accessTokens);
  const audit = new AuditLog(join(config.dataDir, 'audit.jsonl'), logger);

  const provider = new TodoOAuthProvider({
    store,
    accessTokens,
    verifier,
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
  });

  const clients = createChainClients(config.core);
  const service = new TodoService(clients, config.core);

  const app = createMcpApp({
    service,
    audit,
    verifier,
    logger,
    publicUrl: config.publicUrl,
    oauthRoutes: createOAuthRoutes({
      provider,
      store,
      issuerUrl: config.publicUrl,
      logger,
    }),
  });

  const liveKeys = store.apiKeys.filter((key) => !key.revokedAt).length;
  if (liveKeys === 0) {
    logger.warn(
      'No API keys exist yet. Issue one with: npm run keys -w @todo/mcp -- issue --role operator',
    );
  }

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, publicUrl: config.publicUrl, signer: clients.account.address },
      'MCP server listening',
    );
  });

  const shutdown = (signal: string) => () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
}

start();
