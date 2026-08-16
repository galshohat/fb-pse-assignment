import { useState } from 'react';
import type { Task } from '../api/types.js';
import { EmptyState, LoadFailedState, NoMatchesState, TaskListSkeleton } from './states.js';
import { TaskRow } from './TaskRow.js';

/**
 * The contract's list.
 *
 * Ordered newest first: ids are assigned sequentially on-chain, so the highest
 * id is the most recent write and is where someone looks after adding one. The
 * id is shown on every row, so nothing about the order is ambiguous.
 */

type Filter = 'all' | 'open' | 'done';

const FILTERS: readonly { id: Filter; label: string; matches: (task: Task) => boolean }[] = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'open', label: 'Open', matches: (task) => !task.completed },
  { id: 'done', label: 'Done', matches: (task) => task.completed },
];

interface TaskListProps {
  readonly tasks: Task[] | undefined;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly onRetry: () => void;
}

export function TaskList({ tasks, isPending, error, onRetry }: TaskListProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const matches = FILTERS.find((candidate) => candidate.id === filter)?.matches ?? (() => true);
  // `filter` returns a new array, so sorting it in place does not touch the
  // cached query data.
  const visible = tasks?.filter(matches).sort((left, right) => right.id - left.id);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-2.5">
        <h2 className="eyebrow text-subtle">On-chain list · newest first</h2>
        {tasks && <FilterTabs tasks={tasks} active={filter} onChange={setFilter} />}
      </div>

      {isPending && <TaskListSkeleton />}
      {error && <LoadFailedState error={error} onRetry={onRetry} />}
      {tasks?.length === 0 && <EmptyState />}
      {tasks && tasks.length > 0 && visible?.length === 0 && (
        <NoMatchesState onClear={() => setFilter('all')} />
      )}

      {visible && visible.length > 0 && (
        <ul className="divide-y divide-line">
          {visible.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterTabs({
  tasks,
  active,
  onChange,
}: {
  tasks: Task[];
  active: Filter;
  onChange: (filter: Filter) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Filter tasks">
      {FILTERS.map(({ id, label, matches }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={active === id}
          className={`eyebrow rounded-md px-2 py-1 transition-colors ${
            active === id ? 'bg-accent-soft text-accent' : 'text-subtle hover:text-fg'
          }`}
        >
          {label} <span className="tabular opacity-70">{tasks.filter(matches).length}</span>
        </button>
      ))}
    </div>
  );
}
