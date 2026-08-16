import {
  TaskAlreadyCompletedError,
  TransactionTimeoutError,
  type TodoService,
  type WriteResult,
} from '@todo/core';
import { pino } from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { buildOpenApiDocument } from './openapi.js';
import {
  confirmedWriteResponse,
  errorResponse,
  healthResponse,
  pendingWriteResponse,
  taskListResponse,
} from './schemas.js';

const TX_HASH = `0x${'cd'.repeat(32)}` as const;

const writeResult: WriteResult = {
  task: { id: 7, description: 'ship it', completed: false },
  transaction: {
    hash: TX_HASH,
    explorerUrl: `https://sepolia.etherscan.io/tx/${TX_HASH}`,
    blockNumber: 100,
    gasUsed: '50000',
  },
};

const service = { getTasks: vi.fn(), addTask: vi.fn(), completeTask: vi.fn() };

const app = createApp({
  service: service as unknown as TodoService,
  logger: pino({ level: 'silent' }),
  corsOrigin: 'http://localhost:5173',
  rateLimit: false,
});

beforeEach(() => vi.resetAllMocks());

describe('the published document', () => {
  const document = buildOpenApiDocument() as {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown> };
  };

  it('describes every route the service actually serves', () => {
    expect(Object.keys(document.paths).sort()).toEqual([
      '/health',
      '/tasks',
      '/tasks/{id}/complete',
    ]);
    expect(document.paths['/tasks']).toHaveProperty('get');
    expect(document.paths['/tasks']).toHaveProperty('post');
  });

  it('is served over HTTP for tooling to consume', async () => {
    const response = await request(app).get('/openapi.json').expect(200);

    expect(response.body.openapi).toBe('3.0.3');
    expect(response.body.info.title).toBe('Blockchain TODO API');
  });

  it('serves a browsable page with its own assets, so it works offline', async () => {
    const page = await request(app).get('/docs/').expect(200);
    expect(page.text).toContain('swagger-ui');

    await request(app).get('/docs/swagger-ui.css').expect(200);
  });

  it('documents the write outcomes that are easy to get wrong', () => {
    const addTask = document.paths['/tasks']?.['post'] as { responses: Record<string, unknown> };

    // A timeout is not a failure and a revert is not a server fault; both are
    // documented so a client can handle them deliberately.
    expect(addTask.responses).toHaveProperty('202');
    expect(addTask.responses).toHaveProperty('422');

    const complete = document.paths['/tasks/{id}/complete']?.['post'] as {
      responses: Record<string, unknown>;
    };
    expect(complete.responses).toHaveProperty('404');
    expect(complete.responses).toHaveProperty('409');
  });

  it('generates request schemas from the validation, including the length cap', () => {
    const addTaskRequest = document.components.schemas['AddTaskRequest'] as {
      properties: { description: { maxLength: number; minLength: number } };
      required: string[];
    };

    expect(addTaskRequest.properties.description.maxLength).toBe(500);
    expect(addTaskRequest.properties.description.minLength).toBe(1);
    expect(addTaskRequest.required).toEqual(['description']);
  });
});

/**
 * The point of these: a schema that only describes what we intended is a
 * comment. Parsing real responses through the documented schemas means the
 * document is checked against the service on every test run.
 */
describe('responses match what the document promises', () => {
  it('GET /tasks', async () => {
    service.getTasks.mockResolvedValue([{ id: 0, description: 'first', completed: true }]);

    const response = await request(app).get('/tasks').expect(200);

    expect(() => taskListResponse.parse(response.body)).not.toThrow();
  });

  it('POST /tasks on success', async () => {
    service.addTask.mockResolvedValue(writeResult);

    const response = await request(app).post('/tasks').send({ description: 'ship it' }).expect(201);

    expect(() => confirmedWriteResponse.parse(response.body)).not.toThrow();
  });

  it('POST /tasks/:id/complete on success', async () => {
    service.completeTask.mockResolvedValue(writeResult);

    const response = await request(app).post('/tasks/7/complete').expect(200);

    expect(() => confirmedWriteResponse.parse(response.body)).not.toThrow();
  });

  it('a write that does not confirm in time', async () => {
    service.addTask.mockRejectedValue(new TransactionTimeoutError(TX_HASH, 120_000));

    const response = await request(app).post('/tasks').send({ description: 'x' }).expect(202);

    expect(() => pendingWriteResponse.parse(response.body)).not.toThrow();
  });

  it.each([
    ['a validation failure', () => request(app).post('/tasks').send({}), 400],
    ['an unknown route', () => request(app).get('/nope'), 404],
  ])('%s', async (_label, call, status) => {
    const response = await call().expect(status);

    expect(() => errorResponse.parse(response.body)).not.toThrow();
  });

  it('a rejected task, with its structured details', async () => {
    service.completeTask.mockRejectedValue(new TaskAlreadyCompletedError(7));

    const response = await request(app).post('/tasks/7/complete').expect(409);

    const parsed = errorResponse.parse(response.body);
    expect(parsed.error.details).toEqual({ taskId: 7 });
  });

  it('GET /health', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(() => healthResponse.parse(response.body)).not.toThrow();
  });
});
