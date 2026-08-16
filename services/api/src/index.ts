import { ConfigError, createChainClients, TodoService } from '@todo/core';
import { pino } from 'pino';
import { createApp } from './app.js';
import { loadApiConfig } from './config.js';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  // Redaction is a safety net, not the control: nothing intentionally logs a
  // credential. It exists so an accidental object spread cannot leak one.
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.privateKey'],
});

function start(): void {
  let config;

  try {
    config = loadApiConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.fatal(`${error.message}\n\nCopy .env.example to .env and fill in the missing values.`);
      process.exit(1);
    }
    throw error;
  }

  const clients = createChainClients(config.core);
  const service = new TodoService(clients, config.core);
  const app = createApp({
    service,
    logger,
    corsOrigin: config.corsOrigin,
    contractAddress: config.core.contractAddress,
  });

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, signer: clients.account.address, contract: config.core.contractAddress },
      'REST API listening',
    );
  });

  // Finish in-flight requests before exiting. A write may be waiting on a
  // receipt, and dropping it would lose the caller's transaction hash.
  const shutdown = (signal: string) => () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
}

start();
