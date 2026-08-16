import { useRef, useState, type FormEvent } from 'react';
import { useElapsedSeconds } from '../hooks/useElapsedSeconds.js';
import { MAX_DESCRIPTION_LENGTH } from '../hooks/useWrites.js';
import { PlusIcon, SpinnerIcon } from './icons.js';

/**
 * Adding a task.
 *
 * Validation happens here as well as on the server, for the reason it happens
 * everywhere in this project: a write that cannot succeed must never reach the
 * chain, because reverting still costs gas. An empty description is exactly
 * what the contract refuses, so it is refused here first.
 */

interface AddTaskFormProps {
  readonly onSubmit: (description: string) => void;
  readonly isPending: boolean;
  readonly startedAt: number | undefined;
}

export function AddTaskForm({ onSubmit, isPending, startedAt }: AddTaskFormProps) {
  const [description, setDescription] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seconds = useElapsedSeconds(isPending ? startedAt : undefined);

  const trimmed = description.trim();
  const tooLong = trimmed.length > MAX_DESCRIPTION_LENGTH;
  const nearLimit = trimmed.length > MAX_DESCRIPTION_LENGTH * 0.8;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!trimmed) {
      setProblem('A task needs a description — the contract rejects an empty one.');
      return;
    }

    if (tooLong) {
      setProblem(`Descriptions are capped at ${MAX_DESCRIPTION_LENGTH} characters.`);
      return;
    }

    setProblem(null);
    setDescription('');
    input.current?.focus();
    onSubmit(trimmed);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded-2xl border border-line bg-surface p-1.5 shadow-(--shadow-lift)"
    >
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <label htmlFor="description" className="sr-only">
          New task
        </label>

        <input
          id="description"
          ref={input}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            if (problem) setProblem(null);
          }}
          placeholder="What needs doing?"
          autoComplete="off"
          aria-invalid={problem !== null}
          aria-describedby="description-help"
          className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-[15px] outline-none placeholder:text-subtle"
        />

        {trimmed.length > 0 && (
          <p
            className={`readout shrink-0 tabular-nums ${
              tooLong ? 'text-danger' : nearLimit ? 'text-warn' : 'text-subtle'
            }`}
          >
            {trimmed.length}/{MAX_DESCRIPTION_LENGTH}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="tabular inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {isPending ? (
            <>
              <SpinnerIcon className="size-4" />
              Waiting for a block · {seconds}s
            </>
          ) : (
            <>
              <PlusIcon className="size-4" />
              Add task
            </>
          )}
        </button>
      </div>

      <p
        id="description-help"
        className={`px-4 pt-1 pb-2 text-xs ${problem ? 'font-medium text-danger' : 'text-subtle'}`}
        role={problem ? 'alert' : undefined}
      >
        {problem ?? 'Adding a task sends a transaction. It costs testnet gas and is permanent.'}
      </p>
    </form>
  );
}
