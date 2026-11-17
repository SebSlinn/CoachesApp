// src/styles/applyTheme.js
// Puts a theme's colours on the page as CSS variables (--sz-*), which T.* in theme.js reads.
// Called once in main.jsx before the first render. Switching theme later = call it again.
import { themeColors, themeCssVars, DEFAULT_THEME } from './theme.js';

export function applyTheme(pName = DEFAULT_THEME) {
  if (typeof document === 'undefined') return;
  const mRoot = document.documentElement;
  for (const [mVar, mValue] of Object.entries(themeCssVars(pName))) mRoot.style.setProperty(mVar, mValue);
  mRoot.dataset.theme = pName;
  const mColors = themeColors(pName);
  document.body.style.background = mColors.bg;
  document.body.style.color = mColors.text;
}
