// pages/Register.jsx — /registers/:registerId — the coach's poolside screen.
//   Tap a name to tick them in. Sign out: full session, or partial (reason, time, metres or %).
//   Counters per group and overall are the roll call; closing warns if anyone is still in.
// Every tap is logged in the database with who and when. Two coaches can work the same register:
// it refreshes every 20 seconds while open, and the latest tap wins.
// Talks only to services/registers.js (+ registerLabels.js for words).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getRegisterSheet, getRegisterCandidates, addRegisterEntry, markEntry, tickIn, signOutFull, signOutPartial,
  signOutAll, closeRegister, reopenRegister, errorText,
} from '../services/registers'
import { rollCall, entryStatus, when, PARTIAL_REASONS } from '../services/registerLabels'
import { S, Badge, Message, useAction } from '../components/AccountsUi'

const REFRESH_MS = 20000
const PAGE = { ...S.page, padding: 'clamp(16px, 4vw, 40px)' }   // phone-width poolside
const UNDO_MS = 60000

const R = {
  bigCount: { fontSize: 22, fontWeight: 700 },
  group: { margin: '22px 0 8px', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  rowBase: { border: '1px solid #8886', borderRadius: 10, padding: '10px 12px', marginBottom: 6, display: 'flex',
             alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 44, userSelect: 'none' },
  name: { fontSize: 17, fontWeight: 600 },
  tick: { width: 30, height: 30, borderRadius: 15, border: '2px solid #30b0c7', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 18, flex: '0 0 auto' },
  chip: { padding: '6px 12px', fontSize: 14, borderRadius: 16, cursor: 'pointer', border: '1px solid #8889', background: 'transparent' },
  chipOn: { background: '#30b0c7', color: '#fff', border: '1px solid #30b0c7' },
  foot: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 24, paddingTop: 16, borderTop: '1px solid #8884' },
}
const ROW_TONE = {
  expected: {}, absent: { opacity: 0.55 }, apologies: { opacity: 0.55 },
  in: { borderColor: '#30b0c7', background: '#30b0c712' },
  out: { borderColor: '#2a2', background: '#22aa2212' },
}

export default function Register() {
  const { registerId } = useParams()
  const navigate = useNavigate()
  const [sheet, setSheet] = useState(null)
  const [recent, setRecent] = useState({})       // entryId → time I ticked them in (for Undo)
  const load = useAction()
  const act = useAction()
  const [confirmClose, setConfirmClose] = useState(null)

  const refresh = useCallback(async () => {
    const r = await getRegisterSheet(registerId)
    if (r.error) { load.setError(errorText(r.error)); return }
    load.setError(null)
    setSheet(r.data)
  }, [registerId])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (sheet?.register?.status !== 'open') return undefined
    const t = setInterval(() => { if (!document.hidden) refresh() }, REFRESH_MS)
    return () => clearInterval(t)
  }, [sheet?.register?.status, refresh])

  // Put the entry the database returned into the sheet (keeps name etc. from the sheet row).
  const merge = (pEntry) => setSheet((s) => s && ({ ...s, entries: s.entries.map((e) => (e.id === pEntry.id ? { ...e, ...pEntry } : e)) }))
  const patchLocal = (pId, pPatch) => setSheet((s) => s && ({ ...s, entries: s.entries.map((e) => (e.id === pId ? { ...e, ...pPatch } : e)) }))

  // Every tap: optimistic for tick-in (instant poolside), then the database's answer wins.
  const tap = async (pEntry, pFn, pOptimistic) => {
    if (pOptimistic) patchLocal(pEntry.id, pOptimistic)
    const r = await act.run(pFn, null, errorText)
    if (r?.data) merge(r.data)
    else refresh()
    return r
  }

  const rc = useMemo(() => rollCall(sheet?.entries), [sheet])

  if (!sheet) {
    return (
      <div style={PAGE}>
        <div style={S.head}><h2 style={S.h2}>Register</h2><button style={S.btn} onClick={() => navigate('/registers')}>Back</button></div>
        {load.error ? <Message error={load.error} /> : <p style={S.muted}>Loading…</p>}
      </div>
    )
  }

  const reg = sheet.register
  const open = reg.status === 'open'

  const doClose = async (pForce) => {
    const r = await closeRegister(registerId, pForce)
    if (r.error && /^STILL_IN/.test(r.error.message || '')) { setConfirmClose(errorText(r.error)); return }
    if (r.error) { act.setError(errorText(r.error)); return }
    setConfirmClose(null); refresh()
  }

  return (
    <div style={PAGE}>
      <div style={S.head}>
        <div>
          <h2 style={S.h2}>{when(reg.starts_at, reg.ends_at)}</h2>
          <div style={S.muted}>{[reg.venue, reg.pool_type, 'started by ' + reg.created_by_name].filter(Boolean).join(' · ')}</div>
        </div>
        <div style={S.row}>
          <span style={R.bigCount}>In {rc.all.in}/{rc.all.on}</span>
          <span style={R.bigCount}>Out {rc.all.out}/{rc.all.in}</span>
          {open ? <Badge kind="staff">open</Badge> : <Badge>closed</Badge>}
          <button style={S.btn} onClick={refresh}>Refresh</button>
          <button style={S.btn} onClick={() => navigate('/registers')}>Back</button>
        </div>
      </div>
      {!open && <div style={S.banner}>This register is closed. {reg.can_run ? 'Reopen it to change anything.' : ''}</div>}
      {open && rc.all.stillIn > 0 && rc.all.out > 0 && (
        <div style={S.banner}>{rc.all.stillIn} still in — not signed out yet.</div>
      )}
      <Message error={act.error || load.error} />

      {sheet.groups.map((g) => {
        const mEntries = sheet.entries.filter((e) => e.register_group_id === g.id)
        const c = rc.byGroup[g.id] || { on: 0, in: 0, out: 0, stillIn: 0 }
        const mCan = open && g.can_take
        return (
          <section key={g.id}>
            <div style={R.group}>
              <h3 style={{ margin: 0 }}>{g.name}</h3>
              {g.label && <span style={S.muted}>{g.label}</span>}
              {g.plan_title && <span style={S.muted}>Plan: {g.plan_title}</span>}
              <span style={{ flex: 1 }} />
              <span style={S.small}>{c.in}/{c.on} in{c.in ? ` · ${c.out}/${c.in} out` : ''}</span>
              {!g.can_take && <Badge>view only</Badge>}
            </div>
            {mEntries.length === 0 && <p style={S.muted}>No swimmers in this group.</p>}
            {mEntries.map((e) => (
              <EntryRow key={e.id} e={e} canTake={mCan} busy={act.busy}
                justTicked={recent[e.id] && Date.now() - recent[e.id] < UNDO_MS}
                onTickIn={async () => {
                  const r = await tap(e, () => tickIn(e.id), { attendance: 'in', in_at: new Date().toISOString() })
                  if (r?.data) setRecent((m) => ({ ...m, [e.id]: Date.now() }))
                }}
                onAction={(pAction) => tap(e, () => markEntry(e.id, pAction))}
                onOutFull={() => tap(e, () => signOutFull(e.id))}
                onOutPartial={(p) => tap(e, () => signOutPartial(e.id, p))}
              />
            ))}
            {mCan && <AddSwimmer registerGroupId={g.id} groupName={g.name} onAdded={refresh} />}
          </section>
        )
      })}

      <div style={R.foot}>
        {open && rc.all.stillIn > 0 && (
          <button style={S.primary} disabled={act.busy}
            onClick={async () => { await act.run(() => signOutAll(registerId), (n) => `${n} signed out — full session.`, errorText); refresh() }}>
            Sign everyone still in out — full session ({rc.all.stillIn})
          </button>
        )}
        {open && reg.can_run && !confirmClose && <button style={S.btn} onClick={() => doClose(false)}>Close register</button>}
        {!open && reg.can_run && (
          <button style={S.btn} onClick={async () => { await act.run(() => reopenRegister(registerId), null, errorText); refresh() }}>Reopen</button>
        )}
        {open && !reg.can_run && <span style={S.muted}>Only someone who takes registers for every group here can close it.</span>}
      </div>
      {confirmClose && (
        <div style={S.banner}>
          <strong>{confirmClose}</strong>
          <div style={S.small}>Check where they are before closing. Closing anyway is recorded.</div>
          <div style={{ ...S.row, marginTop: 8 }}>
            <button style={S.btn} onClick={() => doClose(true)}>Close anyway</button>
            <button style={S.btn} onClick={() => setConfirmClose(null)}>Go back</button>
          </div>
        </div>
      )}
      <Message ok={act.ok} />
    </div>
  )
}

// ---------------------------------------------------------------------------
function EntryRow({ e, canTake, busy, justTicked, onTickIn, onAction, onOutFull, onOutPartial }) {
  const [menu, setMenu] = useState(false)
  const [partial, setPartial] = useState(false)
  const isOut = !!e.completion
  const tone = isOut ? ROW_TONE.out : ROW_TONE[e.attendance] || {}
  const canTickIn = canTake && e.attendance !== 'in'
  const stop = (fn) => (ev) => { ev.stopPropagation(); fn() }

  return (
    <div>
      <div style={{ ...R.rowBase, ...tone, cursor: canTickIn ? 'pointer' : 'default' }}
        onClick={canTickIn && !busy ? onTickIn : undefined}
        title={canTickIn ? 'Tap to tick in' : e.updated_by_name ? `Last changed by ${e.updated_by_name}` : ''}>
        <span style={{ ...R.tick, background: e.attendance === 'in' ? (isOut ? '#2a2' : '#30b0c7') : 'transparent',
                       borderColor: isOut ? '#2a2' : '#30b0c7', color: '#fff' }}>
          {isOut ? '✓' : e.attendance === 'in' ? '•' : ''}
        </span>
        <span style={R.name}>{e.name}</span>
        {e.is_junior && <Badge kind="warn">U18</Badge>}
        <span style={S.muted}>{entryStatus(e)}</span>
        {e.coach_note && <span style={S.muted}>— {e.coach_note}</span>}
        <span style={{ flex: 1 }} />
        {canTake && justTicked && e.attendance === 'in' && !isOut && (
          <button style={S.btn} disabled={busy} onClick={stop(() => onAction('undo_in'))}>Undo</button>
        )}
        {canTake && e.attendance === 'in' && !isOut && (
          <>
            <button style={S.btn} disabled={busy} onClick={stop(onOutFull)}>Out — full</button>
            <button style={S.btn} disabled={busy} onClick={stop(() => setPartial(!partial))}>Partial…</button>
          </>
        )}
        {canTake && <button style={S.btn} aria-label="More" onClick={stop(() => setMenu(!menu))}>⋯</button>}
      </div>
      {e.athlete_note && <div style={{ ...S.muted, margin: '-2px 0 8px 52px' }}>Swimmer's note: {e.athlete_note}</div>}
      {menu && canTake && (
        <div style={{ ...S.row, margin: '0 0 8px 40px' }}>
          {!isOut && e.attendance !== 'absent' && <button style={S.btn} onClick={() => { setMenu(false); onAction('absent') }}>Absent</button>}
          {!isOut && e.attendance !== 'apologies' && <button style={S.btn} onClick={() => { setMenu(false); onAction('apologies') }}>Apologies</button>}
          {!isOut && e.attendance === 'in' && <button style={S.btn} onClick={() => { setMenu(false); onAction('undo_in') }}>Undo tick-in</button>}
          {!isOut && (e.attendance === 'absent' || e.attendance === 'apologies') && <button style={S.btn} onClick={() => { setMenu(false); onAction('expected') }}>Back to expected</button>}
          {isOut && <button style={S.btn} onClick={() => { setMenu(false); onAction('undo_out') }}>Undo sign-out</button>}
          <button style={S.btn} onClick={() => setMenu(false)}>Close</button>
          {e.updated_by_name && <span style={S.muted}>Last changed by {e.updated_by_name}</span>}
        </div>
      )}
      {partial && (
        <PartialPanel busy={busy} onCancel={() => setPartial(false)}
          onSave={async (p) => { const r = await onOutPartial(p); if (r?.data) setPartial(false) }} />
      )}
    </div>
  )
}

function PartialPanel({ busy, onSave, onCancel }) {
  const [reason, setReason] = useState('')
  const [unit, setUnit] = useState('m')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  return (
    <div style={{ ...S.panel, margin: '0 0 10px 40px' }}>
      <div style={S.row}>
        {PARTIAL_REASONS.map((r) => (
          <button key={r.key} style={{ ...R.chip, ...(reason === r.key ? R.chipOn : {}) }} onClick={() => setReason(r.key)}>{r.label}</button>
        ))}
      </div>
      <div style={{ ...S.row, marginTop: 10 }}>
        <span style={S.small}>Did about</span>
        <input style={{ ...S.input, minWidth: 80, width: 90 }} inputMode="numeric" value={amount}
          onChange={(ev) => setAmount(ev.target.value.replace(/[^0-9]/g, ''))} placeholder="optional" />
        <select style={{ ...S.input, minWidth: 70 }} value={unit} onChange={(ev) => setUnit(ev.target.value)}>
          <option value="m">metres</option><option value="pct">%</option>
        </select>
        <input style={{ ...S.input, flex: 1 }} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Note (optional)" />
      </div>
      <div style={{ ...S.row, marginTop: 10 }}>
        <button style={S.primary} disabled={busy || !reason}
          onClick={() => onSave({ reason, note, doneM: unit === 'm' ? amount : '', donePct: unit === 'pct' ? amount : '' })}>
          Sign out — partial
        </button>
        <button style={S.btn} onClick={onCancel}>Cancel</button>
        <span style={S.muted}>Time is now.</span>
      </div>
    </div>
  )
}

function AddSwimmer({ registerGroupId, groupName, onAdded }) {
  const [open, setOpen] = useState(false)
  const [cands, setCands] = useState(null)
  const [pick, setPick] = useState('')
  const act = useAction()
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const show = async () => {
    setOpen(true)
    const r = await act.run(() => getRegisterCandidates(registerGroupId), null, errorText)
    if (mounted.current) setCands(r?.data || [])
  }
  const add = async () => {
    const r = await act.run(() => addRegisterEntry(registerGroupId, pick), null, errorText)
    if (r?.data) { setPick(''); setOpen(false); setCands(null); onAdded() }
  }

  if (!open) return <button style={{ ...S.btn, marginTop: 4 }} onClick={show}>+ Add a swimmer from {groupName}</button>
  return (
    <div style={{ ...S.row, marginTop: 4 }}>
      {cands && cands.length === 0 && <span style={S.muted}>Everyone in {groupName} is already on the register.</span>}
      {cands && cands.length > 0 && (
        <>
          <select style={S.input} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Pick a member of {groupName}…</option>
            {cands.map((c) => <option key={c.athlete_user_id} value={c.athlete_user_id}>{c.name}</option>)}
          </select>
          <button style={S.btn} disabled={!pick || act.busy} onClick={add}>Add</button>
        </>
      )}
      <button style={S.btn} onClick={() => setOpen(false)}>Cancel</button>
      <Message error={act.error} />
    </div>
  )
}
