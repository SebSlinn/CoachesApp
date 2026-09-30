// tests/services/run.mjs — bundles the services with in-memory repositories
// (mockFactory.js stands in for RepositoryFactory) and runs services.test.mjs.
// Services use extensionless Vite-style imports, so plain `node` can't load
// them directly; esbuild (shipped with Vite) resolves them.
//
//   node tests/services/run.mjs
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '.out.mjs');
await build({
  entryPoints: [path.join(here, 'services.test.mjs')], bundle: true, platform: 'node', format: 'esm',
  outfile: out, logLevel: 'warning',
  plugins: [{ name: 'mock-repos', setup(b) {
    b.onResolve({ filter: /RepositoryFactory$/ }, () => ({ path: path.join(here, 'mockFactory.js') }));
    b.onResolve({ filter: /swimmingResults$/ }, () => ({ path: path.join(here, 'stub.js') }));
  } }],
});
await import(pathToFileURL(out).href);
