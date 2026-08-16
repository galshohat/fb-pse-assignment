import type { Task } from '../api/types.js';
import { CheckIcon } from './icons.js';

/**
 * One task from the contract.
 *
 * The description comes from a public, shared list — anyone with the contract
 * address can write to it — so it is rendered as text and never interpolated
 * into markup. React escapes it; keep it that way.
 */
export function TaskRow({ task }: { task: Task }) {
  return (
    <li className="grid grid-cols-[2.5rem_1fr_auto] items-start gap-3 px-5 py-3">
      <span className="tabular pt-px font-mono text-[13px] text-subtle">#{task.id}</span>

      <p
        className={`text-[15px] leading-snug break-words ${
          task.completed ? 'text-subtle line-through' : 'text-fg'
        }`}
      >
        {task.description}
      </p>

      <StatusBadge completed={task.completed} />
    </li>
  );
}

function StatusBadge({ completed }: { completed: boolean }) {
  return completed ? (
    <span className="eyebrow flex items-center gap-1 rounded-full bg-ok-soft px-2 py-1 text-ok">
      <CheckIcon className="size-3" />
      Done
    </span>
  ) : (
    <span className="eyebrow rounded-full border border-line px-2 py-1 text-muted">Open</span>
  );
}
