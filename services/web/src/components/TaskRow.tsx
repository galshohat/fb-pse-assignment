import type { Task } from '../api/types.js';
import { useElapsedSeconds } from '../hooks/useElapsedSeconds.js';
import { CheckIcon, SpinnerIcon } from './icons.js';

/**
 * One task from the contract.
 *
 * The description comes from a public, shared list — anyone with the contract
 * address can write to it — so it is rendered as text and never interpolated
 * into markup. React escapes it; keep it that way.
 *
 * The row is a ledger entry: a fixed mono gutter for the on-chain id, then the
 * text, then its state. The id column is what makes a long list scannable, so
 * it holds its width no matter how the description wraps.
 */

interface TaskRowProps {
  readonly task: Task;
  /** When this task's completion is in flight, the time it was sent. */
  readonly completingSince: number | undefined;
  readonly onComplete: (id: number) => void;
}

export function TaskRow({ task, completingSince, onComplete }: TaskRowProps) {
  const seconds = useElapsedSeconds(completingSince);
  const completing = completingSince !== undefined;

  return (
    <li
      className={`group relative grid grid-cols-[3rem_1fr_auto] items-baseline gap-4 px-5 py-3.5 transition-colors ${
        completing ? 'bg-warn-soft/50' : 'hover:bg-sunk/60'
      }`}
    >
      {/* In-flight rows carry a marker on the leading edge. It sits inside the
          padding rather than shifting the grid, so nothing reflows on settle. */}
      {completing && (
        <span className="absolute inset-y-0 start-0 w-0.5 bg-warn" aria-hidden="true" />
      )}

      <span className={`gutter pt-px ${task.completed ? 'text-subtle' : 'text-muted'}`}>
        {task.id}
      </span>

      <div className="min-w-0">
        <p
          className={`text-[15px] leading-relaxed break-words ${
            task.completed ? 'text-subtle' : 'text-fg'
          }`}
        >
          {task.description}
        </p>

        {completing && (
          <p className="readout mt-1.5 flex items-center gap-1.5 text-warn">
            <SpinnerIcon className="size-3" />
            Waiting for confirmation · {seconds}s
          </p>
        )}
      </div>

      {task.completed ? (
        <span className="eyebrow flex shrink-0 items-center gap-1.5 text-ok">
          <CheckIcon className="size-3.5" />
          Done
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onComplete(task.id)}
          disabled={completing}
          // The accessible name says what pressing this does, not just "Complete":
          // it spends gas and cannot be undone.
          aria-label={`Complete task ${task.id} on-chain — sends a transaction`}
          // Quiet at rest so eighteen of them do not shout, but always legible
          // as a control: it keeps its border and reads as a button before any
          // pointer arrives, which is what a touch or keyboard user relies on.
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:border-line disabled:text-subtle"
        >
          {completing ? (
            <>
              <SpinnerIcon className="size-3" />
              Sending
            </>
          ) : (
            'Complete'
          )}
        </button>
      )}
    </li>
  );
}

/**
 * A task that has been sent but not yet mined. It has no id — the contract
 * assigns that — and it is deliberately not styled like a real row: nothing on
 * this list is real until the chain says so.
 */
export function PendingTaskRow({
  description,
  startedAt,
}: {
  description: string;
  startedAt: number;
}) {
  const seconds = useElapsedSeconds(startedAt);

  return (
    <li className="row-in relative grid grid-cols-[3rem_1fr_auto] items-baseline gap-4 bg-warn-soft/50 px-5 py-3.5">
      <span className="absolute inset-y-0 start-0 w-0.5 bg-warn" aria-hidden="true" />

      <span className="gutter pending-pulse pt-px text-warn">—</span>

      <div className="min-w-0">
        <p className="text-[15px] leading-relaxed break-words text-muted">{description}</p>
        <p className="readout mt-1.5 flex items-center gap-1.5 text-warn">
          <SpinnerIcon className="size-3" />
          Waiting for a block · {seconds}s
        </p>
      </div>

      <span className="eyebrow flex shrink-0 items-center gap-1.5 text-warn">Pending</span>
    </li>
  );
}
