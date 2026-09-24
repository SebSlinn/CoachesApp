//repositories/supabase/SupabaseResultsRepository.js
// Performance results in the Supabase `performance_results` table.
// Converts between the app's field names (distM, timeSec, ...) and the
// table's columns (dist_m, time_sec, ...) so nothing above this file ever
// sees a column name. Access is enforced by RLS; created_by/updated_by are
// stamped by the database.
import { supabase } from '../../supabaseClient';
import { IResultsRepository } from '../interfaces/IResultsRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

const COLUMNS = 'id, athlete_user_id, swum_on, kind, stroke, dist_m, pool_type, time_sec, splits, location, notes, source, created_by, updated_by, created_at, updated_at';

// app field  → column
const FIELD_TO_COLUMN = {
  swumOn: 'swum_on',
  kind: 'kind',
  stroke: 'stroke',
  distM: 'dist_m',
  poolType: 'pool_type',
  timeSec: 'time_sec',
  splits: 'splits',
  location: 'location',
  note: 'notes',
  source: 'source',
};

function toRow(result) {
  const row = {};
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (result[field] !== undefined) row[column] = result[field];
  }
  if (row.dist_m != null) row.dist_m = Number(row.dist_m);
  if (row.time_sec != null) row.time_sec = Number(row.time_sec);
  return row;
}

function fromRow(row) {
  if (!row) return row;
  return {
    id: row.id,
    athleteId: row.athlete_user_id,
    swumOn: row.swum_on,
    kind: row.kind,
    stroke: row.stroke,
    distM: row.dist_m,
    poolType: row.pool_type,
    timeSec: row.time_sec != null ? Number(row.time_sec) : null,   // numeric arrives as a string
    splits: row.splits,
    location: row.location,
    note: row.notes,
    source: row.source,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const mapOne = ({ data, error }) => ({ data: fromRow(data), error });
const mapMany = ({ data, error }) => ({ data: data ? data.map(fromRow) : data, error });

export class SupabaseResultsRepository extends IResultsRepository {
  async list(athleteId, filter = {}) {
    if (!supabase) return UNAVAILABLE;
    let query = supabase
      .from('performance_results')
      .select(COLUMNS)
      .eq('athlete_user_id', athleteId)
      .order('swum_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (filter.stroke) query = query.eq('stroke', filter.stroke);
    if (filter.distM) query = query.eq('dist_m', Number(filter.distM));
    if (filter.kind) query = query.eq('kind', filter.kind);
    if (filter.from) query = query.gte('swum_on', filter.from);
    if (filter.to) query = query.lte('swum_on', filter.to);
    return mapMany(await query);
  }

  async add(athleteId, result) {
    if (!supabase) return UNAVAILABLE;
    return mapOne(await supabase
      .from('performance_results')
      .insert({ ...toRow(result), athlete_user_id: athleteId })
      .select(COLUMNS)
      .single());
  }

  async addMany(athleteId, results) {
    if (!supabase) return UNAVAILABLE;
    return mapMany(await supabase
      .from('performance_results')
      .insert(results.map((r) => ({ ...toRow(r), athlete_user_id: athleteId })))
      .select(COLUMNS));
  }

  async update(resultId, changes) {
    if (!supabase) return UNAVAILABLE;
    return mapOne(await supabase
      .from('performance_results')
      .update(toRow(changes))
      .eq('id', resultId)
      .select(COLUMNS)
      .single());
  }

  async remove(resultId) {
    if (!supabase) return UNAVAILABLE;
    const { error } = await supabase.from('performance_results').delete().eq('id', resultId);
    return { data: null, error };
  }
}
