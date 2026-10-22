// pages/Registers.jsx — /registers
//   Start a register for one or more of your groups (or copy the last one), and see recent ones.
// You can only pick groups where you have "Take registers". The database enforces every rule.
// Talks only to services/registers.js (+ registerLabels.js for words).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { listRegisters, createRegister, errorText } from '../services/registers'
import { registerableGroups, copyOf, todayLocal, when, POOL_TYPES } from '../services/registerLabels'
import { S, Badge, Message, Tick, useAction } from '../components/AccountsUi'

const DAYS_BACK = 21
const PAGE = { ...S.page, padding: 'clamp(16px, 4vw, 40px)' }

export default function Registers() {
  const navigate = useNavigate()
  const { memberships } = useAuth()
  const groups = useMemo(() => registerableGroups(memberships), [memberships])
  const [list, setList] = useState(null)
  const [form, setForm] = useState(null)
  const load = useAction()

  useEffect(() => {
    const mFrom = new Date(Date.now() - DAYS_BACK * 86400000).toISOString()
    load.run(() => listRegisters(mFrom), null, errorText).then((r) => setList(r?.data || []))
  }, [])

  const lastMine = (list || []).find((r) => r.can_run)
  const today = todayLocal()
  const openToday = (list || []).filter((r) => r.status === 'open')

  return (
    <div style={PAGE}>
      <div style={S.head}>
        <h2 style={S.h2}>Registers</h2>
        <button style={S.btn} onClick={() => navigate('/dashboard')}>Back</button>
      </div>

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
          onCreated={(id) => navigate('/registers/' + id)} />
      )}

      {openToday.length > 0 && <h3 style={S.h3}>Open</h3>}
      {openToday.map((r) => <RegisterRow key={r.register_id} r={r} onOpen={() => navigate('/registers/' + r.register_id)} />)}

      <h3 style={S.h3}>Last {DAYS_BACK} days</h3>
      <Message error={load.error} />
      {list && list.filter((r) => r.status !== 'open').length === 0 && <p style={S.muted}>No closed registers yet.</p>}
      {(list || []).filter((r) => r.status !== 'open')
        .map((r) => <RegisterRow key={r.register_id} r={r} onOpen={() => navigate('/registers/' + r.register_id)} />)}
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
        {r.status === 'open' ? <Badge kind="staff">open</Badge> : <Badge>closed</Badge>}
      </div>
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
    const r = await act.run(() => createRegister({ ...f, orgIds: f.orgIds.filter((id) => !lost.includes(id)) }), null, errorText)
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
