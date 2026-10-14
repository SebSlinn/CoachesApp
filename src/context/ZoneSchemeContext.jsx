// src/context/ZoneSchemeContext.jsx
// Makes the coach's zone scheme available to every screen (contracts/ZONES.md).
//
//   const { color, groupColor, style, scheme, setScheme } = useZoneScheme();
//   color('AT')        → '#FFCC00' (or the coach's colour for AT)
//   groupColor(3)      → Zone 3 header colour
//   style('AT')        → { code, label, short, name, color, text, group }
//
// Outside a provider the hook still works and returns the default scheme,
// so a component can never crash or go colourless for want of a provider.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { BUILT_IN_SCHEMES, DEFAULT_SCHEME_ID, resolveZoneStyle, groupColor } from '../zones/schemes.js';
import { loadZoneScheme, saveZoneScheme, listZoneSchemes } from '../services/zoneSchemeService.js';

function makeApi(pScheme, pSetScheme) {
  return {
    scheme:     pScheme,
    setScheme:  pSetScheme,
    schemes:    listZoneSchemes().data,
    style:      (pCode) => resolveZoneStyle(pCode, pScheme),
    color:      (pCode) => resolveZoneStyle(pCode, pScheme).color,
    groupColor: (pZone) => groupColor(pZone, pScheme),
  };
}

const DEFAULT_API = makeApi(BUILT_IN_SCHEMES[DEFAULT_SCHEME_ID], () => {});
const ZoneSchemeContext = createContext(DEFAULT_API);

export function ZoneSchemeProvider({ children }) {
  const [scheme, setSchemeState] = useState(() => loadZoneScheme().data);
  const setScheme = useCallback((pChoice) => {
    const { data } = saveZoneScheme(pChoice);
    setSchemeState(data);
  }, []);
  const api = useMemo(() => makeApi(scheme, setScheme), [scheme, setScheme]);
  return <ZoneSchemeContext.Provider value={api}>{children}</ZoneSchemeContext.Provider>;
}

export function useZoneScheme() {
  return useContext(ZoneSchemeContext);
}
