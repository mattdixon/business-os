/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: {
          950: '#0a0a0b',
          900: '#111113',
          800: '#1a1a1d',
          700: '#26262a',
          600: '#3a3a40',
          500: '#5a5a62',
          400: '#7d7d85',
          300: '#a5a5ac',
          200: '#cdcdd2',
          100: '#e8e8eb',
          50: '#f5f5f7',
        },
        accent: {
          DEFAULT: '#0f766e',
          hover: '#0d6963',
        },
        ok: '#16a34a',
        warn: '#d97706',
        bad: '#dc2626',
      },
      borderRadius: {
        sm: '0.25rem',
        DEFAULT: '0.375rem',
        md: '0.5rem',
      },
    },
  },
  plugins: [],
};
