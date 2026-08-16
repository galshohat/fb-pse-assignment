import { MAX_DESCRIPTION_LENGTH } from '@todo/core';
import { z } from 'zod';

/**
 * Every schema the API validates against or documents.
 *
 * Request schemas are the ones the routes actually enforce, so the published
 * OpenAPI document cannot drift from the validation — they are the same
 * objects. Response schemas are documentation, and the integration tests parse
 * real responses through them so they cannot drift either.
 */

export const addTaskBody = z.object({
  description: z
    .string({ error: (issue) => (issue.input === undefined ? 'is required' : 'must be a string') })
    .min(1, 'must not be empty')
    .max(MAX_DESCRIPTION_LENGTH, `must not exceed ${MAX_DESCRIPTION_LENGTH} characters`)
    .describe('What the task should say.'),
});

export const taskIdParam = z.coerce
  .number({ error: 'must be a number' })
  .int('must be a whole number')
  .min(0, 'must not be negative')
  .describe('Task id. Ids are assigned sequentially by the contract and start at 0.');

export const taskSchema = z
  .object({
    id: z.number().int().min(0).describe('Sequential id assigned on-chain, starting at 0.'),
    description: z.string(),
    completed: z.boolean(),
  })
  .describe('A task as stored by the contract.');

export const transactionSchema = z
  .object({
    hash: z.string().describe('Transaction hash.'),
    explorerUrl: z.string().describe('Link to the transaction on Sepolia Etherscan.'),
    blockNumber: z.number().int().describe('Block the transaction was included in.'),
    gasUsed: z.string().describe('Gas consumed, as a string because it is a uint256.'),
  })
  .describe('A confirmed on-chain transaction.');

export const confirmedWriteResponse = z
  .object({
    status: z.literal('confirmed'),
    task: taskSchema,
    transaction: transactionSchema,
  })
  .describe('The write is final: a receipt was seen before this response was sent.');

export const pendingWriteResponse = z
  .object({
    status: z.literal('pending'),
    message: z.string(),
    transaction: z.object({ hash: z.string(), explorerUrl: z.string() }),
  })
  .describe(
    'The transaction was accepted by the network but did not confirm in time. It may still be mined; the hash is returned so it can be tracked.',
  );

export const errorResponse = z
  .object({
    error: z.object({
      code: z.string().describe('Stable machine-readable identifier.'),
      message: z.string().describe('Explanation intended for a person.'),
      details: z
        .object({
          field: z.string().optional(),
          taskId: z.number().optional(),
        })
        .optional()
        .describe('Structured extras a client can act on, when they exist.'),
    }),
  })
  .describe('Every failure uses this shape.');

export const healthResponse = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
});

export const taskListResponse = z.array(taskSchema);
