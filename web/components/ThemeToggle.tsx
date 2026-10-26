'use client';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'system' | 'dark';
const OPTIONS: { value: Theme; icon: string; label: string }[] = [
  { value: 'light', icon: '☀︎', label: 'Light' },
  { value: 'system', icon: '◐', label: 'Auto' },
  { value: 'dark', icon: '☾', label: 'Dark' },
];

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try { const t = localStorage.getItem('tw_theme'); if (t === 'light' || t === 'dark') setTheme(t); } catch { /* storage unavailable */ }
  }, []);

  function choose(t: Theme) {
    setTheme(t);
    try {
      if (t === 'system') { localStorage.removeItem('tw_theme'); delete document.documentElement.dataset.theme; }
      else { localStorage.setItem('tw_theme', t); document.documentElement.dataset.theme = t; }
    } catch { /* storage unavailable */ }
  }

  return (
    <div className="seg w-full" role="group" aria-label="Appearance">
      {OPTIONS.map((o) => (
        <button key={o.value} aria-pressed={theme === o.value} title={o.label} onClick={() => choose(o.value)} className="seg-item flex-1 !px-0 text-center">
          <span aria-hidden>{o.icon}</span><span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
