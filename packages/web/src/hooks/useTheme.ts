import { useCallback, useEffect, useState } from 'react';

/**
 * Theme choice.
 *
 * The stylesheet already follows the operating system on its own, so this only
 * exists to record an override. `data-theme` on the root pins `color-scheme`,
 * which is what the palette's `light-dark()` values read.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'todo:theme';

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

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? systemTheme());

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage can be denied; the choice then lasts for this page view only.
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle };
}
