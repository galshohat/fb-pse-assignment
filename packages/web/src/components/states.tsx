import { ApiError } from '../api/client.js';
import { AlertIcon } from './icons.js';

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
    <ul className="divide-y divide-line" aria-hidden="true">
      {[68, 84, 55, 74].map((width, index) => (
        <li key={index} className="flex items-center gap-3 px-5 py-3.5">
          <div className="h-4 w-8 animate-pulse rounded bg-sunk" />
          <div className="h-4 animate-pulse rounded bg-sunk" style={{ width: `${width}%` }} />
        </li>
      ))}
    </ul>
  );
}

export function EmptyState() {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-medium">No tasks on-chain yet</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">
        The contract's list is empty. Adding the first task writes it to the blockchain, where
        everyone reading this contract will see it.
      </p>
    </div>
  );
}

export function NoMatchesState({ onClear }: { onClear: () => void }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-medium">Nothing in this view</p>
      <p className="mt-1.5 text-sm text-muted">
        There are tasks on-chain, just none matching this filter.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 text-sm font-medium text-accent hover:underline"
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
    <div className="px-5 py-12 text-center">
      <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertIcon className="size-5" />
      </span>
      <p className="font-medium">{unreachable ? 'Cannot reach the API' : 'Could not load tasks'}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">
        {unreachable
          ? `${error.message} Start it with "npm run dev:api", then try again.`
          : error.message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md border border-line px-3 py-1.5 text-sm font-medium transition-colors hover:bg-sunk"
      >
        Try again
      </button>
    </div>
  );
}
