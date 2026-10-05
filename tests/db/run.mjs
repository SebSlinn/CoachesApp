// tests/db/run.mjs — bundles the round-trip test with the REAL services and
// repositories, swapping only supabaseClient for tests/db/fakeSupabase.js
// (Postgres via PGlite, signed in as a user). Vite-style extensionless imports
// need a bundler; esbuild ships with Vite.
//
//   node tests/db/run.mjs
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '.out.mjs');
await build({
  entryPoints: [path.join(here, 'roundtrip.test.mjs')], bundle: true, platform: 'node', format: 'esm',
  outfile: out, logLevel: 'warning', external: ['@electric-sql/pglite'],
  define: { 'import.meta.env.VITE_SUPABASE_URL': '"x"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"x"' },
  plugins: [{ name: 'fake-supabase', setup(b) {
    b.onResolve({ filter: /supabaseClient(\.js)?$/ }, () => ({ path: path.join(here, 'fakeSupabase.js') }));
  } }],
});
await import(pathToFileURL(out).href);
