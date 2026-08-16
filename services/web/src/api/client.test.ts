import { afterEach, describe, expect, it, vi } from 'vitest';
import { addTask, ApiError, completeTask, getTasks } from './client.js';

/**
 * The transport layer is where a server response becomes something the UI can
 * act on, and the interesting cases are the ones that are easy to get wrong: a
 * 202 that is not a failure, and a network error that has no response body.
 */

function respondWith(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('reading', () => {
  it('returns the task list', async () => {
    respondWith(200, [{ id: 0, description: 'first', completed: false }]);

    await expect(getTasks()).resolves.toEqual([{ id: 0, description: 'first', completed: false }]);
  });
});

describe('writing', () => {
  it('resolves a confirmed write with its receipt', async () => {
    respondWith(201, {
      status: 'confirmed',
      task: { id: 7, description: 'ship it', completed: false },
      transaction: { hash: '0xabc', explorerUrl: 'https://…', blockNumber: 1, gasUsed: '50000' },
    });

    const outcome = await addTask('ship it');

    expect(outcome.status).toBe('confirmed');
  });

  it('resolves — not rejects — when the write did not confirm in time', async () => {
    // 202 means the transaction is on the network but unconfirmed. Treating it
    // as an error would throw away the only hash the user has to track it.
    respondWith(202, {
      status: 'pending',
      message: 'Submitted but not confirmed within 120s.',
      transaction: { hash: '0xdef', explorerUrl: 'https://…' },
    });

    const outcome = await addTask('slow one');

    expect(outcome).toMatchObject({ status: 'pending', transaction: { hash: '0xdef' } });
  });
});

describe('failures', () => {
  it("keeps the server's error code so the UI can react to the specific case", async () => {
    respondWith(409, {
      error: { code: 'TASK_ALREADY_COMPLETED', message: 'Task 7 is already completed.' },
    });

    await expect(completeTask(7)).rejects.toMatchObject({
      code: 'TASK_ALREADY_COMPLETED',
      status: 409,
    });
  });

  it('still produces a usable error when the body is not the documented shape', async () => {
    respondWith(500, '<html>gateway error</html>');

    await expect(getTasks()).rejects.toMatchObject({ code: 'UNEXPECTED_ERROR', status: 500 });
  });

  it('names the URL when the API cannot be reached, since a bad base URL looks the same', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await getTasks().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isUnreachable).toBe(true);
    expect((error as ApiError).message).toContain('http://localhost:3000');
  });
});
