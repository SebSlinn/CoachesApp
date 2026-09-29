// resultsSync.js — flush the Poolside outbox into Supabase when online.
//
// The bridge between LocalResultsRepository (offline capture) and the results
// service (Supabase writes). Idempotent: every record carries its client UUID,
// so flushing twice is a no-op — a record the server already has counts as
// alreadyPresent, not an error.
//
// Layering: this is a service. It calls LocalResultsRepository and services/
// results.js (which owns the RepositoryFactory → Supabase path). It never
// imports supabaseClient.js.

import { LocalResultsRepository } from '../repositories/local/LocalResultsRepository.js';
import { addResult, addSetResult } from './results.js';

function isOnline() {
  try { return typeof navigator === 'undefined' ? true : navigator.onLine !== false; }
  catch { return true; }
}

/**
 * Push a single envelope's record to Supabase. Returns:
 *   { status: 'flushed' | 'alreadyPresent' | 'skipped' | 'error', error? }
 * 'skipped' = still unattributed (no athleteId) — left in the outbox.
 */
async function pushOne(env) {
  const rec = env.record;
  if (!env.athleteId) return { status: 'skipped' };

  const isSet = rec.fmt === 'swimzone.setresult/1';
  const fn = isSet ? addSetResult : addResult;
  const { error } = await fn(env.athleteId, rec);

  if (!error) return { status: 'flushed' };

  // A unique-violation on client_uuid means the server already has it.
  const code = error.code || '';
  const msg = (error.message || '').toLowerCase();
  if (code === '23505' || msg.includes('duplicate') || msg.includes('client_uuid')) {
    return { status: 'alreadyPresent' };
  }
  return { status: 'error', error };
}

/**
 * Flush all pending, attributed captures. Non-transactional by design: each
 * record is independent and idempotent, so a partial flush is safe to retry.
 * Returns { data: { flushed, alreadyPresent, skipped, failed }, error }.
 */
export async function flushOutbox() {
  if (!LocalResultsRepository.available) {
    return { data: { flushed: 0, alreadyPresent: 0, skipped: 0, failed: 0 },
             error: new Error('offline store unavailable') };
  }
  if (!isOnline()) {
    return { data: { flushed: 0, alreadyPresent: 0, skipped: 0, failed: 0 },
             error: new Error('offline') };
  }

  const { data: pending, error: listErr } = await LocalResultsRepository.listPending();
  if (listErr) return { data: null, error: listErr };

  const tally = { flushed: 0, alreadyPresent: 0, skipped: 0, failed: 0 };
  for (const env of pending) {
    const res = await pushOne(env);
    if (res.status === 'flushed') { await LocalResultsRepository.markFlushed(env.id); tally.flushed++; }
    else if (res.status === 'alreadyPresent') { await LocalResultsRepository.markFlushed(env.id); tally.alreadyPresent++; }
    else if (res.status === 'skipped') { tally.skipped++; }
    else { tally.failed++; } // left pending, retried next flush
  }
  return { data: tally, error: null };
}

/** Count of captures still waiting (for a "N to sync" badge). */
export async function pendingCount() {
  const { data } = await LocalResultsRepository.listPending();
  return (data || []).length;
}

/** Attribute a logged-out capture, then it's eligible for the next flush. */
export async function attributeCapture(localId, athleteId) {
  return LocalResultsRepository.attribute(localId, athleteId);
}

/**
 * Flush now, and whenever the browser regains connectivity. Call once at app
 * start. Returns an unsubscribe fn. No-op where window is unavailable.
 */
export function startAutoFlush() {
  const run = () => { flushOutbox().catch(() => {}); };
  run();
  try {
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', run);
      return () => window.removeEventListener('online', run);
    }
  } catch { /* ignore */ }
  return () => {};
}
