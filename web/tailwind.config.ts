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
      fontFamily: { sans: ['var(--font-manrope)', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'] },
      // default scale +1px (Tailwind: xs 12, sm 14, base 16, ...)
      fontSize: {
        xs: ['13px', '18px'], sm: ['15px', '22px'], base: ['17px', '26px'], lg: ['19px', '28px'], xl: ['21px', '30px'],
        '2xl': ['25px', '32px'], '3xl': ['31px', '38px'], '4xl': ['37px', '42px'],
      },
    },
  },
  plugins: [],
};
export default config;
