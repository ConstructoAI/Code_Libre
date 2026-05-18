/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'seaop-primary': {
          50: '#f0f6ff',
          100: '#d6e6ff',
          200: '#a8ccff',
          300: '#6babff',
          400: '#3b8aff',
          500: '#0078D4',
          600: '#0078D4',
          700: '#005ea2',
          800: '#004578',
          900: '#002050',
          950: '#001833',
          DEFAULT: '#0078D4',
        },
        'd365-navy': {
          DEFAULT: '#002050',
          light: '#002b6b',
          dark: '#001833',
        },
        'seaop-button': {
          DEFAULT: '#1e293b',
          light: '#334155',
          dark: '#0f172a',
          darkest: '#020617',
        },
        'seaop-surface': {
          light: '#f8fafc',
          DEFAULT: '#ffffff',
          card: '#f1f5f9',
          muted: '#f8fafc',
        },
        'seaop-dark': {
          bg: '#0d1117',
          surface: '#161b22',
          card: '#1c2128',
          border: '#30363d',
          'border-light': '#21262d',
          text: '#e6edf3',
          'text-muted': '#8b949e',
          'text-dim': '#6e7681',
          accent: '#58a6ff',
        },
        'seaop-accent': {
          DEFAULT: '#f97316',
          light: '#fb923c',
          lighter: '#fdba74',
          dark: '#ea580c',
        },
        'seaop-success': {
          DEFAULT: '#22C55E',
          light: '#86EFAC',
          lighter: '#DCFCE7',
        },
        'seaop-warning': {
          DEFAULT: '#F59E0B',
          light: '#FCD34D',
          lighter: '#FEF3C7',
        },
        'seaop-danger': {
          DEFAULT: '#EF4444',
          light: '#F87171',
          lighter: '#FEE2E2',
        },
        'seaop-info': {
          DEFAULT: '#06B6D4',
          light: '#67E8F9',
          lighter: '#CFFAFE',
        },
        'seaop-gray': {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'seaop-sm': '0 1px 3px 0 rgb(0 0 0 / 0.05)',
        'seaop': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        'seaop-lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -2px rgb(0 0 0 / 0.05)',
      },
    },
  },
  plugins: [],
};
