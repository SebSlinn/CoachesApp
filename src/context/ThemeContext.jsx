// src/context/ThemeContext.jsx
// The light / dark theme for every screen. Puts the theme's --sz-* variables on the page
// (applyTheme) and tells canvas charts and the zone colours which theme is in force.
//
//   const { theme, choice, setChoice } = useTheme();
//   theme   'dark' | 'light'            what is drawn now
//   choice  'dark' | 'light' | 'system' what the person picked (THEME_CHOICES)
//
// Outside a provider the hook returns the default theme, so nothing crashes.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { DEFAULT_THEME } from '../styles/theme.js';
import { applyTheme } from '../styles/applyTheme.js';
import { loadThemeChoice, saveThemeChoice, resolveTheme } from '../services/themeService.js';

const LIGHT_QUERY = '(prefers-color-scheme: light)';
const ThemeContext = createContext({ theme: DEFAULT_THEME, choice: DEFAULT_THEME, setChoice: () => {} });

function devicePrefersLight() {
  try { return window.matchMedia(LIGHT_QUERY).matches; } catch { return false; }
}

export function ThemeProvider({ children }) {
  const [choice, setChoiceState] = useState(() => loadThemeChoice().data);
  const [prefersLight, setPrefersLight] = useState(devicePrefersLight);
  const theme = resolveTheme(choice, prefersLight);

  // Before paint, so a light page never flashes dark colours.
  useLayoutEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    let mMq;
    try { mMq = window.matchMedia(LIGHT_QUERY); } catch { return undefined; }
    const onChange = (e) => setPrefersLight(e.matches);
    mMq.addEventListener?.('change', onChange);
    return () => mMq.removeEventListener?.('change', onChange);
  }, []);

  const setChoice = useCallback((pChoice) => setChoiceState(saveThemeChoice(pChoice).data), []);
  const api = useMemo(() => ({ theme, choice, setChoice }), [theme, choice, setChoice]);
  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
