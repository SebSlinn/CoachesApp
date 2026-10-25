//repositories/supabase/SupabaseSignupRepository.js
// Open sign-up backed by Supabase: RPCs for the switch, the self-signup Edge Function for accounts.
import { supabase } from '../../supabaseClient';
import { ISignupRepository } from '../interfaces/ISignupRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

export class SupabaseSignupRepository extends ISignupRepository {
  async #rpc(name, args) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase.rpc(name, args);
    return { data, error };
  }

  async #invoke(body) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase.functions.invoke('self-signup', { body });
    if (!error) return { data, error: null };
    // The function replies { error: 'CODE: message' } — surface that, not the generic HTTP text.
    let message = error.message;
    try {
      const b = await error.context.json();
      if (b?.error) message = b.error;
    } catch { /* keep the generic message */ }
    return { data: null, error: { message } };
  }

  async isOpen() { return this.#rpc('is_open_signup', {}); }
  async setOpen(open) { return this.#rpc('set_open_signup', { p_open: !!open }); }
  async recent(days = 30) { return this.#rpc('recent_self_signups', { p_days: days }); }
  async signUp(p) { return this.#invoke({ action: 'signup', email: p.email, full_name: p.fullName, website: p.website || '' }); }
  async addChild(c) { return this.#invoke({ action: 'add_child', email: c.email, full_name: c.fullName, date_of_birth: c.dateOfBirth }); }
}
