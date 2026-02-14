import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
export type ColorTheme = 'ember' | 'jade' | 'ocean' | 'editorial';

export const COLOR_THEMES: { id: ColorTheme; label: string; icon: string; color: string }[] = [
  { id: 'ember', label: '炽焰', icon: '🔥', color: '#ea580c' },
  { id: 'jade', label: '翡翠', icon: '🌿', color: '#059669' },
  { id: 'ocean', label: '海潮', icon: '🌊', color: '#0891b2' },
  { id: 'editorial', label: '墨韵', icon: '📰', color: '#475569' },
];

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  colorTheme: ColorTheme;
  setColorTheme: (theme: ColorTheme) => void;
}

const ThemeContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
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
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      root.style.colorScheme = systemTheme;
    } else {
      root.classList.add(theme);
      root.style.colorScheme = theme;
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const root = window.document.documentElement;
    // Apply granular color theme (ember, jade, etc.) via data attribute
    root.dataset.theme = colorTheme;
    localStorage.setItem('color-theme', colorTheme);
  }, [colorTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, colorTheme, setColorTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};
