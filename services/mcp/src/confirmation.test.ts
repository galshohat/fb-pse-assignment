import { describe, expect, it, vi } from 'vitest';
import { confirmWrite, type RequestContext } from './confirmation.js';

/** A context whose client answers the confirmation prompt in a given way. */
function clientAnswering(response: { action: string; content?: Record<string, unknown> }) {
  const elicitInput = vi.fn().mockResolvedValue(response);
  return { context: { mcpReq: { elicitInput } } as unknown as RequestContext, elicitInput };
}

const SUMMARY = 'Mark task #3 as completed.';

describe('confirmation before an irreversible action', () => {
  it('proceeds when the caller passed confirm explicitly, without prompting', async () => {
    const { context, elicitInput } = clientAnswering({ action: 'accept' });

    await expect(confirmWrite(context, true, SUMMARY)).resolves.toEqual({ confirmed: true });
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it('proceeds when the person accepts the prompt', async () => {
    const { context } = clientAnswering({ action: 'accept', content: { confirm: true } });

    await expect(confirmWrite(context, undefined, SUMMARY)).resolves.toEqual({ confirmed: true });
  });

  it('describes what will happen in the prompt itself', async () => {
    const { context, elicitInput } = clientAnswering({
      action: 'accept',
      content: { confirm: true },
    });

    await confirmWrite(context, undefined, SUMMARY);

    const [params] = elicitInput.mock.calls[0] as [{ message: string }];
    expect(params.message).toContain(SUMMARY);
    expect(params.message).toContain('cannot be undone');
  });

  it.each([
    ['the prompt is declined', { action: 'decline' }],
    ['the prompt is cancelled', { action: 'cancel' }],
    [
      'it is accepted but the box was left unticked',
      { action: 'accept', content: { confirm: false } },
    ],
    ['it is accepted with nothing filled in', { action: 'accept', content: {} }],
    [
      'the answer is a string rather than a boolean',
      { action: 'accept', content: { confirm: 'yes' } },
    ],
  ])('refuses when %s', async (_label, response) => {
    const { context } = clientAnswering(response);

    const outcome = await confirmWrite(context, undefined, SUMMARY);

    expect(outcome.confirmed).toBe(false);
  });

  it('refuses, rather than assuming consent, when the client cannot be asked', async () => {
    const outcome = await confirmWrite(undefined, undefined, SUMMARY);

    expect(outcome.confirmed).toBe(false);
    expect(outcome).toMatchObject({ reason: expect.stringContaining('"confirm": true') });
  });

  it('falls back to the argument when the prompt fails outright', async () => {
    const context = {
      mcpReq: { elicitInput: vi.fn().mockRejectedValue(new Error('not supported')) },
    } as unknown as RequestContext;

    const outcome = await confirmWrite(context, undefined, SUMMARY);

    expect(outcome.confirmed).toBe(false);
    expect(outcome).toMatchObject({ reason: expect.stringContaining('confirm') });
  });

  it('treats confirm:false as no confirmation at all', async () => {
    const { context } = clientAnswering({ action: 'decline' });

    await expect(confirmWrite(context, false, SUMMARY)).resolves.toMatchObject({
      confirmed: false,
    });
  });
});
