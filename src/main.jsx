import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ZoneSchemeProvider } from './context/ZoneSchemeContext.jsx';
import { reloadForNewVersion } from './lib/staleBuild.js';

// A newer version went live while this page was open → load it rather than fail.
window.addEventListener('vite:preloadError', (e) => { if (reloadForNewVersion()) e.preventDefault(); });
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><ZoneSchemeProvider><App /></ZoneSchemeProvider></React.StrictMode>
);

// Keep the app opening with no signal (registers poolside). Production only: in dev it would cache Vite's files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
