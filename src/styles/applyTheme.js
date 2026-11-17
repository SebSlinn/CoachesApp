// src/styles/applyTheme.js
// Puts a theme's colours on the page as CSS variables (--sz-*), which T.* in theme.js reads.
// ThemeProvider (context/ThemeContext.jsx) calls it whenever the theme changes.
//
// It deliberately does NOT change <body>'s background: pages not yet moved onto theme.js
// still draw their own colours (dark or light) and must keep looking the way they do.
// A converted page sets background: T.bg itself.
import { themeCssVars, DEFAULT_THEME } from './theme.js';

export function applyTheme(pName = DEFAULT_THEME) {
  if (typeof document === 'undefined') return;
  const mRoot = document.documentElement;
  for (const [mVar, mValue] of Object.entries(themeCssVars(pName))) mRoot.style.setProperty(mVar, mValue);
  mRoot.dataset.theme = pName;
}
