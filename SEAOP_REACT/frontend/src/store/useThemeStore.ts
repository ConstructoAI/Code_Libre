/**
 * SEAOP React Frontend - Theme Zustand Store
 * Simple dark/light mode toggle persisted in localStorage.
 * Applies/removes the 'dark' class on <html> for Tailwind dark mode.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'seaop_theme';

interface ThemeState {
  isDark: boolean;
  toggle: () => void;
  setDark: (dark: boolean) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  isDark: localStorage.getItem(STORAGE_KEY) === 'dark',

  toggle: () =>
    set((state) => {
      const newVal = !state.isDark;
      localStorage.setItem(STORAGE_KEY, newVal ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', newVal);
      return { isDark: newVal };
    }),

  setDark: (dark) => {
    localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', dark);
    set({ isDark: dark });
  },
}));
