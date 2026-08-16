import { z } from 'zod';
import {
  addTaskBody,
  confirmedWriteResponse,
  errorResponse,
  healthResponse,
  pendingWriteResponse,
  taskIdParam,
  taskListResponse,
  taskSchema,
  transactionSchema,
} from './schemas.js';

/**
 * The OpenAPI description of this API.
 *
 * Schemas are generated from the zod schemas the service validates against,
 * rather than written out a second time by hand. Documentation that is
 * maintained separately from the code drifts from it, usually silently and
 * usually at the moment someone is relying on it.
 */

/** Converts a zod schema to the JSON Schema dialect OpenAPI 3.0 expects. */
function schemaFor(schema: z.ZodType, io: 'input' | 'output' = 'output'): object {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io });
}

const failure = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

/**
 * Responses every write shares. Writes wait for a receipt, so the notable
 * entries are 202 (accepted but unconfirmed, hash included) and 422 (the
 * contract declined a well-formed request).
 */
const writeResponses = {
  202: {
    description:
      'Submitted but not confirmed within the timeout. The transaction may still be mined; track it with the returned hash.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/PendingWrite' } } },
  },
  400: failure('The request was rejected before anything was sent to the chain. No gas was spent.'),
  422: failure('The transaction was mined but the contract rejected it. Gas was spent.'),
  429: failure('Too many writes. Each one spends gas, so writes are rate limited.'),
  503: failure('Every configured RPC endpoint is unreachable. Retrying later may succeed.'),
} as const;

/**
 * @param contractAddress The address this instance is actually configured
 *   against. Passed in rather than hardcoded so the published document cannot
 *   name one contract while `/health` reports another.
 */
export function buildOpenApiDocument(contractAddress: string): object {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Blockchain TODO API',
      version: '1.0.0',
      description: [
        'A REST interface to a to-do list stored on the Ethereum Sepolia testnet.',
        '',
        '**Writes are real blockchain transactions.** They spend testnet gas, take roughly',
        'fifteen seconds to confirm, and cannot be undone. A write endpoint only responds',
        'once a receipt has been seen, so a `201` or `200` means the change is final on-chain.',
        '',
        `The list is stored by a public, permissionless contract at \`${contractAddress}\`.`,
        'Anyone can write to it directly, so tasks created by other people appear here too.',
      ].join('\n'),
      license: { name: 'MIT' },
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
    tags: [
      { name: 'Tasks', description: 'Read the list and change it.' },
      { name: 'Service', description: 'Operational endpoints.' },
    ],
    paths: {
      '/tasks': {
        get: {
          tags: ['Tasks'],
          summary: 'List every task',
          description:
            'Reads the full list from the contract. This is a view call: it costs nothing and returns immediately.',
          operationId: 'getTasks',
          responses: {
            200: {
              description: 'The tasks currently stored on-chain, in id order.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/TaskList' } },
              },
            },
            503: failure('Every configured RPC endpoint is unreachable.'),
          },
        },
        post: {
          tags: ['Tasks'],
          summary: 'Add a task',
          description:
            'Sends a transaction that appends a task, and waits for it to confirm before responding.',
          operationId: 'addTask',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AddTaskRequest' },
                example: { description: 'Buy milk' },
              },
            },
          },
          responses: {
            201: {
              description: 'The task was added and the transaction is confirmed.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ConfirmedWrite' } },
              },
            },
            413: failure('The request body is larger than the 16kb limit.'),
            ...writeResponses,
          },
        },
      },
      '/tasks/{id}/complete': {
        post: {
          tags: ['Tasks'],
          summary: 'Mark a task as completed',
          description: [
            'Sends a transaction that completes the task, and waits for it to confirm.',
            '',
            'The task is checked first, so a missing or already-completed task is rejected',
            'without spending gas. That check cannot be a guarantee — the list is shared, and',
            'another caller may complete the task in between — so a revert is still handled.',
          ].join('\n'),
          operationId: 'completeTask',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: schemaFor(taskIdParam, 'input'),
              example: 0,
            },
          ],
          responses: {
            200: {
              description: 'The task is completed and the transaction is confirmed.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ConfirmedWrite' } },
              },
            },
            404: failure('No task with that id exists. No gas was spent.'),
            409: failure('The task is already completed. No gas was spent.'),
            ...writeResponses,
          },
        },
      },
      '/health': {
        get: {
          tags: ['Service'],
          summary: 'Liveness check',
          description:
            'Returns immediately without contacting the chain, so polling it cannot generate RPC traffic.',
          operationId: 'health',
          responses: {
            200: {
              description: 'The service is running.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Health' } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Task: schemaFor(taskSchema),
        TaskList: schemaFor(taskListResponse),
        Transaction: schemaFor(transactionSchema),
        AddTaskRequest: schemaFor(addTaskBody, 'input'),
        ConfirmedWrite: schemaFor(confirmedWriteResponse),
        PendingWrite: schemaFor(pendingWriteResponse),
        Health: schemaFor(healthResponse),
        Error: schemaFor(errorResponse),
      },
    },
  };
}
