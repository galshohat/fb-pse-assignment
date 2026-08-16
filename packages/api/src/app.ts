import type { TodoService } from '@todo/core';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { createErrorHandler, notFoundHandler } from './middleware/errors.js';
import { createTaskRoutes } from './routes/tasks.js';

/** Task descriptions are capped well below this; anything larger is not ours. */
const MAX_BODY_SIZE = '16kb';

export interface AppOptions {
  readonly service: TodoService;
  readonly logger: Logger;
  readonly corsOrigin: string;
  /** Disabled in tests, where the limiter would only add flakiness. */
  readonly rateLimit?: boolean;
}

/**
 * Builds the HTTP application.
 *
 * Kept separate from the server bootstrap so tests can exercise the real
 * middleware stack against a mocked service, without binding a port.
 */
export function createApp({
  service,
  logger,
  corsOrigin,
  rateLimit: enableRateLimit = true,
}: AppOptions): Express {
  const app = express();

  // Trust exactly one proxy hop, so rate limiting keys on the real client IP
  // when running behind a reverse proxy without letting a client spoof it.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST'] }));
  app.use(express.json({ limit: MAX_BODY_SIZE }));
  app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => {
    // Liveness only: no RPC call, so a monitor polling this cannot be turned
    // into traffic against the rate-limited public endpoints.
    res.json({ status: 'ok', service: 'api' });
  });

  app.use(createTaskRoutes(service, enableRateLimit ? createWriteLimiter() : passthrough));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}

/**
 * Writes are rate limited because each one spends gas from a shared wallet:
 * an unthrottled caller drains it. Reads are not limited — they are free.
 */
function createWriteLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many write requests. Each one spends gas, so they are limited.',
      },
    },
  });
}

const passthrough: RequestHandler = (_req, _res, next) => next();
