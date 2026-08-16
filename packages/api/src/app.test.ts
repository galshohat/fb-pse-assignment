import {
  ChainUnavailableError,
  TaskAlreadyCompletedError,
  TaskNotFoundError,
  TransactionRevertedError,
  TransactionTimeoutError,
  ValidationError,
  type TodoService,
  type WriteResult,
} from '@todo/core';
import { pino } from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

const TX_HASH = `0x${'cd'.repeat(32)}` as const;
const CONTRACT = `0x${'ab'.repeat(20)}` as const;

const writeResult: WriteResult = {
  task: { id: 7, description: 'ship it', completed: false },
  transaction: {
    hash: TX_HASH,
    explorerUrl: `https://sepolia.etherscan.io/tx/${TX_HASH}`,
    blockNumber: 100,
    gasUsed: '50000',
  },
};

const service = {
  getTasks: vi.fn(),
  addTask: vi.fn(),
  completeTask: vi.fn(),
};

/** Rate limiting is disabled here: it would make assertions order-dependent. */
const app = createApp({
  service: service as unknown as TodoService,
  logger: pino({ level: 'silent' }),
  corsOrigin: 'http://localhost:5173',
  contractAddress: CONTRACT,
  rateLimit: false,
});

beforeEach(() => vi.resetAllMocks());

describe('GET /tasks', () => {
  it('returns the task list as a plain array', async () => {
    service.getTasks.mockResolvedValue([{ id: 0, description: 'first', completed: true }]);

    const response = await request(app).get('/tasks').expect(200);

    expect(response.body).toEqual([{ id: 0, description: 'first', completed: true }]);
  });

  it('reports an unreachable chain as retryable rather than as a bug', async () => {
    service.getTasks.mockRejectedValue(new ChainUnavailableError());

    const response = await request(app).get('/tasks').expect(503);

    expect(response.headers['retry-after']).toBe('5');
    expect(response.body.error.code).toBe('CHAIN_UNAVAILABLE');
  });
});

describe('POST /tasks', () => {
  it('confirms a write and returns the transaction hash', async () => {
    service.addTask.mockResolvedValue(writeResult);

    const response = await request(app).post('/tasks').send({ description: 'ship it' }).expect(201);

    expect(response.body).toEqual({
      status: 'confirmed',
      task: writeResult.task,
      transaction: writeResult.transaction,
    });
  });

  it.each([
    ['a missing description', {}, 'description is required'],
    ['an empty description', { description: '' }, 'description must not be empty'],
    ['a non-string description', { description: 42 }, 'description must be a string'],
    [
      'an over-long description',
      { description: 'x'.repeat(501) },
      'description must not exceed 500 characters',
    ],
  ])('rejects %s without calling the service', async (_label, body, message) => {
    const response = await request(app).post('/tasks').send(body).expect(400);

    expect(response.body.error).toMatchObject({ code: 'VALIDATION_FAILED', message });
    expect(service.addTask).not.toHaveBeenCalled();
  });

  it('rejects a body that is not valid JSON', async () => {
    const response = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{"description":')
      .expect(400);

    expect(response.body.error.code).toBe('MALFORMED_JSON');
  });

  it('rejects a body larger than the limit', async () => {
    const response = await request(app)
      .post('/tasks')
      .send({ description: 'x'.repeat(20_000) })
      .expect(413);

    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('presents a contract revert as a rejected request, not a server fault', async () => {
    service.addTask.mockRejectedValue(new TransactionRevertedError('execution reverted', TX_HASH));

    const response = await request(app).post('/tasks').send({ description: 'x' }).expect(422);

    expect(response.body.error.code).toBe('TRANSACTION_REVERTED');
  });

  it('returns 202 and keeps the hash when confirmation times out', async () => {
    service.addTask.mockRejectedValue(new TransactionTimeoutError(TX_HASH, 120_000));

    const response = await request(app).post('/tasks').send({ description: 'x' }).expect(202);

    expect(response.body).toMatchObject({
      status: 'pending',
      transaction: { hash: TX_HASH, explorerUrl: expect.stringContaining(TX_HASH) },
    });
  });

  it('never leaks internals when something unexpected fails', async () => {
    service.addTask.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:8545'));

    const response = await request(app).post('/tasks').send({ description: 'x' }).expect(500);

    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.5');
  });
});

describe('POST /tasks/:id/complete', () => {
  it('completes a task and reports the confirmed transaction', async () => {
    service.completeTask.mockResolvedValue({
      ...writeResult,
      task: { ...writeResult.task, completed: true },
    });

    const response = await request(app).post('/tasks/7/complete').expect(200);

    expect(response.body.status).toBe('confirmed');
    expect(response.body.task.completed).toBe(true);
    expect(service.completeTask).toHaveBeenCalledWith(7);
  });

  it('accepts task id zero, which is a real task', async () => {
    service.completeTask.mockResolvedValue(writeResult);

    await request(app).post('/tasks/0/complete').expect(200);

    expect(service.completeTask).toHaveBeenCalledWith(0);
  });

  it.each([
    ['a non-numeric id', 'abc'],
    ['a negative id', '-1'],
    ['a fractional id', '1.5'],
  ])('rejects %s without calling the service', async (_label, id) => {
    await request(app).post(`/tasks/${id}/complete`).expect(400);

    expect(service.completeTask).not.toHaveBeenCalled();
  });

  it('returns 404 with the task id when the task does not exist', async () => {
    service.completeTask.mockRejectedValue(new TaskNotFoundError(99));

    const response = await request(app).post('/tasks/99/complete').expect(404);

    expect(response.body.error).toMatchObject({
      code: 'TASK_NOT_FOUND',
      details: { taskId: 99 },
    });
  });

  it('returns 409 when the task is already completed', async () => {
    service.completeTask.mockRejectedValue(new TaskAlreadyCompletedError(7));

    const response = await request(app).post('/tasks/7/complete').expect(409);

    expect(response.body.error.code).toBe('TASK_ALREADY_COMPLETED');
  });

  it('reports the offending field for a core validation failure', async () => {
    service.completeTask.mockRejectedValue(new ValidationError('bad input', 'id'));

    const response = await request(app).post('/tasks/7/complete').expect(400);

    expect(response.body.error.details).toEqual({ field: 'id' });
  });
});

describe('service basics', () => {
  it('answers a health check without touching the chain', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(response.body.status).toBe('ok');
    expect(service.getTasks).not.toHaveBeenCalled();
  });

  it('reports which contract it is pointed at, so a client need not be told', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(response.body.chain).toEqual({
      name: 'Sepolia',
      id: 11155111,
      contract: CONTRACT,
      explorerUrl: `https://sepolia.etherscan.io/address/${CONTRACT}`,
    });
  });

  it('returns a structured 404 for an unknown route', async () => {
    const response = await request(app).get('/nope').expect(404);

    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('allows the configured browser origin', async () => {
    service.getTasks.mockResolvedValue([]);

    const response = await request(app).get('/tasks').set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('sets security headers and hides the framework', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
