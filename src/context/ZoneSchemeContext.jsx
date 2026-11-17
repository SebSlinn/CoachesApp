// src/context/ZoneSchemeContext.jsx
// Makes the coach's zone scheme available to every screen (contracts/ZONES.md).
//
//   const { color, style, scheme, setScheme } = useZoneScheme();
//   color('AT')        → '#1E88E5' (the coach's colour for AT)
//   style('AT')        → { code, label, short, name, color, text, group }
//
// Zone colours only. Every other interface colour is in styles/theme.js. Group headers
// have no colour of their own (2026-11-17), so groupColor is deliberately not offered here.
//
// Outside a provider the hook still works and returns the default scheme,
// so a component can never crash or go colourless for want of a provider.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BUILT_IN_SCHEMES, DEFAULT_SCHEME_ID, resolveZoneStyle } from '../zones/schemes.js';
import { useTheme } from './ThemeContext.jsx';
import { loadZoneScheme, saveZoneScheme, listZoneSchemes, syncZoneScheme } from '../services/zoneSchemeService.js';
import { onAuthChange } from '../services/auth';

function makeApi(pScheme, pSetScheme, pTheme) {
  return {
    scheme:     pScheme,
    setScheme:  pSetScheme,
    schemes:    listZoneSchemes().data,
    // Colours suit the theme in force (light = darkened pale colours). Print asks for 'light' itself.
    style:      (pCode) => resolveZoneStyle(pCode, pScheme, pTheme),
    color:      (pCode) => resolveZoneStyle(pCode, pScheme, pTheme).color,
  };
}

const DEFAULT_API = makeApi(BUILT_IN_SCHEMES[DEFAULT_SCHEME_ID], () => {}, 'dark');
const ZoneSchemeContext = createContext(DEFAULT_API);

export function ZoneSchemeProvider({ children }) {
  const [scheme, setSchemeState] = useState(() => loadZoneScheme().data);
  const setScheme = useCallback((pChoice) => {
    const { data } = saveZoneScheme(pChoice);
    setSchemeState(data);
  }, []);
  // The account's choice follows the coach between devices: fetch it now and whenever someone signs in.
  useEffect(() => {
    let live = true;
    const pull = () => syncZoneScheme().then((r) => { if (live && r.changed) setSchemeState(r.data); });
    pull();
    // (deferred: supabase-js mustn't be called from inside its own auth callback)
    const sub = onAuthChange((event) => { if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(pull, 0); });
    return () => { live = false; sub?.data?.subscription?.unsubscribe?.(); };
  }, []);
  const { theme } = useTheme();
  const api = useMemo(() => makeApi(scheme, setScheme, theme), [scheme, setScheme, theme]);
  return <ZoneSchemeContext.Provider value={api}>{children}</ZoneSchemeContext.Provider>;
}

export function useZoneScheme() {
  return useContext(ZoneSchemeContext);
}
