import { type TodoService, type WriteResult } from '@todo/core';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errors.js';
import { addTaskBody, taskIdParam } from '../schemas.js';

/**
 * Task endpoints.
 *
 * Writes are wrapped by `writeLimiter` because each one spends gas; the limiter
 * is supplied by the caller so it can be disabled in tests.
 */
export function createTaskRoutes(service: TodoService, writeLimiter: RequestHandler): Router {
  const router = Router();

  // Express 5 forwards rejected promises to the error handler, so these
  // handlers can stay free of try/catch.
  router.get('/tasks', async (_req, res) => {
    res.json(await service.getTasks());
  });

  router.post('/tasks', writeLimiter, async (req, res) => {
    const body = addTaskBody.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, 'VALIDATION_FAILED', describe(body.error, 'description'));
    }

    const result = await service.addTask(body.data.description);
    res.status(201).json(confirmed(result));
  });

  router.post('/tasks/:id/complete', writeLimiter, async (req, res) => {
    const id = taskIdParam.safeParse(req.params.id);

    if (!id.success) {
      throw new HttpError(400, 'VALIDATION_FAILED', describe(id.error, 'id'));
    }

    const result = await service.completeTask(id.data);
    res.json(confirmed(result));
  });

  return router;
}

/**
 * The response shape for a write. `status` is always `confirmed` here: the
 * service only returns once a receipt has been seen, and an unconfirmed
 * transaction leaves through the 202 path in the error handler instead.
 */
function confirmed(result: WriteResult) {
  return { status: 'confirmed', task: result.task, transaction: result.transaction };
}

function describe(error: z.ZodError, field: string): string {
  return `${field} ${error.issues[0]?.message ?? 'is invalid'}`;
}
