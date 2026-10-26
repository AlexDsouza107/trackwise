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

  function apply(t: Theme) {
    try {
      if (t === 'system') { localStorage.removeItem('tw_theme'); delete document.documentElement.dataset.theme; }
      else { localStorage.setItem('tw_theme', t); document.documentElement.dataset.theme = t; }
    } catch { /* storage unavailable */ }
  }

  /** Day/night dissolve via View Transitions; a slow color cross-fade where unsupported. */
  function choose(t: Theme) {
    setTheme(t);
    const root = document.documentElement;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(t); return; }

    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (!doc.startViewTransition) {
      root.classList.add('theme-anim');
      apply(t);
      window.setTimeout(() => root.classList.remove('theme-anim'), 1000);
      return;
    }
    // Dissolve: the old theme stays put while the new one fades in from a soft blur, like dawn or dusk.
    const toNight = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const transition = doc.startViewTransition(() => apply(t));
    void transition.ready.then(() => {
      root.animate(
        {
          opacity: [0, 1],
          filter: [`blur(10px) brightness(${toNight ? 0.8 : 1.25})`, 'blur(0px) brightness(1)'],
        },
        { duration: 1100, easing: 'cubic-bezier(0.33, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
  }

  return (
    <div className="seg w-full" role="group" aria-label="Appearance">
      {OPTIONS.map((o) => (
        <button key={o.value} aria-pressed={theme === o.value} title={o.label} onClick={() => choose(o.value)} className="seg-item flex-1 !px-0 text-center">
          <span aria-hidden className="theme-icon inline-block">{o.icon}</span><span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
