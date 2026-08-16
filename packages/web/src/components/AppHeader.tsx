import type { ChainContext } from '../api/types.js';
import { useTheme } from '../hooks/useTheme.js';
import { BlockIcon, ExternalLinkIcon, MoonIcon, SunIcon } from './icons.js';

/**
 * The header doubles as an instrument strip: which chain, which contract, how
 * many tasks, and whether the API is answering. A user about to spend gas
 * should be able to see what they are about to spend it on without asking.
 */

export type Connection = 'connecting' | 'live' | 'down';

interface AppHeaderProps {
  readonly chain: ChainContext | undefined;
  readonly connection: Connection;
  readonly taskCount: number | undefined;
}

export function AppHeader({ chain, connection, taskCount }: AppHeaderProps) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
        <span className="text-accent">
          <BlockIcon className="size-6" />
        </span>

        <div className="min-w-0">
          <h1 className="text-[15px] leading-tight font-semibold tracking-tight">
            Blockchain TODO
          </h1>
          {/* Hidden on narrow screens, where it wraps into the status pill and
              the strip below already says what this is. */}
          <p className="eyebrow hidden text-subtle sm:block">Tasks stored in a smart contract</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ConnectionPill connection={connection} />
          <button
            type="button"
            onClick={toggle}
            className="rounded-md border border-line p-1.5 text-muted transition-colors hover:bg-sunk hover:text-fg"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>

      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-sunk px-5 py-1.5">
        <Field label="Chain" value={chain ? `${chain.name} · ${chain.id}` : '—'} />
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
  href,
  title,
}: {
  label: string;
  value: string;
  href?: string | undefined;
  title?: string | undefined;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="eyebrow text-subtle">{label}</dt>
      <dd className="readout text-muted">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            title={title}
            className="inline-flex items-center gap-1 hover:text-accent"
          >
            {value}
            <ExternalLinkIcon className="size-3" />
          </a>
        ) : (
          value
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
      className={`eyebrow flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 ${state.text}`}
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
