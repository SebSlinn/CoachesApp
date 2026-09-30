//repositories/supabase/SupabaseProtocolsRepository.js
// The Test Set Library in the Supabase `test_protocols` table. Maps the app's
// field names (ownerOrgId, set, …) to columns (owner_org_id, set_json, …) so
// nothing above this file sees a column name. RLS decides what's visible and
// who may edit; the DB locks a protocol on first use.
import { supabase } from '../../supabaseClient';
import { IProtocolsRepository } from '../interfaces/IProtocolsRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

const COLUMNS = 'id, key, version, name, description, owner_org_id, set_json, measures, params, analyser, locked, created_by, created_at, updated_at';

const FIELD_TO_COLUMN = {
  key: 'key',
  version: 'version',
  name: 'name',
  description: 'description',
  ownerOrgId: 'owner_org_id',
  set: 'set_json',
  measures: 'measures',
  params: 'params',
  analyser: 'analyser',
};

function toRow(p) {
  const row = {};
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (p[field] !== undefined) row[column] = p[field];
  }
  return row;
}

function fromRow(row) {
  if (!row) return row;
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    name: row.name,
    description: row.description,
    ownerOrgId: row.owner_org_id,
    set: row.set_json,
    measures: row.measures,
    params: row.params || {},
    analyser: row.analyser,
    locked: row.locked,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const mapOne = ({ data, error }) => ({ data: fromRow(data), error });
const mapMany = ({ data, error }) => ({ data: data ? data.map(fromRow) : data, error });

export class SupabaseProtocolsRepository extends IProtocolsRepository {
  async list({ key } = {}) {
    if (!supabase) return UNAVAILABLE;
    let query = supabase
      .from('test_protocols')
      .select(COLUMNS)
      .order('key', { ascending: true })
      .order('version', { ascending: false });
    if (key) query = query.eq('key', key);
    return mapMany(await query);
  }

  async get(id) {
    if (!supabase) return UNAVAILABLE;
    return mapOne(await supabase.from('test_protocols').select(COLUMNS).eq('id', id).single());
  }

  async maxVersion(ownerOrgId, key) {
    if (!supabase) return UNAVAILABLE;
    let query = supabase.from('test_protocols').select('version').eq('key', key)
      .order('version', { ascending: false }).limit(1);
    query = ownerOrgId ? query.eq('owner_org_id', ownerOrgId) : query.is('owner_org_id', null);
    const { data, error } = await query;
    if (error) return { data: null, error };
    return { data: data && data.length ? data[0].version : 0, error: null };
  }

  async create(protocol) {
    if (!supabase) return UNAVAILABLE;
    return mapOne(await supabase.from('test_protocols').insert(toRow(protocol)).select(COLUMNS).single());
  }

  async update(id, changes) {
    if (!supabase) return UNAVAILABLE;
    return mapOne(await supabase.from('test_protocols').update(toRow(changes)).eq('id', id).select(COLUMNS).single());
  }

  async remove(id) {
    if (!supabase) return UNAVAILABLE;
    // RLS turns a disallowed delete (not an editor, or locked) into "0 rows",
    // not an error — so ask for the deleted id back and report the no-op.
    const { data, error } = await supabase.from('test_protocols').delete().eq('id', id).select('id');
    if (error) return { data: null, error };
    if (!data || data.length === 0) {
      return { data: null, error: { message: 'NOT_ALLOWED: protocol not deleted (used in results, or not yours to edit)' } };
    }
    return { data: null, error: null };
  }
}
