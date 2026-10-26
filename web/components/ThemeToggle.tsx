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

  /** Circular reveal from the clicked button (View Transitions); smooth color cross-fade elsewhere. */
  function choose(t: Theme, e: React.MouseEvent<HTMLButtonElement>) {
    setTheme(t);
    const root = document.documentElement;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(t); return; }

    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (!doc.startViewTransition) {
      root.classList.add('theme-anim');
      apply(t);
      window.setTimeout(() => root.classList.remove('theme-anim'), 600);
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = doc.startViewTransition(() => apply(t));
    void transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
  }

  return (
    <div className="seg w-full" role="group" aria-label="Appearance">
      {OPTIONS.map((o) => (
        <button key={o.value} aria-pressed={theme === o.value} title={o.label} onClick={(e) => choose(o.value, e)} className="seg-item flex-1 !px-0 text-center">
          <span aria-hidden>{o.icon}</span><span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
