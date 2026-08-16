/**
 * The handful of icons this client needs, inlined rather than pulled from an
 * icon package: six shapes do not justify a dependency, and inlining keeps them
 * on `currentColor` so they inherit whatever the surrounding text is using.
 *
 * All of them are decorative — every icon here sits next to a text label, so
 * they are hidden from assistive technology.
 */

interface IconProps {
  readonly className?: string;
}

function icon(path: React.ReactNode, extra?: Record<string, string>) {
  return function Icon({ className = 'size-4' }: IconProps) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...extra}
      >
        {path}
      </svg>
    );
  };
}

/** A block, for the wordmark. */
export const BlockIcon = icon(
  <>
    <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
    <path d="M3.5 7 12 11.5 20.5 7M12 11.5v10" />
  </>,
);

export const CheckIcon = icon(<path d="m4.5 12.5 5 5 10-11" strokeWidth="2.25" />);

export const PlusIcon = icon(<path d="M12 5v14M5 12h14" strokeWidth="2" />);

export const ExternalLinkIcon = icon(
  <>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5" />
  </>,
);

export const AlertIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.2v.3" />
  </>,
);

/** The one non-decorative shape: it animates, so it says what it is waiting on. */
export function SpinnerIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
