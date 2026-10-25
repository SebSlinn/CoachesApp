//repositories/supabase/SupabaseZoneSchemeRepository.js
// The coach's zone scheme, saved to their account (user_settings.zone_scheme) so it follows them
// to any device. Still synchronous for screens (IZoneSchemeRepository): get() and save() work on the
// device copy (LocalZoneSchemeRepository, KEYS.ZONE_SCHEME) at once; save() then sends it to the
// account in the background. sync() — at sign-in and app start — brings the account's choice down.
//
//   A change made with no signal is marked pending (KEYS.ZONE_SCHEME_PENDING) and sent by the next sync.
//   An account with nothing saved yet takes this device's choice (so an existing choice isn't lost) —
//   but only if that choice was made by the same person (KEYS.ZONE_SCHEME_OWNER) or nobody yet.
import { supabase } from '../../supabaseClient';
import { storage, KEYS } from '../../lib/storage';
import { IZoneSchemeRepository } from '../interfaces/IZoneSchemeRepository';
import { LocalZoneSchemeRepository } from '../local/LocalZoneSchemeRepository';

export class SupabaseZoneSchemeRepository extends IZoneSchemeRepository {
  constructor() {
    super();
    this.local = new LocalZoneSchemeRepository();
  }

  get() { return this.local.get(); }

  save(choice) {
    this.local.save(choice);
    storage.set(KEYS.ZONE_SCHEME_PENDING, true);
    this.#push().catch(() => {});   // no signal: stays pending for the next sync
  }

  async #userId() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  }

  async #push() {
    const uid = await this.#userId();
    if (!uid) return false;
    const { error } = await supabase.from('user_settings')
      .upsert({ user_id: uid, zone_scheme: this.local.get() ?? null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    storage.remove(KEYS.ZONE_SCHEME_PENDING);
    storage.set(KEYS.ZONE_SCHEME_OWNER, uid);
    return true;
  }

  // → { data: { changed: boolean }, error }. Never throws.
  async sync() {
    try {
      const uid = await this.#userId();
      if (!uid) return { data: { changed: false }, error: null };
      const owner = storage.get(KEYS.ZONE_SCHEME_OWNER)
      const mine = !owner || owner === uid   // the device copy is this person's (or unclaimed)
      if (storage.get(KEYS.ZONE_SCHEME_PENDING) && mine) {
        await this.#push();
        return { data: { changed: false }, error: null };
      }
      storage.remove(KEYS.ZONE_SCHEME_PENDING);
      const { data, error } = await supabase.from('user_settings').select('zone_scheme').eq('user_id', uid).maybeSingle();
      if (error) return { data: { changed: false }, error };
      if (!data) {
        // Nothing on the account yet: keep this device's choice and save it there — if it's theirs.
        if (mine) {
          if (this.local.get()) await this.#push(); else storage.set(KEYS.ZONE_SCHEME_OWNER, uid);
          return { data: { changed: false }, error: null };
        }
        const had = this.local.get() != null;
        this.local.save(null);                     // someone else's choice: back to the default
        storage.set(KEYS.ZONE_SCHEME_OWNER, uid);
        return { data: { changed: had }, error: null };
      }
      const before = JSON.stringify(this.local.get() ?? null);
      const after = JSON.stringify(data.zone_scheme ?? null);
      if (before !== after) this.local.save(data.zone_scheme ?? null);
      storage.set(KEYS.ZONE_SCHEME_OWNER, uid);
      return { data: { changed: before !== after }, error: null };
    } catch (e) {
      return { data: { changed: false }, error: { message: e.message } };
    }
  }
}
