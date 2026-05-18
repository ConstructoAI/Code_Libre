/**
 * Mobile React Frontend - Theme Zustand Store
 * Dark/light mode toggle, persisted in localStorage.
 */

import { create } from 'zustand';

interface ThemeState {
  isDark: boolean;
  toggle: () => void;
  init: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  isDark: false,

  toggle: () => {
    const next = !get().isDark;
    set({ isDark: next });
    localStorage.setItem('mobile_theme', next ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', next);
  },

  init: () => {
    const stored = localStorage.getItem('mobile_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored ? stored === 'dark' : prefersDark;
    set({ isDark });
    document.documentElement.classList.toggle('dark', isDark);
  },
}));
