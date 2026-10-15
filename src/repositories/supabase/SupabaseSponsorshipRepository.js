//repositories/supabase/SupabaseSponsorshipRepository.js
// Sponsorship backed by Supabase: RPCs for every read and change, and the
// add-athlete Edge Function for creating accounts (it needs the service-role
// key, which never reaches the browser).
import { supabase } from '../../supabaseClient';
import { ISponsorshipRepository } from '../interfaces/ISponsorshipRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

export class SupabaseSponsorshipRepository extends ISponsorshipRepository {
  async #rpc(name, args) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase.rpc(name, args);
    return { data, error };
  }

  async canSponsor() { return this.#rpc('can_sponsor'); }
  async isRoot() { return this.#rpc('is_root'); }
  async getTree() { return this.#rpc('sponsorship_tree'); }
  async sponsorGroup(sponsorOrgId, orgId) { return this.#rpc('sponsor_group', { p_sponsor_org: sponsorOrgId, p_org: orgId }); }
  async setStatus(id, status) { return this.#rpc('set_sponsorship_status', { p_sponsorship: id, p_status: status }); }
  async setDailyAddLimit(limit) { return this.#rpc('set_daily_add_limit', { p_limit: limit }); }
  async setGroupDailyLimit(orgId, limit) { return this.#rpc('set_group_daily_limit', { p_org: orgId, p_limit: limit }); }
  async verifyQualification(id, verified = true) { return this.#rpc('verify_qualification', { p_id: id, p_verified: verified }); }

  async addPerson(person) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase.functions.invoke('add-athlete', {
      body: {
        organisation_id: person.organisationId,
        email: person.email,
        full_name: person.fullName,
        date_of_birth: person.dateOfBirth || null,
        guardian_emails: person.guardianEmails || [],
      },
    });
    if (!error) return { data, error: null };

    // The function replies { error: 'CODE: message' } — surface that, not the generic HTTP text.
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch { /* keep the generic message */ }
    return { data: null, error: { message } };
  }
}
