//repositories/supabase/SupabaseAthleteProfileRepository.js
// Per-athlete coaching profile in the Supabase `athlete_profiles` table. Maps
// app fields (athleteType, phvStatus, …) to columns so nothing above this file
// sees a column name. RLS (has_log_access) decides who may read/edit.
import { supabase } from '../../supabaseClient';
import { IAthleteProfileRepository } from '../interfaces/IAthleteProfileRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

const COLUMNS = 'athlete_user_id, athlete_type, phv_status, derived_profile, se_number, club, updated_by, updated_at';

// Max HR columns (20261014120000_athlete_max_hr.sql). Until that migration has
// run they don't exist: reads retry without them and saves drop them, so the
// rest of the profile keeps working (same pattern as started_at in results).
const HR_COLUMNS = COLUMNS + ', max_hr, max_hr_source, max_hr_on';
const HR_FIELDS = ['maxHr', 'maxHrSource', 'maxHrOn'];
const missingHrCol = (e) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /max_hr/.test(`${e.message || ''} ${e.details || ''}`));

const FIELD_TO_COLUMN = {
  athleteType: 'athlete_type',
  phvStatus: 'phv_status',
  derivedProfile: 'derived_profile',
  seNumber: 'se_number',
  club: 'club',
  maxHr: 'max_hr',
  maxHrSource: 'max_hr_source',
  maxHrOn: 'max_hr_on',
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
    maxHr: row.max_hr ?? null,
    maxHrSource: row.max_hr_source ?? null,
    maxHrOn: row.max_hr_on ?? null,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export class SupabaseAthleteProfileRepository extends IAthleteProfileRepository {
  async get(pAthleteId) {
    if (!supabase) return UNAVAILABLE;
    const run = (cols) => supabase
      .from('athlete_profiles')
      .select(cols)
      .eq('athlete_user_id', pAthleteId)
      .maybeSingle();
    let { data, error } = await run(HR_COLUMNS);
    if (missingHrCol(error)) ({ data, error } = await run(COLUMNS));
    return { data: fromRow(data), error };
  }

  async upsert(pAthleteId, pProfile) {
    if (!supabase) return UNAVAILABLE;
    const run = (row, cols) => supabase
      .from('athlete_profiles')
      .upsert(row, { onConflict: 'athlete_user_id' })
      .select(cols)
      .single();
    let { data, error } = await run(toRow(pAthleteId, pProfile), HR_COLUMNS);
    if (missingHrCol(error)) {
      const mWithoutHr = Object.fromEntries(Object.entries(pProfile).filter(([k]) => !HR_FIELDS.includes(k)));
      ({ data, error } = await run(toRow(pAthleteId, mWithoutHr), COLUMNS));
      if (!error && HR_FIELDS.some((k) => pProfile[k] != null)) {
        return { data: fromRow(data), error: null,
                 warning: 'Max HR not saved: the database needs the 20261014120000_athlete_max_hr migration.' };
      }
    }
    return { data: fromRow(data), error };
  }

  // users.date_of_birth — readable by the athlete and anyone with a log-sharing
  // link to them (sz_users_related). Not visible → null, not an error.
  async getDateOfBirth(pAthleteId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('users')
      .select('date_of_birth')
      .eq('id', pAthleteId)
      .maybeSingle();
    return { data: data?.date_of_birth || null, error };
  }
}
