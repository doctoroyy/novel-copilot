import { useState, useEffect } from 'react';

type Theme = 'light' | 'dark' | 'system';
export type ColorTheme = 'ember' | 'jade' | 'ocean' | 'editorial';

export const COLOR_THEMES: { id: ColorTheme; label: string; icon: string; color: string }[] = [
  { id: 'ember', label: '炽焰', icon: '🔥', color: '#ea580c' },
  { id: 'jade', label: '翡翠', icon: '🌿', color: '#059669' },
  { id: 'ocean', label: '海潮', icon: '🌊', color: '#0891b2' },
  { id: 'editorial', label: '墨韵', icon: '📰', color: '#475569' },
];

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as Theme) || 'dark';
    }
    return 'dark';
  });

  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('color-theme') as ColorTheme) || 'ember';
    }
    return 'ember';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    
    const applyTheme = (t: Theme) => {
      if (t === 'system') {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        root.classList.toggle('dark', systemTheme === 'dark');
      } else {
        root.classList.toggle('dark', t === 'dark');
      }
    };

    applyTheme(theme);
    localStorage.setItem('theme', theme);

    // Listen for system theme changes
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme]);

  useEffect(() => {
    const root = window.document.documentElement;
    // ember is default, no data-theme attribute needed
    if (colorTheme === 'ember') {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = colorTheme;
    }
    localStorage.setItem('color-theme', colorTheme);
  }, [colorTheme]);

  return { theme, setTheme, colorTheme, setColorTheme };
}
