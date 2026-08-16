import { useCallback, useEffect, useState } from 'react';

/**
 * Theme choice.
 *
 * The stylesheet follows the operating system on its own, so nothing is pinned
 * unless the user actually asks for it: `data-theme` is set only once they use
 * the toggle, and removed if they never have. Writing the resolved system
 * theme on first load would look identical today and then quietly stop
 * following the system tomorrow.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'todo:theme';

export function useTheme(): { resolved: Theme; toggle: () => void } {
  const [choice, setChoice] = useState<Theme | null>(readStored);
  const [system, setSystem] = useState<Theme>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystem(query.matches ? 'dark' : 'light');

    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (choice) {
      document.documentElement.dataset['theme'] = choice;
    } else {
      delete document.documentElement.dataset['theme'];
    }

    try {
      if (choice) localStorage.setItem(STORAGE_KEY, choice);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be denied; the choice then lasts for this page view only.
    }
  }, [choice]);

  const resolved = choice ?? system;
  const toggle = useCallback(() => setChoice(resolved === 'dark' ? 'light' : 'dark'), [resolved]);

  return { resolved, toggle };
}

function readStored(): Theme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
