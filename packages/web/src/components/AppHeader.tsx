import type { ChainContext } from '../api/types.js';
import { BlockIcon, ExternalLinkIcon } from './icons.js';

/**
 * The header doubles as an instrument strip: which chain, which contract, how
 * many tasks, and whether the API is answering. A user about to spend gas
 * should be able to see what they are about to spend it on without asking.
 *
 * Two tiers, because the two halves answer different questions. The top is
 * identity and control — what this is, is it alive, how do I change the view.
 * The strip below is instrumentation: the readings you check before you act.
 */

export type Connection = 'connecting' | 'live' | 'down';

interface AppHeaderProps {
  readonly chain: ChainContext | undefined;
  readonly connection: Connection;
  readonly taskCount: number | undefined;
}

export function AppHeader({ chain, connection, taskCount }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-4xl items-center gap-3.5 px-6 pt-5 pb-4">
        <span className="text-accent">
          <BlockIcon className="size-7" />
        </span>

        <div className="min-w-0">
          <h1 className="text-lg leading-none font-semibold">Blockchain TODO</h1>
          <p className="mt-1.5 hidden text-[13px] leading-none text-subtle sm:block">
            A shared list stored in a smart contract
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ConnectionPill connection={connection} />
        </div>
      </div>

      <dl className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-7 gap-y-1.5 px-6 pb-3.5">
        <Field label="Chain" value={chain ? chain.name : '—'} note={chain?.id.toString()} />
        <Field
          label="Contract"
          value={chain ? shortAddress(chain.contract) : '—'}
          href={chain?.explorerUrl}
          title={chain?.contract}
        />
        <Field label="Tasks" value={taskCount === undefined ? '—' : String(taskCount)} />
      </dl>
    </header>
  );
}

/** One reading on the strip. A link when there is somewhere useful to go. */
function Field({
  label,
  value,
  note,
  href,
  title,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  href?: string | undefined;
  title?: string | undefined;
}) {
  const reading = (
    <>
      {value}
      {note && <span className="text-subtle"> · {note}</span>}
    </>
  );

  return (
    <div className="flex items-baseline gap-2">
      <dt className="eyebrow text-subtle">{label}</dt>
      <dd className="readout text-muted">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            title={title}
            className="inline-flex items-center gap-1 transition-colors hover:text-accent"
          >
            {reading}
            <ExternalLinkIcon className="size-3" />
          </a>
        ) : (
          reading
        )}
      </dd>
    </div>
  );
}

const CONNECTION_STATES = {
  connecting: { label: 'Connecting', dot: 'bg-subtle', text: 'text-subtle' },
  live: { label: 'Live', dot: 'bg-ok', text: 'text-muted' },
  down: { label: 'API down', dot: 'bg-danger', text: 'text-danger' },
} as const;

function ConnectionPill({ connection }: { connection: Connection }) {
  const state = CONNECTION_STATES[connection];

  return (
    <span
      className={`eyebrow flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 ${state.text}`}
    >
      {/* Colour alone never carries the meaning; the label says it too. */}
      <span className={`size-1.5 rounded-full ${state.dot}`} />
      {state.label}
    </span>
  );
}

/** `0xdF52…95c8` — enough to recognise, short enough to sit in a strip. */
function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
