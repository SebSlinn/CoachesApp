//repositories/supabase/SupabaseRegisterRepository.js
// Registers backed by Supabase. Reads go through SECURITY DEFINER functions that return only
// what the caller may see (my_registers, register_sheet, …); every change is an RPC.
import { supabase } from '../../supabaseClient';
import { IRegisterRepository } from '../interfaces/IRegisterRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

export class SupabaseRegisterRepository extends IRegisterRepository {
  async #rpc(name, args) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase.rpc(name, args);
    return { data, error };
  }

  // ---- reads ----
  async list(from, to) { return this.#rpc('my_registers', { p_from: from ?? null, p_to: to ?? null }); }
  async getSheet(registerId) { return this.#rpc('register_sheet', { p_register: registerId }); }
  async getCandidates(registerGroupId) { return this.#rpc('register_candidates', { p_register_group: registerGroupId }); }
  async getAthleteEntries(athleteId, from, to) {
    return this.#rpc('my_register_entries', { p_athlete: athleteId, p_from: from ?? null, p_to: to ?? null });
  }

  // ---- writes ----
  async create(r) {
    return this.#rpc('create_register', {
      p_org_ids: r.orgIds, p_starts_at: r.startsAt, p_ends_at: r.endsAt ?? null,
      p_venue: r.venue ?? null, p_pool_type: r.poolType ?? null, p_client_uuid: r.clientUuid ?? null,
    });
  }
  async addGroup(registerId, orgId) { return this.#rpc('add_register_group', { p_register: registerId, p_org: orgId }); }
  async addEntry(registerGroupId, athleteId) {
    return this.#rpc('add_register_entry', { p_register_group: registerGroupId, p_athlete: athleteId });
  }
  async mark(entryId, action, at, detail, clientUuid) {
    return this.#rpc('mark_register_entry', {
      p_entry: entryId, p_action: action, p_at: at ?? null, p_detail: detail ?? {}, p_client_uuid: clientUuid ?? null,
    });
  }
  async signOutAll(registerId, at) { return this.#rpc('sign_out_all', { p_register: registerId, p_at: at ?? null }); }
  async close(registerId, force) { return this.#rpc('close_register', { p_register: registerId, p_force: !!force }); }
  async reopen(registerId) { return this.#rpc('reopen_register', { p_register: registerId }); }
  // Offline support: everything to take poolside, and one register's queued taps in one call.
  async prepare() { return this.#rpc('register_prepare', {}); }
  async sync(payload) { return this.#rpc('sync_register', { p: payload }); }
  // Scanning and cards (online only)
  async scan(registerId, code, at, orgId, clientUuid) {
    return this.#rpc('scan_register', { p_register: registerId, p_code: code, p_at: at ?? null, p_org: orgId ?? null, p_client_uuid: clientUuid ?? null });
  }
  async qrCode(userId) { return this.#rpc('register_qr_code', userId ? { p_user: userId } : {}); }
  async groupQrCodes(orgId) { return this.#rpc('group_register_qr_codes', { p_org: orgId }); }
  async linkCard(userId, code, kind, label) {
    return this.#rpc('link_register_card', { p_user: userId, p_code: code, p_kind: kind || 'other', p_label: label ?? null });
  }
  async revokeCard(cardId) { return this.#rpc('revoke_register_card', { p_card: cardId }); }
  async listCards(userId) { return this.#rpc('list_register_cards', userId ? { p_user: userId } : {}); }
  // Summaries and volume
  async setSessionSummary(rgId, text, volumeM, breakdown) {
    return this.#rpc('set_session_summary', { p_register_group: rgId, p_text: text ?? null, p_volume_m: volumeM ?? null, p_breakdown: breakdown ?? null });
  }
  async setEntryVolume(entryId, volumeM) { return this.#rpc('set_entry_volume', { p_entry: entryId, p_volume_m: volumeM ?? null }); }
  async setMySessionSummary(entryId, volumeM, breakdown) {
    return this.#rpc('set_my_session_summary', { p_entry: entryId, p_volume_m: volumeM ?? null, p_breakdown: breakdown ?? null });
  }
  async trainingLog(athleteId, from, to) { return this.#rpc('athlete_training_log', { p_athlete: athleteId, p_from: from ?? null, p_to: to ?? null }); }
  async cellDetail(entryId) { return this.#rpc('register_cell_detail', { p_entry: entryId }); }
  // The coach's grid
  async attendance(orgId, from, to) { return this.#rpc('group_attendance', { p_org: orgId, p_from: from, p_to: to }); }
  async setNote(entryId, note, share) {
    return this.#rpc('set_register_note', { p_entry: entryId, p_note: note ?? null, p_share: share ?? null });
  }
}
