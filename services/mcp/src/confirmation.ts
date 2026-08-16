/**
 * Confirmation before an irreversible action.
 *
 * A write tool spends real funds and cannot be undone, so the server asks
 * before it acts rather than trusting that the caller meant it. Two mechanisms
 * cover every client:
 *
 * - Elicitation, where the client supports it: the person sees a prompt
 *   describing exactly what is about to happen and answers it directly.
 * - A `confirm` argument otherwise: the caller must call the tool a second
 *   time with `confirm: true`, having been told precisely what that will do.
 *
 * The rule in both cases is the same, and it is the important part: only an
 * explicit acceptance proceeds. A decline, a cancellation, a missing answer or
 * a client that cannot be asked all mean "do not execute".
 */

import type { ServerContext } from '@modelcontextprotocol/server';

/** The handler context the SDK passes as a tool callback's second argument. */
export type RequestContext = ServerContext;

export type ConfirmationOutcome =
  { readonly confirmed: true } | { readonly confirmed: false; readonly reason: string };

/**
 * @param summary What the caller is about to do, phrased for a person to read
 *   and judge — it is the only description they get before funds are spent.
 */
export async function confirmWrite(
  context: RequestContext | undefined,
  confirmArgument: boolean | undefined,
  summary: string,
): Promise<ConfirmationOutcome> {
  if (confirmArgument === true) {
    return { confirmed: true };
  }

  const elicit = context?.mcpReq?.elicitInput;

  if (elicit) {
    try {
      const response = await elicit({
        mode: 'form',
        message: `${summary}\n\nThis sends a blockchain transaction. It spends testnet funds and cannot be undone.`,
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: {
              type: 'boolean',
              title: 'Send this transaction',
              description: 'Tick to approve. Leaving it unticked cancels the action.',
            },
          },
          required: ['confirm'],
        },
      });

      if (response.action === 'accept' && response.content?.['confirm'] === true) {
        return { confirmed: true };
      }

      return {
        confirmed: false,
        reason:
          response.action === 'accept'
            ? 'Confirmation was declined at the prompt, so nothing was sent.'
            : `The confirmation prompt was ${response.action === 'cancel' ? 'cancelled' : 'declined'}, so nothing was sent.`,
      };
    } catch {
      // The client advertised elicitation but could not complete it — a
      // capability mismatch or a protocol era where it is unavailable. Fall
      // through to the argument, rather than failing the call outright.
    }
  }

  return { confirmed: false, reason: needsConfirmArgument(summary) };
}

function needsConfirmArgument(summary: string): string {
  return `Confirmation required before this runs.

${summary}

This sends a blockchain transaction: it spends testnet funds, takes around fifteen seconds, and cannot be undone. To go ahead, call this tool again with the same arguments plus "confirm": true.`;
}
