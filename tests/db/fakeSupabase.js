// tests/db/fakeSupabase.js — a small stand-in for the supabase-js client that runs
// the query-builder calls our repositories make as real SQL on PGlite, as a
// signed-in user (role `authenticated`, auth.uid() = that user), so Row Level
// Security, triggers, constraints and the real migrations all apply.
//
// It covers only what SupabaseResultsRepository / SupabaseProtocolsRepository use:
//   from(t).select(cols | 'a, alias:child!fk(cols)') .insert(row|rows) .upsert(rows,{onConflict,ignoreDuplicates})
//   .update(v) .delete() .eq .neq .is .gte .lte .in .order .limit .single .maybeSingle
// and returns { data, error } with values shaped like PostgREST JSON
// (dates 'YYYY-MM-DD', timestamps ISO, numeric as string, jsonb as objects).

let DB = null;
let UID = null;
let TYPES = null;   // table -> column -> udt_name

export function attach(db) { DB = db; TYPES = null; }
export function signIn(userId) { UID = userId; }

async function types() {
  if (TYPES) return TYPES;
  const r = await DB.query(`select table_name, column_name, udt_name from information_schema.columns where table_schema = 'public'`);
  TYPES = {};
  for (const x of r.rows) (TYPES[x.table_name] ||= {})[x.column_name] = x.udt_name;
  return TYPES;
}

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseCols(sel) {
  const plain = [], embeds = [];
  for (const tok of splitTop(sel || '*')) {
    const m = tok.match(/^(\w+):(\w+)!(\w+)\((.*)\)$/s);
    if (m) embeds.push({ alias: m[1], table: m[2], fk: m[3], cols: m[4] });
    else plain.push(tok);
  }
  return { plain, embeds };
}

function outVal(v, udt) {
  if (v == null) return v;
  if (udt === 'date' && v instanceof Date) return v.toISOString().slice(0, 10);
  if ((udt === 'timestamptz' || udt === 'timestamp') && v instanceof Date) return v.toISOString();
  if (udt === 'numeric' && typeof v !== 'string') return String(v);
  return v;
}
function shape(rows, table, T) {
  return rows.map((r) => { const o = {}; for (const k of Object.keys(r)) o[k] = outVal(r[k], (T[table] || {})[k]); return o; });
}
function inParam(v, udt) {
  if (v == null) return null;
  if (udt === 'jsonb' || udt === 'json') return JSON.stringify(v);
  if (udt && udt.startsWith('_')) return v;           // arrays (text[]) pass through
  return v;
}

class Query {
  constructor(table) {
    Object.assign(this, { table, op: 'select', cols: '*', filters: [], orders: [], lim: null, mode: null, rows: null, vals: null, opt: {}, returning: null });
  }
  select(cols = '*') { if (this.op === 'select') this.cols = cols; else this.returning = cols; return this; }
  insert(r) { this.op = 'insert'; this.rows = Array.isArray(r) ? r : [r]; return this; }
  upsert(r, opt = {}) { this.op = 'upsert'; this.rows = Array.isArray(r) ? r : [r]; this.opt = opt; return this; }
  update(v) { this.op = 'update'; this.vals = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push([c, '=', v]); return this; }
  neq(c, v) { this.filters.push([c, '<>', v]); return this; }
  gte(c, v) { this.filters.push([c, '>=', v]); return this; }
  lte(c, v) { this.filters.push([c, '<=', v]); return this; }
  is(c, v) { this.filters.push([c, 'is', v]); return this; }
  in(c, v) { this.filters.push([c, 'in', v]); return this; }
  order(c, { ascending = true } = {}) { this.orders.push(`${q(c)} ${ascending ? 'asc' : 'desc'}`); return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(res, rej) { return this.run().then(res, rej); }

  where(params, T) {
    if (!this.filters.length) return '';
    return ' where ' + this.filters.map(([c, op, v]) => {
      if (op === 'is') return `${q(c)} is ${v === null ? 'null' : v ? 'true' : 'false'}`;
      if (op === 'in') { params.push(v); return `${q(c)} = any($${params.length})`; }
      params.push(inParam(v, T[this.table]?.[c])); return `${q(c)} ${op} $${params.length}::${T[this.table]?.[c] || 'text'}`;
    }).join(' and ');
  }

  async run() {
    const T = await types();
    try {
      await DB.exec(`reset role; select set_config('request.jwt.claim.sub', '${UID || ''}', false);`);
      if (UID) await DB.exec('set role authenticated');
      let data = await this.exec(T);
      if (this.mode === 'single' || this.mode === 'maybe') {
        if (data.length > 1 || (this.mode === 'single' && data.length === 0)) {
          return { data: null, error: { code: 'PGRST116', message: `JSON object requested, ${data.length} rows returned` } };
        }
        data = data[0] ?? null;
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message, details: e.detail || null } };
    } finally {
      await DB.exec('reset role');
    }
  }

  async exec(T) {
    const params = [];
    const t = q(this.table);
    if (this.op === 'select') {
      const { plain, embeds } = parseCols(this.cols);
      const need = embeds.length && !plain.includes('id') && !plain.includes('*') ? ['id'] : [];
      const colSql = plain.concat(need).map((c) => (c === '*' ? '*' : q(c))).join(', ');
      let sql = `select ${colSql} from ${t}${this.where(params, T)}`;
      if (this.orders.length) sql += ' order by ' + this.orders.join(', ');
      if (this.lim != null) sql += ` limit ${Number(this.lim)}`;
      const rows = shape((await DB.query(sql, params)).rows, this.table, T);
      for (const e of embeds) {
        const ec = parseCols(e.cols).plain.map(q).join(', ');
        for (const r of rows) {
          const kids = await DB.query(`select ${ec} from ${q(e.table)} where ${q(e.fk)} = $1::uuid`, [r.id]);
          r[e.alias] = shape(kids.rows, e.table, T);
        }
      }
      if (need.length) rows.forEach((r) => delete r.id);
      return rows;
    }
    const ret = this.returning ? ' returning ' + parseCols(this.returning).plain.map((c) => (c === '*' ? '*' : q(c))).join(', ') : '';
    if (this.op === 'insert' || this.op === 'upsert') {
      const cols = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
      const values = this.rows.map((r) => '(' + cols.map((c) => {
        if (!(c in r) || r[c] === undefined) return 'default';
        params.push(inParam(r[c], T[this.table]?.[c])); return `$${params.length}::${T[this.table]?.[c] || 'text'}`;
      }).join(', ') + ')').join(', ');
      let sql = `insert into ${t} (${cols.map(q).join(', ')}) values ${values}`;
      if (this.op === 'upsert') {
        const on = (this.opt.onConflict || 'id').split(',').map((c) => q(c.trim())).join(', ');
        sql += this.opt.ignoreDuplicates ? ` on conflict (${on}) do nothing`
          : ` on conflict (${on}) do update set ` + cols.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ');
      }
      return shape((await DB.query(sql + ret, params)).rows, this.table, T);
    }
    if (this.op === 'update') {
      const sets = Object.entries(this.vals).filter(([, v]) => v !== undefined).map(([c, v]) => {
        params.push(inParam(v, T[this.table]?.[c])); return `${q(c)} = $${params.length}::${T[this.table]?.[c] || 'text'}`;
      }).join(', ');
      return shape((await DB.query(`update ${t} set ${sets}${this.where(params, T)}${ret}`, params)).rows, this.table, T);
    }
    if (this.op === 'delete') {
      return shape((await DB.query(`delete from ${t}${this.where(params, T)}${ret}`, params)).rows, this.table, T);
    }
    throw new Error('fakeSupabase: unsupported op ' + this.op);
  }
}

export const supabase = {
  from: (table) => new Query(table),
  auth: { getSession: async () => ({ data: { session: UID ? { user: { id: UID } } : null }, error: null }) },
};
