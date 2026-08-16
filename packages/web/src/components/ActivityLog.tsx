import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityContext,
  useActivityLog,
  type Activity,
  type ActivityLogValue,
} from './activity-context.js';
import { AlertIcon, CheckIcon, ExternalLinkIcon, SpinnerIcon } from './icons.js';

/**
 * The transactions this session sent, newest first.
 *
 * Kept in memory only: it describes this page view, and the chain itself is
 * the durable record. Bounded, so a long session cannot grow it without limit.
 */

const MAX_ENTRIES = 20;

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<readonly Activity[]>([]);
  const nextId = useRef(0);

  const record = useCallback<ActivityLogValue['record']>((entry) => {
    setEntries((current) =>
      [{ ...entry, id: nextId.current++, at: Date.now() }, ...current].slice(0, MAX_ENTRIES),
    );
  }, []);

  const value = useMemo(() => ({ entries, record }), [entries, record]);

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function ActivityLog() {
  const { entries } = useActivityLog();

  if (entries.length === 0) {
    return null;
  }

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <h2 className="eyebrow border-b border-line px-5 py-2.5 text-subtle">
        This session · {entries.length} transaction{entries.length === 1 ? '' : 's'}
      </h2>

      <ul className="divide-y divide-line">
        {entries.map((entry) => (
          <ActivityRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

const STATUS = {
  confirmed: { Icon: CheckIcon, tone: 'text-ok', label: 'Confirmed' },
  pending: { Icon: SpinnerIcon, tone: 'text-warn', label: 'Unconfirmed' },
  failed: { Icon: AlertIcon, tone: 'text-danger', label: 'Failed' },
} as const;

function ActivityRow({ entry }: { entry: Activity }) {
  const { Icon, tone, label } = STATUS[entry.status];

  return (
    <li className="flex items-start gap-3 px-5 py-2.5">
      <span className={`mt-0.5 ${tone}`} title={label}>
        <Icon className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {headline(entry)}
          {entry.taskId !== undefined && (
            <span className="tabular font-mono"> #{entry.taskId}</span>
          )}
          {entry.description && <span className="text-muted"> — {entry.description}</span>}
        </p>

        {entry.detail && <p className="mt-0.5 text-xs text-danger">{entry.detail}</p>}

        {entry.hash && (
          <div className="readout mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-subtle">
            <a
              href={entry.explorerUrl}
              target="_blank"
              rel="noreferrer noopener"
              title={entry.hash}
              className="inline-flex items-center gap-1 hover:text-accent"
            >
              {shortHash(entry.hash)}
              <ExternalLinkIcon className="size-3" />
            </a>
            {entry.blockNumber !== undefined && <span>block {entry.blockNumber}</span>}
            {entry.gasUsed && <span>{Number(entry.gasUsed).toLocaleString('en-US')} gas</span>}
          </div>
        )}
      </div>

      <time
        className="readout shrink-0 pt-0.5 text-subtle"
        dateTime={new Date(entry.at).toISOString()}
      >
        {new Date(entry.at).toLocaleTimeString('en-GB')}
      </time>
    </li>
  );
}

/**
 * Past tense is only used for something that actually happened. A failed or
 * unconfirmed write says so in the same words the user would use, rather than
 * claiming "Completed" and relying on a red icon to take it back.
 */
function headline(entry: Activity): string {
  const verb = entry.action === 'add' ? 'Add' : 'Complete';

  switch (entry.status) {
    case 'confirmed':
      return entry.action === 'add' ? 'Added' : 'Completed';
    case 'pending':
      return `${verb} sent, unconfirmed`;
    case 'failed':
      return `${verb} failed`;
  }
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}
