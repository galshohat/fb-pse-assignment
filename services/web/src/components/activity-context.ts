import { createContext, useContext } from 'react';

/**
 * A record of what this browser session sent to the chain.
 *
 * Toasts are momentary; this is the receipt book. It answers the question a
 * toast cannot once it has gone: what did I send, did it land, in which block,
 * and what did it cost.
 */

export interface Activity {
  readonly id: number;
  readonly action: 'add' | 'complete';
  readonly status: 'confirmed' | 'pending' | 'failed';
  readonly at: number;
  readonly taskId?: number;
  readonly description?: string;
  readonly hash?: string;
  readonly explorerUrl?: string;
  readonly blockNumber?: number;
  readonly gasUsed?: string;
  /** Why it failed, when it did. */
  readonly detail?: string;
}

export interface ActivityLogValue {
  readonly entries: readonly Activity[];
  readonly record: (entry: Omit<Activity, 'id' | 'at'>) => void;
}

export const ActivityContext = createContext<ActivityLogValue | null>(null);

export function useActivityLog(): ActivityLogValue {
  const value = useContext(ActivityContext);

  if (!value) {
    throw new Error('useActivityLog must be used inside <ActivityProvider>');
  }

  return value;
}
