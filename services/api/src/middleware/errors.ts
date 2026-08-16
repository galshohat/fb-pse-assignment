import {
  explorerTransactionUrl,
  isTodoError,
  TaskAlreadyCompletedError,
  TaskNotFoundError,
  TransactionTimeoutError,
  ValidationError,
  type TodoErrorCode,
} from '@todo/core';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';

/**
 * How each core failure is presented over HTTP.
 *
 * The two choices worth explaining:
 *
 * - A revert is 422 rather than 500. The request was well-formed and the
 *   service worked correctly; the contract declined it.
 * - A confirmation timeout is 202, not an error at all. The transaction was
 *   accepted by the network and may still be mined, so the response carries
 *   its hash and says the outcome is not yet known. Reporting a failure here
 *   would be wrong and would lose the hash.
 */
const STATUS_BY_CODE: Record<TodoErrorCode, number> = {
  VALIDATION_FAILED: 400,
  TASK_NOT_FOUND: 404,
  TASK_ALREADY_COMPLETED: 409,
  TRANSACTION_REVERTED: 422,
  TRANSACTION_TIMEOUT: 202,
  CHAIN_UNAVAILABLE: 503,
  UNEXPECTED_CHAIN_ERROR: 502,
};

/** Errors raised by the HTTP layer itself, before or around a core call. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFoundHandler: RequestHandler = (req) => {
  throw new HttpError(404, 'ROUTE_NOT_FOUND', `${req.method} ${req.path} is not a route`);
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifies error handlers by arity, so `next` must stay declared
  // even though the response is terminal.
  return (error, req, res, _next) => {
    if (error instanceof TransactionTimeoutError) {
      logger.warn(
        { transactionHash: error.transactionHash, path: req.path },
        'transaction submitted but not confirmed in time',
      );

      res.status(202).json({
        status: 'pending',
        message:
          'The transaction was submitted but has not confirmed yet. It may still be mined; track it with the hash below.',
        transaction: {
          hash: error.transactionHash,
          explorerUrl: explorerTransactionUrl(error.transactionHash),
        },
      });
      return;
    }

    if (isTodoError(error)) {
      const status = STATUS_BY_CODE[error.code];

      // A 5xx means our service or its dependencies misbehaved, which is worth
      // an error-level log. A 4xx is the caller being told "no" and is normal.
      const log = status >= 500 ? logger.error.bind(logger) : logger.info.bind(logger);
      log({ code: error.code, path: req.path }, error.message);

      if (status === 503) res.set('Retry-After', '5');

      res
        .status(status)
        .json({ error: { code: error.code, message: error.message, ...details(error) } });
      return;
    }

    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }

    // Body parsing fails before any handler runs, so these never reach route
    // validation. Without this they would surface as 500s, which would blame
    // the service for a malformed or oversized request.
    const bodyProblem = describeBodyParserError(error);
    if (bodyProblem) {
      logger.info({ code: bodyProblem.code, path: req.path }, bodyProblem.message);
      res
        .status(bodyProblem.status)
        .json({ error: { code: bodyProblem.code, message: bodyProblem.message } });
      return;
    }

    // Anything reaching here is a bug. Log it in full; tell the client nothing
    // beyond the fact that it failed.
    logger.error({ err: error, path: req.path }, 'unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  };
}

interface BodyProblem {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/** Recognises the errors `express.json()` raises for a request it cannot read. */
function describeBodyParserError(error: unknown): BodyProblem | undefined {
  if (typeof error !== 'object' || error === null || !('type' in error)) return undefined;

  switch ((error as { type: unknown }).type) {
    case 'entity.too.large':
      return {
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
      };
    case 'entity.parse.failed':
      return {
        status: 400,
        code: 'MALFORMED_JSON',
        message: 'Request body is not valid JSON',
      };
    default:
      return undefined;
  }
}

/** Structured extras a client can act on, without leaking internals. */
function details(error: unknown): { details?: Record<string, unknown> } {
  if (error instanceof ValidationError && error.field) {
    return { details: { field: error.field } };
  }
  if (error instanceof TaskNotFoundError || error instanceof TaskAlreadyCompletedError) {
    return { details: { taskId: error.taskId } };
  }
  return {};
}
