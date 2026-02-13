import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useTheme, COLOR_THEMES, type ColorTheme } from '@/contexts/ThemeContext';
import { Sun, Moon, Monitor, Check, Palette } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const modeOptions: { id: 'light' | 'dark' | 'system'; label: string; icon: React.ReactNode }[] = [
    { id: 'light', label: '浅色', icon: <Sun className="h-4 w-4" /> },
    { id: 'dark', label: '深色', icon: <Moon className="h-4 w-4" /> },
    { id: 'system', label: '系统', icon: <Monitor className="h-4 w-4" /> },
  ];

  const currentIcon = theme === 'dark' ? <Moon className="h-4 w-4" /> : theme === 'light' ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />;

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
      >
        {currentIcon}
        <span className="hidden sm:inline text-xs">
          {theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '系统'}
        </span>
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-popover p-2 shadow-xl z-50 animate-fade-in">
          {/* Light/Dark Mode */}
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">外观模式</div>
          <div className="space-y-0.5">
            {modeOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setTheme(opt.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  theme === opt.id
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-foreground hover:bg-muted/50'
                }`}
              >
                {opt.icon}
                <span>{opt.label}</span>
                {theme === opt.id && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="h-px bg-border my-2" />

          {/* Color Theme */}
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Palette className="h-3 w-3" />
            主题色板
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-1">
            {COLOR_THEMES.map((ct) => (
              <button
                key={ct.id}
                onClick={() => setColorTheme(ct.id as ColorTheme)}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-all ${
                  colorTheme === ct.id
                    ? 'bg-accent ring-1 ring-primary/30 font-medium'
                    : 'hover:bg-muted/50'
                }`}
              >
                <span
                  className="w-4 h-4 rounded-full shrink-0 ring-1 ring-black/10"
                  style={{ backgroundColor: ct.color }}
                />
                <span className="text-xs">{ct.icon} {ct.label}</span>
                {colorTheme === ct.id && (
                  <Check className="h-3 w-3 ml-auto text-primary" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
