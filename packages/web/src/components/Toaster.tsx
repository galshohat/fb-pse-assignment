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
  ok: { border: 'border-l-ok', text: 'text-ok', Icon: CheckIcon },
  warn: { border: 'border-l-warn', text: 'text-warn', Icon: SpinnerIcon },
  danger: { border: 'border-l-danger', text: 'text-danger', Icon: AlertIcon },
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
    <div
      className={`toast-in pointer-events-auto w-full max-w-sm rounded-lg border border-line ${border} border-l-2 bg-surface p-3 shadow-lg`}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 ${text}`}>
          <Icon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{toast.title}</p>
          {toast.body && <p className="mt-0.5 text-xs break-words text-muted">{toast.body}</p>}
          {toast.link && (
            <a
              href={toast.link.href}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              {toast.link.label}
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="-mt-0.5 -mr-0.5 rounded px-1.5 py-0.5 text-lg leading-none text-subtle transition-colors hover:text-fg"
          aria-label="Dismiss notification"
        >
          ×
        </button>
      </div>
    </div>
  );
}
