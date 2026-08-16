import { useState } from 'react';
import type { Task } from '../api/types.js';
import { EmptyState, LoadFailedState, NoMatchesState, TaskListSkeleton } from './states.js';
import { PendingTaskRow, TaskRow } from './TaskRow.js';

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
  /** A task that has been sent but has no id yet, shown above the real rows. */
  readonly pendingAdd: { description: string; startedAt: number } | undefined;
  /** Task id → when its completion was sent. */
  readonly completing: ReadonlyMap<number, number>;
  readonly onComplete: (id: number) => void;
}

export function TaskList({
  tasks,
  isPending,
  error,
  onRetry,
  pendingAdd,
  completing,
  onComplete,
}: TaskListProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const matches = FILTERS.find((candidate) => candidate.id === filter)?.matches ?? (() => true);
  // `filter` returns a new array, so sorting it in place does not touch the
  // cached query data.
  const visible = tasks?.filter(matches).sort((left, right) => right.id - left.id);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-(--shadow-rest)">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="eyebrow text-subtle">On-chain list · newest first</h2>
        {tasks && <FilterTabs tasks={tasks} active={filter} onChange={setFilter} />}
      </div>

      {isPending && <TaskListSkeleton />}
      {error && <LoadFailedState error={error} onRetry={onRetry} />}
      {/* A write in flight takes precedence over both: there is something to
          show, it just has no id yet. */}
      {tasks?.length === 0 && !pendingAdd && <EmptyState />}
      {tasks && tasks.length > 0 && visible?.length === 0 && !pendingAdd && (
        <NoMatchesState onClear={() => setFilter('all')} />
      )}

      {((visible && visible.length > 0) || pendingAdd) && (
        <ul className="divide-y divide-line rule">
          {pendingAdd && (
            <PendingTaskRow description={pendingAdd.description} startedAt={pendingAdd.startedAt} />
          )}
          {visible?.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              completingSince={completing.get(task.id)}
              onComplete={onComplete}
            />
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
    <div
      className="flex items-center gap-0.5 rounded-lg bg-sunk p-0.5"
      role="group"
      aria-label="Filter tasks"
    >
      {FILTERS.map(({ id, label, matches }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={active === id}
          className={`eyebrow rounded-md px-2.5 py-1.5 transition-all ${
            active === id
              ? 'bg-surface text-fg shadow-(--shadow-rest)'
              : 'text-subtle hover:text-fg'
          }`}
        >
          {label}
          <span className="ml-1.5 tabular-nums opacity-60">{tasks.filter(matches).length}</span>
        </button>
      ))}
    </div>
  );
}
