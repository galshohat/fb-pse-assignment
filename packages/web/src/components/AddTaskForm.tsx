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
      className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-sm"
    >
      <label htmlFor="description" className="eyebrow text-subtle">
        New task
      </label>

      <div className="mt-2 flex flex-wrap gap-2">
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
          className="min-w-56 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-[15px] placeholder:text-subtle"
        />

        <button
          type="submit"
          disabled={isPending}
          className="tabular inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <>
              <SpinnerIcon />
              Waiting for a block · {seconds}s
            </>
          ) : (
            <>
              <PlusIcon />
              Add task
            </>
          )}
        </button>
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        <p
          id="description-help"
          className={`text-xs ${problem ? 'text-danger' : 'text-muted'}`}
          role={problem ? 'alert' : undefined}
        >
          {problem ?? 'Adding a task sends a transaction. It costs testnet gas and is permanent.'}
        </p>

        {trimmed.length > 0 && (
          <p className={`readout shrink-0 pt-px ${tooLong ? 'text-danger' : 'text-subtle'}`}>
            {trimmed.length}/{MAX_DESCRIPTION_LENGTH}
          </p>
        )}
      </div>
    </form>
  );
}
