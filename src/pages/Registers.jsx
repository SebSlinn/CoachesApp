// pages/Registers.jsx — /registers
//   Start a register for one or more of your groups (or copy the last one), and see recent ones.
//   "Get ready for poolside" saves the group lists on this phone so a register can be started and
//   taken with no signal; taps wait on the phone and sync when signal returns.
// You can only pick groups where you have "Take registers". The database enforces every rule.
// Talks only to services/registersOffline.js (+ registerLabels.js for words).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { errorText } from '../services/registers'
import {
  listForScreen, startRegister, prepareForPoolside, offlineSummary, flushAll, dismissFailed,
} from '../services/registersOffline'
import { registerableGroups, copyOf, todayLocal, when, clock, POOL_TYPES } from '../services/registerLabels'
import { S, Badge, Message, Tick, useAction } from '../components/AccountsUi'

const DAYS_BACK = 21
const PAGE = { ...S.page, padding: 'clamp(16px, 4vw, 40px)' }

export default function Registers() {
  const navigate = useNavigate()
  const { memberships } = useAuth()
  const [summary, setSummary] = useState(() => offlineSummary())
  // With no signal there are no memberships; fall back to the groups saved by "Get ready".
  const groups = useMemo(() => {
    const g = registerableGroups(memberships)
    return g.length ? g : summary.groups
  }, [memberships, summary])
  const [list, setList] = useState(null)
  const [offline, setOffline] = useState(false)
  const [form, setForm] = useState(null)
  const load = useAction()

  const reload = useCallback(async () => {
    const mFrom = new Date(Date.now() - DAYS_BACK * 86400000).toISOString()
    const r = await load.run(() => listForScreen(mFrom), null, errorText)
    setList(r?.data || [])
    setOffline(!!r?.offline)
    setSummary(offlineSummary())
  }, [])
  useEffect(() => { reload() }, [reload])
  useEffect(() => {
    const on = () => reload()
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [reload])

  const lastMine = (list || []).find((r) => r.can_run)
  const today = todayLocal()
  const openToday = (list || []).filter((r) => r.status === 'open')
  const go = (r) => navigate('/registers/' + encodeURIComponent(r.key || r.register_id))

  return (
    <div style={PAGE}>
      <div style={S.head}>
        <h2 style={S.h2}>Registers</h2>
        <div style={S.row}>
          {!offline && <button style={S.btn} onClick={() => navigate('/registers/attendance')}>Attendance grid</button>}
          <button style={S.btn} onClick={() => navigate('/dashboard')}>Back</button>
        </div>
      </div>

      <OfflinePanel summary={summary} offline={offline} onChanged={reload} />

      {groups.length === 0 && (
        <p style={S.muted}>You can't take registers for any group yet. A Team Manager can give you "Take registers" in the group.</p>
      )}

      {groups.length > 0 && !form && (
        <div style={{ ...S.row, marginBottom: 12 }}>
          <button style={S.primary} onClick={() => setForm(blankForm(today))}>New register</button>
          {lastMine && (
            <button style={S.btn} onClick={() => setForm({ ...copyOf(lastMine, today), fromCopy: lastMine.group_names?.join(' + ') })}>
              Copy last: {lastMine.group_names?.join(' + ')} · {when(lastMine.starts_at, lastMine.ends_at).split(' · ')[1]}
            </button>
          )}
        </div>
      )}

      {form && (
        <NewRegisterForm groups={groups} initial={form} onCancel={() => setForm(null)}
          onCreated={(id) => navigate('/registers/' + encodeURIComponent(id))} />
      )}

      {openToday.length > 0 && <h3 style={S.h3}>Open</h3>}
      {openToday.map((r) => <RegisterRow key={r.key} r={r} onOpen={() => go(r)} />)}

      <h3 style={S.h3}>Last {DAYS_BACK} days</h3>
      <Message error={load.error} />
      {list && list.filter((r) => r.status !== 'open').length === 0 && <p style={S.muted}>No closed registers yet.</p>}
      {(list || []).filter((r) => r.status !== 'open')
        .map((r) => <RegisterRow key={r.key} r={r} onOpen={() => go(r)} />)}
    </div>
  )
}

function blankForm(pDate) {
  return { orgIds: [], date: pDate, startTime: '', endTime: '', venue: '', poolType: '' }
}

function RegisterRow({ r, onOpen }) {
  return (
    <div style={{ ...S.card, cursor: 'pointer' }} onClick={onOpen}>
      <div style={S.row}>
        <strong>{when(r.starts_at, r.ends_at)}</strong>
        <span style={S.muted}>{(r.group_names || []).join(' + ')}{r.venue ? ' · ' + r.venue : ''}</span>
        <span style={{ flex: 1 }} />
        <span style={S.small}>In {r.in_count}/{r.expected} · Out {r.out_count}/{r.in_count}</span>
        {r.status === 'open' && r.still_in > 0 && <Badge kind="warn">{r.still_in} still in</Badge>}
        {r.unsynced > 0 && <Badge kind="danger">not synced</Badge>}
        {r.status === 'open' ? <Badge kind="staff">open</Badge> : <Badge>closed</Badge>}
      </div>
    </div>
  )
}

// Get ready (needs signal), what's waiting to sync, and anything the database refused.
function OfflinePanel({ summary, offline, onChanged }) {
  const act = useAction()
  const ready = async () => { await act.run(prepareForPoolside, (d) => `Ready: ${d.groups.length} group(s) saved on this phone.`, errorText); onChanged() }
  const sync = async () => { await act.run(flushAll, null, errorText); onChanged() }
  const age = summary.preparedAt ? when(summary.preparedAt).split(' · ')[0] + ' ' + clock(summary.preparedAt) : null
  return (
    <div style={{ ...S.card, background: offline ? '#fff8e1' : undefined }}>
      <div style={S.row}>
        {offline ? <Badge kind="warn">No signal</Badge> : <Badge kind="staff">Online</Badge>}
        <span style={S.small}>{age ? `Lists saved on this phone ${age}.` : 'Nothing saved on this phone yet.'}</span>
        <span style={{ flex: 1 }} />
        {!offline && <button style={S.btn} disabled={act.busy} onClick={ready}>Get ready for poolside</button>}
      </div>
      {summary.pendingTaps > 0 || summary.pendingRegisters > 0 ? (
        <div style={{ ...S.row, marginTop: 8 }}>
          <Badge kind="danger">{summary.pendingTaps} tap(s) not synced</Badge>
          <span style={S.muted}>They're saved on this phone and go when there's signal.</span>
          {!offline && <button style={S.btn} disabled={act.busy} onClick={sync}>Sync now</button>}
        </div>
      ) : null}
      {summary.failed.length > 0 && (
        <div style={{ ...S.panel }}>
          <strong style={S.small}>{summary.failed.length} tap(s) the database refused when they were sent</strong>
          {summary.failed.slice(0, 8).map((f, i) => (
            <div key={i} style={S.muted}>{f.op?.action || 'tap'}: {errorText({ message: f.error })}</div>
          ))}
          <button style={{ ...S.btn, marginTop: 6 }} onClick={() => { dismissFailed(); onChanged() }}>OK, clear</button>
        </div>
      )}
      <Message error={act.error} ok={act.ok} />
      {!offline && !summary.preparedAt && (
        <p style={{ ...S.muted, margin: '6px 0 0' }}>Before a session where there may be no signal, press "Get ready" here with internet.</p>
      )}
    </div>
  )
}

function NewRegisterForm({ groups, initial, onCancel, onCreated }) {
  const [f, setF] = useState(initial)
  const act = useAction()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const toggle = (pOrgId, pOn) => setF({ ...f, orgIds: pOn ? [...f.orgIds, pOrgId] : f.orgIds.filter((x) => x !== pOrgId) })
  // A copied register may name a group you no longer take registers for.
  const lost = f.orgIds.filter((id) => !groups.some((g) => g.org_id === id))

  const start = async () => {
    const r = await act.run(() => startRegister({ ...f, orgIds: f.orgIds.filter((id) => !lost.includes(id)) }), null, errorText)
    if (r?.data) onCreated(r.data)
  }

  return (
    <div style={{ ...S.card, ...S.panel }}>
      <strong>{initial.fromCopy ? `Like last time (${initial.fromCopy})` : 'New register'}</strong>
      <label style={S.label}>Groups</label>
      {groups.map((g) => (
        <Tick key={g.org_id} checked={f.orgIds.includes(g.org_id)} onChange={(v) => toggle(g.org_id, v)}>{g.name}</Tick>
      ))}
      {lost.length > 0 && <p style={S.muted}>{lost.length} group from last time is left out: you can't take its register any more.</p>}
      <p style={S.muted}>The expected list fills from each group's members. A swimmer in two of these groups appears once, under the first.</p>
      <div style={S.row}>
        <div><label style={S.label}>Date</label><input type="date" style={S.input} value={f.date} onChange={set('date')} /></div>
        <div><label style={S.label}>Start</label><input type="time" style={{ ...S.input, minWidth: 110 }} value={f.startTime} onChange={set('startTime')} /></div>
        <div><label style={S.label}>End (optional)</label><input type="time" style={{ ...S.input, minWidth: 110 }} value={f.endTime} onChange={set('endTime')} /></div>
      </div>
      <div style={S.row}>
        <div><label style={S.label}>Venue (optional)</label><input style={S.input} value={f.venue} onChange={set('venue')} placeholder="e.g. Calday Pool" /></div>
        <div>
          <label style={S.label}>Pool</label>
          <select style={{ ...S.input, minWidth: 110 }} value={f.poolType} onChange={set('poolType')}>
            <option value="">—</option>
            {POOL_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div style={{ ...S.row, marginTop: 14 }}>
        <button style={S.primary} disabled={act.busy || !f.orgIds.length || !f.date || !f.startTime} onClick={start}>Start register</button>
        <button style={S.btn} onClick={onCancel}>Cancel</button>
      </div>
      <Message error={act.error} />
    </div>
  )
}
