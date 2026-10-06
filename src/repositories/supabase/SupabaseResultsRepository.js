//src/repositories/supabase/SupabaseResultsRepository.js

//repositories/supabase/SupabaseResultsRepository.js
// Performance results in the Supabase `performance_results` table.
// Converts between the app's field names (distM, timeSec, ...) and the
// table's columns (dist_m, time_sec, ...) so nothing above this file ever
// sees a column name. Access is enforced by RLS; created_by/updated_by are
// stamped by the database.
//
// Athlete Records (Part A) additions:
//   • single-swim provenance + effort + sync fields (append-only history)
//   • sets-as-swum: set_efforts parent + one performance_results row per rep
//   • listHistory / importMany / addSetResult / listSetEfforts / …ByProtocol
//
// Test Set Library additions (2026-09-30):
//   • rep `metrics` { sc, sr, hr, rpe, lactate } ↔ performance_results.metrics
//   • run `summary` (analyser output) ↔ set_efforts.summary; updateSetEffortSummary
//   • addSetResult is idempotent on the effort's client_uuid (re-save = no-op)
// Set reps live in performance_results with effort_id set; the single-swim
// queries (list, listHistory) exclude them with `.is('effort_id', null)`.
import { supabase } from '../../supabaseClient';
import { IResultsRepository } from '../interfaces/IResultsRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

const COLUMNS = 'id, athlete_user_id, client_uuid, swum_on, kind, effort, stroke, dist_m, pool_type, time_sec, splits, location, notes, source, effort_id, rep_no, pb_at_swim_sec, sanctioned, awarding_body, country, meet_name, import_ref, metrics, created_by, updated_by, created_at, updated_at';

const EFFORT_COLUMNS = 'id, athlete_user_id, client_uuid, swum_on, protocol_id, set_json, conditions, summary, source, created_by, created_at';

// app field  → column   (scalars mapped 1:1)
const FIELD_TO_COLUMN = {
  clientUuid: 'client_uuid',
  swumOn: 'swum_on',
  kind: 'kind',
  effort: 'effort',
  stroke: 'stroke',
  distM: 'dist_m',
  poolType: 'pool_type',
  timeSec: 'time_sec',
  splits: 'splits',
  location: 'location',
  note: 'notes',
  source: 'source',
  effortId: 'effort_id',
  repNo: 'rep_no',
  pbAtSwim: 'pb_at_swim_sec',
  metrics: 'metrics',
};

function toRow(result) {
  const row = {};
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (result[field] !== undefined) row[column] = result[field];
  }
  // A swimzone.result/1 carries the client dedup key in `id`; map it across
  // unless clientUuid was given explicitly. (The table PK is separate.)
  if (row.client_uuid === undefined && result.id !== undefined && result.clientUuid === undefined) {
    row.client_uuid = result.id;
  }
  // provenance sub-object → flat columns
  const p = result.provenance;
  if (p) {
    if (p.sanctioned !== undefined) row.sanctioned = p.sanctioned;
    if (p.awardingBody !== undefined) row.awarding_body = p.awardingBody;
    if (p.country !== undefined) row.country = p.country;
    if (p.meetName !== undefined) row.meet_name = p.meetName;
    if (p.importRef !== undefined) row.import_ref = p.importRef;
  }
  if (row.metrics === null) delete row.metrics;   // column is NOT NULL default '{}'
  if (row.dist_m != null) row.dist_m = Number(row.dist_m);
  if (row.time_sec != null) row.time_sec = Number(row.time_sec);
  if (row.pb_at_swim_sec != null) row.pb_at_swim_sec = Number(row.pb_at_swim_sec);
  return row;
}

function fromRow(row) {
  if (!row) return row;
  return {
    id: row.id,
    athleteId: row.athlete_user_id,
    clientUuid: row.client_uuid,
    swumOn: row.swum_on,
    kind: row.kind,
    effort: row.effort,
    stroke: row.stroke,
    distM: row.dist_m,
    poolType: row.pool_type,
    timeSec: row.time_sec != null ? Number(row.time_sec) : null,   // numeric arrives as a string
    splits: row.splits,
    location: row.location,
    note: row.notes,
    source: row.source,
    effortId: row.effort_id,
    repNo: row.rep_no,
    pbAtSwim: row.pb_at_swim_sec != null ? Number(row.pb_at_swim_sec) : null,
    metrics: row.metrics || {},
    provenance: (row.meet_name != null || row.import_ref != null || row.sanctioned != null)
      ? { sanctioned: row.sanctioned, awardingBody: row.awarding_body, country: row.country,
          meetName: row.meet_name, importRef: row.import_ref }
      : undefined,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function effortFromRow(row) {
  if (!row) return row;
  return {
    id: row.id,
    athleteId: row.athlete_user_id,
    clientUuid: row.client_uuid,
    swumOn: row.swum_on,
    protocolId: row.protocol_id,
    set: row.set_json,
    conditions: row.conditions,
    summary: row.summary,
    source: row.source,
    reps: row.reps ? row.reps.map(fromRow) : undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const mapOne = ({ data, error }) => ({ data: fromRow(data), error });
const mapMany = ({ data, error }) => ({ data: data ? data.map(fromRow) : data, error });

export class SupabaseResultsRepository extends IResultsRepository {
  // Single-swim log: excludes set reps so the log stays "one row per swim".
  async list(athleteId, filter = {}) {
    if (!supabase) return UNAVAILABLE;
    let query = supabase
      .from('performance_results')
      .select(COLUMNS)
      .eq('athlete_user_id', athleteId)
      .is('effort_id', null)
      .order('swum_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (filter.stroke) query = query.eq('stroke', filter.stroke);
    if (filter.distM) query = query.eq('dist_m', Number(filter.distM));
    if (filter.kind) query = query.eq('kind', filter.kind);
    if (filter.from) query = query.gte('swum_on', filter.from);
    if (filter.to) query = query.lte('swum_on', filter.to);
    return mapMany(await query);
  }

  // Progression: all single swims for one event, oldest→newest.
  async listHistory(athleteId, { stroke, distM } = {}) {
    if (!supabase) return UNAVAILABLE;
    let query = supabase
      .from('performance_results')
      .select(COLUMNS)
      .eq('athlete_user_id', athleteId)
      .is('effort_id', null)
      .order('swum_on', { ascending: true })
      .order('created_at', { ascending: true });
    if (stroke) query = query.eq('stroke', stroke);
    if (distM != null) query = query.eq('dist_m', Number(distM));
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

  // Idempotent bulk insert keyed on client_uuid — for ingesting a Poolside
  // export file (each record carries its client UUID). Re-importing the same
  // file is a no-op. Relies on the NON-partial client_uuid unique index as the
  // ON CONFLICT arbiter.
  async addManyIdempotent(athleteId, results) {
    if (!supabase) return UNAVAILABLE;
    const rows = results.map((r) => ({ ...toRow(r), athlete_user_id: athleteId }));
    const { data, error } = await supabase
      .from('performance_results')
      .upsert(rows, { onConflict: 'client_uuid', ignoreDuplicates: true })
      .select('id');
    if (error) return { data: null, error };
    const added = (data || []).length;
    return { data: { added, skipped: rows.length - added }, error: null };
  }

  // Append-only competition import. The DB partial unique index
  // (athlete, stroke, dist_m, swum_on, meet_name) WHERE source='import'
  // makes re-import a no-op; ignoreDuplicates keeps a faster OR slower later
  // race as a NEW row and never overwrites an existing one.
  async importMany(athleteId, rows) {
    if (!supabase) return UNAVAILABLE;
    const mapped = rows.map((r) => ({ ...toRow({ ...r, source: 'import' }), athlete_user_id: athleteId }));
    const { data, error } = await supabase
      .from('performance_results')
      .upsert(mapped, {
        onConflict: 'athlete_user_id,stroke,dist_m,swum_on,meet_name',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) return { data: null, error };
    const added = (data || []).length;
    return { data: { added, skipped: mapped.length - added }, error: null };
  }

  // A set as swum → one set_efforts parent + one performance_results row per
  // rep. Not one DB transaction from the client, so on a rep failure we delete
  // the parent (its FK cascade removes any reps already written).
  // Idempotent: saving the same run again (same client_uuid) is a no-op that
  // returns { alreadyPresent: true } — e.g. re-importing a Poolside file.
  async addSetResult(athleteId, sr) {
    if (!supabase) return UNAVAILABLE;
    const parent = {
      athlete_user_id: athleteId,
      client_uuid: sr.clientUuid ?? sr.id ?? null,
      swum_on: sr.swumOn,
      protocol_id: sr.protocolId ?? null,
      set_json: sr.set,
      conditions: sr.conditions ?? {},
      summary: sr.summary ?? null,
      source: sr.source || 'stopwatch',
    };
    const { data: eff, error: e1 } = await supabase
      .from('set_efforts')
      .insert(parent)
      .select('id')
      .single();
    if (e1) {
      // 23505 = unique violation; on client_uuid it means this run is already saved.
      if (e1.code === '23505' && parent.client_uuid && /client_uuid/.test(`${e1.message} ${e1.details || ''}`)) {
        return { data: { effortId: null, reps: 0, alreadyPresent: true }, error: null };
      }
      return { data: null, error: e1 };
    }

    const reps = (sr.reps || []).map((rep) => ({
      athlete_user_id: athleteId,
      effort_id: eff.id,
      rep_no: rep.repNo,
      swum_on: sr.swumOn,
      kind: 'training',
      effort: rep.effort || 'submaximal',   // reps are never maximal singles
      stroke: rep.stroke,
      dist_m: rep.distM != null ? Number(rep.distM) : null,
      pool_type: rep.poolType ?? sr.conditions?.poolType,
      time_sec: rep.timeSec != null ? Number(rep.timeSec) : null,
      pb_at_swim_sec: rep.pbAtSwim != null ? Number(rep.pbAtSwim) : null,
      metrics: rep.metrics ?? {},
      splits: rep.splits ?? null,
      source: parent.source,
      notes: rep.note ?? null,
    }));

    if (reps.length) {
      const { error: e2 } = await supabase.from('performance_results').insert(reps);
      if (e2) {
        await supabase.from('set_efforts').delete().eq('id', eff.id);
        return { data: null, error: e2 };
      }
    }
    return { data: { effortId: eff.id, reps: reps.length, alreadyPresent: false }, error: null };
  }

  // Rewrite one run's derived summary (after an analyser improves). Reps untouched.
  async updateSetEffortSummary(effortId, summary) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('set_efforts')
      .update({ summary })
      .eq('id', effortId)
      .select('id');
    if (error) return { data: null, error };
    return { data: { updated: (data || []).length }, error: null };
  }

  async listSetEfforts(athleteId, { protocolId, from, to } = {}) {
    if (!supabase) return UNAVAILABLE;
    let query = supabase
      .from('set_efforts')
      .select(EFFORT_COLUMNS)
      .eq('athlete_user_id', athleteId)
      .order('swum_on', { ascending: true });
    if (protocolId) query = query.eq('protocol_id', protocolId);
    if (from) query = query.gte('swum_on', from);
    if (to) query = query.lte('swum_on', to);
    const { data, error } = await query;
    return { data: data ? data.map(effortFromRow) : data, error };
  }

  // Every set effort for an athlete WITH its reps — the Records page's set
  // drill-down and compare view (one call rather than a fetch per click).
  async listSetEffortsWithReps(athleteId, { protocolId, from, to } = {}) {
    if (!supabase) return UNAVAILABLE;
    let query = supabase
      .from('set_efforts')
      .select(`${EFFORT_COLUMNS}, reps:performance_results!effort_id(${COLUMNS})`)
      .eq('athlete_user_id', athleteId)
      .order('swum_on', { ascending: true });
    if (protocolId) query = query.eq('protocol_id', protocolId);
    if (from) query = query.gte('swum_on', from);
    if (to) query = query.lte('swum_on', to);
    const { data, error } = await query;
    const mEfforts = data ? data.map(effortFromRow) : data;
    for (const e of mEfforts || []) if (e.reps) e.reps.sort((x, y) => (x.repNo || 0) - (y.repNo || 0));
    return { data: mEfforts, error };
  }

  // Efforts + their reps, for side-by-side test comparison across the season.
  // The embed names the FK (effort_id) because performance_results has >1 FK.
  async listSetEffortsByProtocol(protocolId, athleteId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('set_efforts')
      .select(`${EFFORT_COLUMNS}, reps:performance_results!effort_id(${COLUMNS})`)
      .eq('protocol_id', protocolId)
      .eq('athlete_user_id', athleteId)
      .order('swum_on', { ascending: true });
    return { data: data ? data.map(effortFromRow) : data, error };
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
