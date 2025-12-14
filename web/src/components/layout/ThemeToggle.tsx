import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const icon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '💻';
  const label = theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '跟随系统';

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycleTheme}
      className="gap-2 text-muted-foreground hover:text-foreground"
    >
      <span>{icon}</span>
      <span className="hidden sm:inline text-xs">{label}</span>
    </Button>
  );
}
