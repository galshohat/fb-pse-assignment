import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { addTask, ApiError, completeTask } from '../api/client.js';
import type { WriteOutcome } from '../api/types.js';
import { useToasts } from '../components/toast-context.js';
import { TASKS_KEY } from './useTasks.js';

/**
 * The two writes.
 *
 * Both spend gas and neither can be undone, so nothing here is optimistic in
 * the usual sense: the list is only updated from what the chain reports. What
 * the UI shows while a write is in flight is a *pending* row, clearly labelled
 * as not yet real, which is replaced by the refetched truth on settle.
 */

/** Matches the cap the API enforces, so a doomed write never leaves the page. */
export const MAX_DESCRIPTION_LENGTH = 500;

export function useAddTask() {
  const queryClient = useQueryClient();
  const report = useOutcomeReporter();

  return useMutation({
    mutationFn: (description: string) => addTask(description),
    onSuccess: (outcome) => report(outcome, 'added'),
    onError: (error: Error) => reportFailure(error, report),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

/**
 * Completing is per task and several can be in flight at once — the API
 * serializes them into one transaction queue — so the in-flight set is keyed by
 * task id, with the time each started so the row can show how long it has been
 * waiting.
 */
export function useCompleteTask() {
  const queryClient = useQueryClient();
  const report = useOutcomeReporter();
  const [inFlight, setInFlight] = useState<ReadonlyMap<number, number>>(new Map());

  const mutation = useMutation({
    mutationFn: (id: number) => completeTask(id),
    onSuccess: (outcome) => report(outcome, 'completed'),
    onError: (error: Error) => reportFailure(error, report),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });

  const complete = useCallback(
    (id: number) => {
      setInFlight((current) => new Map(current).set(id, Date.now()));

      mutation.mutate(id, {
        onSettled: () =>
          setInFlight((current) => {
            const next = new Map(current);
            next.delete(id);
            return next;
          }),
      });
    },
    [mutation],
  );

  return { complete, inFlight };
}

type Report = (outcome: WriteOutcome | FailedWrite, verb: string) => void;

interface FailedWrite {
  readonly status: 'failed';
  readonly title: string;
  readonly message: string;
}

/**
 * Turns an outcome into something the user reads. The distinction that matters
 * is confirmed versus pending: a pending write is on the network but unmined,
 * so it is reported honestly and its hash is kept on screen until dismissed.
 */
function useOutcomeReporter(): Report {
  const push = useToasts();

  return useCallback<Report>(
    (outcome, verb) => {
      if (outcome.status === 'confirmed') {
        push({
          tone: 'ok',
          title: `Task #${outcome.task.id} ${verb}`,
          body: `Mined in block ${outcome.transaction.blockNumber} · ${formatGas(outcome.transaction.gasUsed)} gas`,
          link: { href: outcome.transaction.explorerUrl, label: 'View transaction' },
        });
        return;
      }

      if (outcome.status === 'pending') {
        push({
          tone: 'warn',
          title: 'Sent, but not confirmed yet',
          body: `${outcome.message} The transaction may still be mined.`,
          link: { href: outcome.transaction.explorerUrl, label: 'Track it on Etherscan' },
          sticky: true,
        });
        return;
      }

      push({ tone: 'danger', title: outcome.title, body: outcome.message });
    },
    [push],
  );
}

/**
 * Failures the user can do something about get their own headline. The rest
 * fall back to the API's message, which is written for a person already.
 */
const FAILURE_TITLES: Record<string, string> = {
  API_UNREACHABLE: 'Cannot reach the API',
  RATE_LIMITED: 'Too many writes',
  TASK_ALREADY_COMPLETED: 'Someone got there first',
  TASK_NOT_FOUND: 'That task does not exist',
  TRANSACTION_REVERTED: 'The contract rejected it',
  TRANSACTION_TIMEOUT: 'No receipt in time',
  VALIDATION_FAILED: 'That was not accepted',
  CHAIN_UNAVAILABLE: 'The network is unreachable',
};

function reportFailure(error: Error, report: Report): void {
  const code = error instanceof ApiError ? error.code : 'UNEXPECTED_ERROR';

  report(
    {
      status: 'failed',
      title: FAILURE_TITLES[code] ?? 'The write failed',
      message: error.message,
    },
    'failed',
  );
}

/** `77826` reads as `77,826`: gas figures are compared, so grouping helps. */
function formatGas(gasUsed: string): string {
  const parsed = Number(gasUsed);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-US') : gasUsed;
}
