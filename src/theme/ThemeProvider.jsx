import React, { createContext, useContext, useEffect, useMemo } from 'react';

const LIGHT_THEME = Object.freeze({ mode: 'light', resolvedTheme: 'light', isDark: false });
const ThemeContext = createContext({ ...LIGHT_THEME, setMode: () => {} });
const noOp = () => {};

export function ThemeProvider({ children }) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'light');
    root.classList.remove('dark');
    root.style.colorScheme = 'light';

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const brandColor = getComputedStyle(root).getPropertyValue('--deep-lagoon').trim();
      if (brandColor) meta.setAttribute('content', brandColor);
    }
  }, []);

  const value = useMemo(() => ({ ...LIGHT_THEME, setMode: noOp }), []);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
