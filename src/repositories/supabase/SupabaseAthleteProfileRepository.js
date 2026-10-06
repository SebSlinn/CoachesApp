//repositories/supabase/SupabaseAthleteProfileRepository.js
// Per-athlete coaching profile in the Supabase `athlete_profiles` table. Maps
// app fields (athleteType, phvStatus, …) to columns so nothing above this file
// sees a column name. RLS (has_log_access) decides who may read/edit.
import { supabase } from '../../supabaseClient';
import { IAthleteProfileRepository } from '../interfaces/IAthleteProfileRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

const COLUMNS = 'athlete_user_id, athlete_type, phv_status, derived_profile, se_number, club, updated_by, updated_at';

const FIELD_TO_COLUMN = {
  athleteType: 'athlete_type',
  phvStatus: 'phv_status',
  derivedProfile: 'derived_profile',
  seNumber: 'se_number',
  club: 'club',
};

function toRow(pAthleteId, p) {
  const row = { athlete_user_id: pAthleteId };
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (p[field] !== undefined) row[column] = p[field];
  }
  return row;
}

function fromRow(row) {
  if (!row) return null;
  return {
    athleteId: row.athlete_user_id,
    athleteType: row.athlete_type,
    phvStatus: row.phv_status,
    derivedProfile: row.derived_profile,
    seNumber: row.se_number,
    club: row.club,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export class SupabaseAthleteProfileRepository extends IAthleteProfileRepository {
  async get(pAthleteId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('athlete_profiles')
      .select(COLUMNS)
      .eq('athlete_user_id', pAthleteId)
      .maybeSingle();
    return { data: fromRow(data), error };
  }

  async upsert(pAthleteId, pProfile) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('athlete_profiles')
      .upsert(toRow(pAthleteId, pProfile), { onConflict: 'athlete_user_id' })
      .select(COLUMNS)
      .single();
    return { data: fromRow(data), error };
  }
}
