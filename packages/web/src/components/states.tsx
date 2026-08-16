import { ApiError } from '../api/client.js';
import { AlertIcon, BlockIcon } from './icons.js';

/**
 * The states that are not the happy path.
 *
 * Each one is designed rather than defaulted: a blank page while loading, or a
 * bare "error" string, tells the user nothing about what to do next. Every
 * state here says what happened and what will happen if they wait or retry.
 */

/** First load. Rows, not a spinner, so the layout does not jump when data lands. */
export function TaskListSkeleton() {
  return (
    <ul className="divide-y divide-line rule" aria-hidden="true">
      {[68, 84, 55, 74, 62].map((width, index) => (
        <li key={index} className="grid grid-cols-[3rem_1fr] items-baseline gap-4 px-5 py-3.5">
          <div className="h-3.5 w-6 animate-pulse justify-self-end rounded bg-sunk" />
          <div className="h-3.5 animate-pulse rounded bg-sunk" style={{ width: `${width}%` }} />
        </li>
      ))}
    </ul>
  );
}

export function EmptyState() {
  return (
    <div className="px-5 py-16 text-center">
      <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <BlockIcon className="size-5" />
      </span>
      <p className="text-[15px] font-semibold">No tasks on-chain yet</p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        The contract's list is empty. Adding the first task writes it to the blockchain, where
        everyone reading this contract will see it.
      </p>
    </div>
  );
}

export function NoMatchesState({ onClear }: { onClear: () => void }) {
  return (
    <div className="px-5 py-16 text-center">
      <p className="text-[15px] font-semibold">Nothing in this view</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        There are tasks on-chain, just none matching this filter.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 rounded-lg border border-line px-3 py-1.5 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
      >
        Show all tasks
      </button>
    </div>
  );
}

/**
 * A failed read. The distinction that matters is whether the API answered at
 * all: an unreachable API is something the user can fix, a refusal is not.
 */
export function LoadFailedState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const unreachable = error instanceof ApiError && error.isUnreachable;

  return (
    <div className="px-5 py-16 text-center">
      <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <AlertIcon className="size-5" />
      </span>
      <p className="text-[15px] font-semibold">
        {unreachable ? 'Cannot reach the API' : 'Could not load tasks'}
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        {unreachable
          ? `${error.message} Start it with "npm run dev:api", then try again.`
          : error.message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg border border-line px-3 py-1.5 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
      >
        Try again
      </button>
    </div>
  );
}
