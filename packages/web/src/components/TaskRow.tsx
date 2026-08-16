import type { Task } from '../api/types.js';
import { useElapsedSeconds } from '../hooks/useElapsedSeconds.js';
import { CheckIcon, SpinnerIcon } from './icons.js';

/**
 * One task from the contract.
 *
 * The description comes from a public, shared list — anyone with the contract
 * address can write to it — so it is rendered as text and never interpolated
 * into markup. React escapes it; keep it that way.
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
      className={`grid grid-cols-[2.5rem_1fr_auto] items-start gap-3 py-3 pr-5 pl-5 transition-colors ${
        completing ? 'border-l-2 border-l-warn bg-warn-soft/40 pl-[calc(1.25rem-2px)]' : ''
      }`}
    >
      <span className="tabular pt-px font-mono text-[13px] text-subtle">#{task.id}</span>

      <div className="min-w-0">
        <p
          className={`text-[15px] leading-snug break-words ${
            task.completed ? 'text-subtle line-through' : 'text-fg'
          }`}
        >
          {task.description}
        </p>

        {completing && (
          <p className="readout mt-1 text-warn">Waiting for confirmation · {seconds}s</p>
        )}
      </div>

      {task.completed ? (
        <span className="eyebrow flex items-center gap-1 rounded-full bg-ok-soft px-2 py-1 text-ok">
          <CheckIcon className="size-3" />
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
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:border-line disabled:text-subtle"
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
    <li className="grid grid-cols-[2.5rem_1fr_auto] items-start gap-3 border-l-2 border-l-warn bg-warn-soft/40 py-3 pr-5 pl-[calc(1.25rem-2px)]">
      <span className="tabular pt-px font-mono text-[13px] text-subtle">#—</span>

      <div className="min-w-0">
        <p className="text-[15px] leading-snug break-words text-muted">{description}</p>
        <p className="readout mt-1 text-warn">Waiting for a block · {seconds}s</p>
      </div>

      <span className="eyebrow flex items-center gap-1 rounded-full bg-warn-soft px-2 py-1 text-warn">
        <SpinnerIcon className="size-3" />
        Pending
      </span>
    </li>
  );
}
