import { useCallback, useRef, useState, type ReactNode } from 'react';
import { AlertIcon, CheckIcon, ExternalLinkIcon, SpinnerIcon } from './icons.js';
import { ToastContext, type PushToast, type Toast, type ToastTone } from './toast-context.js';

/**
 * Transaction results.
 *
 * A write takes ten seconds or more and the user has usually moved on, so the
 * outcome has to find them rather than the other way round. The region is a
 * live region: a screen reader hears the result without having to go looking
 * for it either.
 */

const DISMISS_AFTER_MS = 7_000;

const TONES: Record<ToastTone, { border: string; text: string; Icon: typeof CheckIcon }> = {
  ok: { border: 'border-s-ok', text: 'text-ok', Icon: CheckIcon },
  warn: { border: 'border-s-warn', text: 'text-warn', Icon: SpinnerIcon },
  danger: { border: 'border-s-danger', text: 'text-danger', Icon: AlertIcon },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (toast) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...toast, id }]);

      if (!toast.sticky) {
        setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}

      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 p-4 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { border, text, Icon } = TONES[toast.tone];

  return (
    <div className="toast-in pointer-events-auto w-full max-w-sm overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-lift)">
      {/* The tone stripe runs the full height on the leading edge, so a glance
          at the stack reads confirmed / in-flight / failed without any text. */}
      <div className={`flex items-start gap-3 border-s-2 ${border} p-3.5 ps-3`}>
        <span className={`mt-px shrink-0 ${text}`}>
          <Icon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-semibold">{toast.title}</p>
          {/* Tabular figures because bodies carry block numbers and gas, but the
              sans face because they are sentences, not readouts. */}
          {toast.body && (
            <p className="tabular mt-1 text-xs leading-relaxed break-words text-muted">
              {toast.body}
            </p>
          )}
          {toast.link && (
            <a
              href={toast.link.href}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-accent transition-opacity hover:opacity-75"
            >
              {toast.link.label}
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="-mt-1 -me-1 shrink-0 rounded-md px-1.5 py-0.5 text-lg leading-none text-subtle transition-colors hover:bg-sunk hover:text-fg"
          aria-label="Dismiss notification"
        >
          ×
        </button>
      </div>
    </div>
  );
}
