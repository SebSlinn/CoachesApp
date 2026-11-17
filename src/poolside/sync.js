// src/poolside/sync.js — Poolside → SwimZone direct save (2026-11-17).
//
// Poolside (public/poolside, no build step) loads this module only when it has
// something to save. Vite builds it to a fixed name, /poolside/sync.js (see
// vite.config.js); on the dev server Poolside imports this source file instead.
// It saves through the SAME service calls Athlete Setup and Test Sets use for an
// imported Poolside file, so the rules, analysers, HR figures and idempotency
// (client_uuid / sessionId) are all shared — nothing is duplicated in Poolside.
//
// Sign-in: Poolside and SwimZone share an origin, so the SwimZone session saved
// on this device (Supabase keeps it in localStorage) is used as-is. Row-level
// security decides what this user may add, exactly as in the app.
//
// One swimmer only: the athlete Poolside was opened for (Athlete Setup →
// Poolside, or a test from Test Sets). Multi-swimmer race sessions go out as
// files for now.

import { supabase } from '../supabaseClient'
import { ingestPoolsideExport, ingestPoolsideSetResult } from '../services/results'

/** The signed-in SwimZone user on this device, or null. */
export async function whoAmI() {
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    const mUser = data && data.session && data.session.user
    return mUser ? { id: mUser.id, email: mUser.email || '' } : null
  } catch {
    return null
  }
}

/**
 * Save one Poolside item to SwimZone.
 *   { kind: 'import',    athleteId, envelope: swimzone.import/1 }
 *   { kind: 'setresult', athleteId, envelope: swimzone.setresult/1 }
 * → { ok, text, signedOut?, retry? }   (never throws)
 */
export async function save(pItem) {
  try {
    if (!supabase) return { ok: false, text: 'SwimZone isn\'t set up on this site.' }
    if (!(await whoAmI())) return { ok: false, signedOut: true, text: 'Sign in to SwimZone on this device to save.' }
    if (!pItem || !pItem.athleteId) return { ok: false, text: 'No swimmer loaded — open Poolside from a swimmer in SwimZone.' }

    if (pItem.kind === 'setresult') {
      const { data, error } = await ingestPoolsideSetResult(pItem.envelope, { expectAthleteId: pItem.athleteId, fallbackAthleteId: pItem.athleteId })
      if (error) return failed(error)
      const mName = pItem.envelope.protocolName || 'the test'
      return { ok: true, text: data.alreadyPresent ? `${mName} is already saved.` : `Saved ${mName} — ${data.reps} rep${data.reps === 1 ? '' : 's'}.` }
    }

    if (pItem.kind === 'import') {
      const { data, error } = await ingestPoolsideExport(pItem.athleteId, pItem.envelope)
      if (error) return failed(error)
      const mNew = data.added, mOld = data.skipped
      return { ok: true, text: mNew ? `Saved ${mNew} swim${mNew === 1 ? '' : 's'}${mOld ? ` (${mOld} already saved)` : ''}.` : 'Already saved.' }
    }
    return { ok: false, text: 'Nothing Poolside knows how to save.' }
  } catch (e) {
    return { ok: false, retry: true, text: 'Couldn\'t reach SwimZone — will try again.' + (e && e.message ? ` (${e.message})` : '') }
  }
}

// Network trouble → try again later; anything else (rights, bad data) → stop and say.
function failed(pError) {
  const mMsg = (pError && pError.message) || 'Save failed'
  const mNet = /fetch|network|timeout|offline|Failed to/i.test(mMsg)
  if (/permission|row-level|policy|not allowed|42501/i.test(mMsg + ' ' + (pError && pError.code)))
    return { ok: false, text: 'You don\'t have rights to add to this swimmer\'s records.' }
  return { ok: false, retry: mNet, text: mNet ? 'Couldn\'t reach SwimZone — will try again.' : mMsg }
}
