import type { Config } from 'tailwindcss';

const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: v('page'), surface: v('surface'), ink: v('ink'), ink2: v('ink-2'), muted: v('muted'),
        line: v('line'), brand: v('brand'), 'brand-ink': v('brand-ink'), 'brand-soft': v('brand-soft'),
        good: v('good'), 'good-soft': v('good-soft'), warn: v('warn'), 'warn-soft': v('warn-soft'),
        bad: v('bad'), 'bad-soft': v('bad-soft'), 'good-text': v('good-text'), 'warn-text': v('warn-text'), 'bad-text': v('bad-text'),
      },
      fontFamily: { sans: ['system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'] },
    },
  },
  plugins: [],
};
export default config;
