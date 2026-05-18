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
        /* ============================================
         * Constructo AI SEAOP Color System
         * Aligned with ERP React D365 Fluent palette
         * ============================================ */

        /* Primary — Microsoft D365 Blue */
        'seaop-primary': {
          50: '#f0f6ff',
          100: '#d6e6ff',
          200: '#a8ccff',
          300: '#6babff',
          400: '#3b8aff',
          500: '#0078D4',     /* D365 primary */
          600: '#0078D4',     /* D365 main action */
          700: '#005ea2',     /* D365 hover */
          800: '#004578',     /* D365 pressed */
          900: '#002050',     /* D365 navbar */
          950: '#001833',
          DEFAULT: '#0078D4',
        },

        /* D365 Navy — topbar/dark surfaces */
        'd365-navy': {
          DEFAULT: '#002050',
          light: '#002b6b',
          dark: '#001833',
        },

        /* Button colors (ERP --button-color) */
        'seaop-button': {
          DEFAULT: '#1e293b', /* --button-color */
          light: '#334155',   /* --button-color-light */
          dark: '#0f172a',    /* --button-color-dark */
          darkest: '#020617', /* --button-color-darkest */
        },

        /* Surface / Background (ERP light mode) */
        'seaop-surface': {
          light: '#f8fafc',   /* --secondary-background-color */
          DEFAULT: '#ffffff',  /* --background-color */
          card: '#f1f5f9',    /* --card-background */
          muted: '#f8fafc',   /* --gray-50 */
        },

        /* Dark mode surfaces (ERP dark_theme.css — GitHub style) */
        'seaop-dark': {
          bg: '#1b1a19',       /* --background-color dark (D365) */
          surface: '#252423',  /* --secondary-background-color dark */
          card: '#292827',     /* --card-background dark */
          border: '#3b3a39',   /* --border-color dark */
          'border-light': '#323130',
          text: '#f3f2f1',     /* --text-color dark */
          'text-muted': '#a19f9d',
          'text-dim': '#605e5c',
          accent: '#6cb8f6',   /* Blue accent for dark mode (D365) */
        },

        /* Accent — Orange (ERP --orange) */
        'seaop-accent': {
          DEFAULT: '#f97316',  /* --orange */
          light: '#fb923c',
          lighter: '#fdba74',
          dark: '#ea580c',
        },

        /* Status colors (ERP --project-*) */
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

        /* Gray scale — Tailwind/Slate (matches ERP --gray-*) */
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
        'seaop-xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
        'seaop-blue': '0 4px 12px rgba(0, 120, 212, 0.15)',
      },
      borderRadius: {
        'seaop-sm': '0.375rem',
        'seaop': '0.5rem',
        'seaop-lg': '0.75rem',
        'seaop-xl': '1rem',
      },
    },
  },
  plugins: [],
};
