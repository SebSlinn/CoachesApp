// pages/Register.jsx — /registers/:registerId — the coach's poolside screen.
//   Tap a name to tick them in. Sign out: full session, or partial (reason, time, metres or %).
//   Counters per group and overall are the roll call; closing warns if anyone is still in.
//   With signal: a scan box (card/fob reader, camera QR, or typed code) ticks in — a second scan
//   10+ min later signs out. Guests by typed name, comments on the session and on each swimmer.
// Every tap is logged in the database with who and when. Two coaches can work the same register:
// it refreshes every 20 seconds while open, and the latest tap wins.
// Works with no signal: taps are saved on the phone and sync when signal returns (registersOffline.js).
// Talks only to services/registersOffline.js (+ registers.js for errorText, registerLabels.js for words).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { errorText, scanCode, linkCard } from '../services/registers'
import {
  openRegister, tap as tapEntry, tapPartial, addSwimmer, swimmersToAdd, tapSignOutAll, tapClose, reopen, flushOne,
  addGuest, commentEntry, commentRegister,
} from '../services/registersOffline'
import { isLocalKey } from '../services/registerOffline'
import { rollCall, entryStatus, when, scanText, PARTIAL_REASONS } from '../services/registerLabels'
import { S, Badge, Message, useAction } from '../components/AccountsUi'
import ScanBox from '../components/ScanBox'

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
  const key = registerId   // a register id, or 'local:<uuid>' for one made on this phone with no signal
  const navigate = useNavigate()
  const [sheet, setSheet] = useState(null)
  const [pending, setPending] = useState(0)
  const [offline, setOffline] = useState(false)
  const [recent, setRecent] = useState({})       // entryId → time I ticked them in (for Undo)
  const load = useAction()
  const act = useAction()
  const [confirmClose, setConfirmClose] = useState(null)

  // Show what the service says: the sheet with any not-yet-synced taps on top.
  const show = useCallback((r) => {
    if (r?.data?.movedTo) { navigate('/registers/' + encodeURIComponent(r.data.movedTo), { replace: true }); return }
    if (r?.data?.sheet) { setSheet(r.data.sheet); setPending(r.data.pending || 0); setOffline(!!r.data.offline) }
  }, [navigate])

  const refresh = useCallback(async () => {
    const r = await openRegister(key)
    if (r.error) { load.setError(errorText(r.error)); return }
    load.setError(null)
    show(r)
  }, [key, show])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    window.addEventListener('online', refresh)
    return () => window.removeEventListener('online', refresh)
  }, [refresh])
  useEffect(() => {
    if (sheet?.register?.status !== 'open') return undefined
    const t = setInterval(() => { if (!document.hidden) refresh() }, REFRESH_MS)
    return () => clearInterval(t)
  }, [sheet?.register?.status, refresh])

  const patchLocal = (pId, pPatch) => setSheet((s) => s && ({ ...s, entries: s.entries.map((e) => (e.id === pId ? { ...e, ...pPatch } : e)) }))

  // Every tap: saved on the phone, sent if there's signal; tick-in shows instantly.
  const tap = async (pEntry, pFn, pOptimistic) => {
    if (pOptimistic) patchLocal(pEntry.id, pOptimistic)
    const r = await act.run(pFn, null, errorText)
    if (r?.data) show(r)
    else refresh()
    return r
  }

  const rc = useMemo(() => rollCall(sheet?.entries), [sheet])

  if (!sheet) {
    return (
      <div style={PAGE}>
        <div style={S.head}><h2 style={S.h2}>Register</h2><button style={S.btn} onClick={() => navigate('/registers')}>Back</button></div>
        {load.error ? <Message error={load.error} /> : <p style={S.muted}>Loading…</p>}
        {load.error && <button style={S.btn} onClick={() => navigate('/registers')}>Get ready / list</button>}
      </div>
    )
  }

  const reg = sheet.register
  const open = reg.status === 'open'

  const doClose = async (pForce) => {
    const r = await tapClose(key, pForce)
    if (r.error && /^STILL_IN/.test(r.error.message || '')) { setConfirmClose(errorText(r.error)); return }
    if (r.error) { act.setError(errorText(r.error)); return }
    setConfirmClose(null); show(r)
  }

  return (
    <div style={PAGE}>
      <div style={S.head}>
        <div>
          <h2 style={S.h2}>{when(reg.starts_at, reg.ends_at)}</h2>
          <div style={S.muted}>{[reg.venue, reg.pool_type, 'started by ' + reg.created_by_name].filter(Boolean).join(' · ')}</div>
          <SessionComment comment={reg.comment} canEdit={open && sheet.groups.some((g) => g.can_take)}
            onSave={async (t) => { const r = await act.run(() => commentRegister(key, t), null, errorText); if (r) show(r) }} />
        </div>
        <div style={S.row}>
          <span style={R.bigCount}>In {rc.all.in}/{rc.all.on}</span>
          <span style={R.bigCount}>Out {rc.all.out}/{rc.all.in}</span>
          {open ? <Badge kind="staff">open</Badge> : <Badge>closed</Badge>}
          <button style={S.btn} onClick={refresh}>Refresh</button>
          <button style={S.btn} onClick={() => navigate('/registers')}>Back</button>
        </div>
      </div>
      {(offline || pending > 0) && (
        <div style={{ ...S.banner, ...(offline ? {} : { background: '#e8f0fe', borderColor: '#174ea6', color: '#174ea6' }) }}>
          <strong>{offline ? 'No signal. ' : ''}{pending > 0 ? `${pending} tap(s) saved on this phone, not synced yet.` : 'Showing the copy saved on this phone.'}</strong>
          <div style={S.small}>Keep going — they sync when signal returns. Don't sign out of SwimZone on this phone until they have.</div>
          {!offline && pending > 0 && <button style={{ ...S.btn, marginTop: 6 }} onClick={async () => { await flushOne(key); refresh() }}>Sync now</button>}
        </div>
      )}
      {!open && <div style={S.banner}>This register is closed. {reg.can_run ? 'Reopen it to change anything.' : ''}</div>}
      {open && rc.all.stillIn > 0 && rc.all.out > 0 && (
        <div style={S.banner}>{rc.all.stillIn} still in — not signed out yet.</div>
      )}
      <Message error={act.error || load.error} />

      {open && !offline && !isLocalKey(key) && sheet.groups.some((g) => g.can_take) && (
        <ScanPanel registerKey={key} sheet={sheet} onDone={refresh} />
      )}

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
                  const r = await tap(e, () => tapEntry(key, e, 'in'), { attendance: 'in', in_at: new Date().toISOString() })
                  if (r?.data) setRecent((m) => ({ ...m, [e.id]: Date.now() }))
                }}
                onAction={(pAction) => tap(e, () => tapEntry(key, e, pAction))}
                onOutFull={() => tap(e, () => tapEntry(key, e, 'out_full'))}
                onOutPartial={(p) => tap(e, () => tapPartial(key, e, p))}
                onComment={(t) => tap(e, () => commentEntry(key, e, t))}
              />
            ))}
            {mCan && (
              <div style={{ ...S.row, marginTop: 4 }}>
                <AddSwimmer registerKey={key} group={g} onAdded={show} />
                <AddGuest onAdd={async (name) => { const r = await act.run(() => addGuest(key, g, name), null, errorText); if (r) show(r); return r }} />
              </div>
            )}
          </section>
        )
      })}

      <div style={R.foot}>
        {open && rc.all.stillIn > 0 && (
          <button style={S.primary} disabled={act.busy}
            onClick={async () => { const r = await act.run(() => tapSignOutAll(key), (d) => 'Signed out — full session.', errorText); if (r) show(r) }}>
            Sign everyone still in out — full session ({rc.all.stillIn})
          </button>
        )}
        {open && reg.can_run && !confirmClose && <button style={S.btn} onClick={() => doClose(false)}>Close register</button>}
        {!open && reg.can_run && (
          <button style={S.btn} onClick={async () => { const r = await act.run(() => reopen(key), null, errorText); if (r) show(r) }}>Reopen</button>
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
function EntryRow({ e, canTake, busy, justTicked, onTickIn, onAction, onOutFull, onOutPartial, onComment }) {
  const [menu, setMenu] = useState(false)
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')
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
        {e.kind === 'visitor' && <Badge kind="role" title="On SwimZone, not in this group: added by scanning their code">visitor</Badge>}
        {e.kind === 'guest' && <Badge title="Typed-in name, not on SwimZone">guest</Badge>}
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
          <button style={S.btn} onClick={() => { setMenu(false); setComment(e.coach_note || ''); setCommenting(true) }}>Comment…</button>
          <button style={S.btn} onClick={() => setMenu(false)}>Close</button>
          {e.updated_by_name && <span style={S.muted}>Last changed by {e.updated_by_name}</span>}
        </div>
      )}
      {commenting && (
        <div style={{ ...S.row, margin: '0 0 8px 40px' }}>
          <input style={{ ...S.input, flex: 1 }} value={comment} autoFocus placeholder="Comment on this swimmer"
            onChange={(ev) => setComment(ev.target.value)} />
          <button style={S.btn} disabled={busy} onClick={async () => { const r = await onComment(comment); if (r?.data) setCommenting(false) }}>Save</button>
          <button style={S.btn} onClick={() => setCommenting(false)}>Cancel</button>
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

function AddSwimmer({ registerKey, group, onAdded }) {
  const groupName = group.name
  const [open, setOpen] = useState(false)
  const [cands, setCands] = useState(null)
  const [pick, setPick] = useState('')
  const act = useAction()
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const show = async () => {
    setOpen(true)
    const r = await act.run(() => swimmersToAdd(registerKey, group), null, errorText)
    if (mounted.current) setCands(r?.data || [])
  }
  const add = async () => {
    const r = await act.run(() => addSwimmer(registerKey, group, { athlete_user_id: pick }), null, errorText)
    if (r?.data) { setPick(''); setOpen(false); setCands(null); onAdded(r) }
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

// The session's comment (pool closed, lane shut, who covered…). Works offline.
function SessionComment({ comment, canEdit, onSave }) {
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState(comment || '')
  if (edit) {
    return (
      <div style={{ ...S.row, marginTop: 6 }}>
        <input style={{ ...S.input, flex: 1 }} value={text} autoFocus placeholder="Comment on this session" onChange={(e) => setText(e.target.value)} />
        <button style={S.btn} onClick={async () => { await onSave(text); setEdit(false) }}>Save</button>
        <button style={S.btn} onClick={() => setEdit(false)}>Cancel</button>
      </div>
    )
  }
  return (
    <div style={{ ...S.small, marginTop: 4 }}>
      {comment ? <span>💬 {comment} </span> : null}
      {canEdit && <a href="#comment" onClick={(e) => { e.preventDefault(); setText(comment || ''); setEdit(true) }}>{comment ? 'edit' : 'Add a session comment'}</a>}
    </div>
  )
}

// A typed-in name for someone not on SwimZone (trial swimmer). Ticked in at once. Works offline.
function AddGuest({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  if (!open) return <button style={S.btn} onClick={() => setOpen(true)}>+ Guest (typed name)</button>
  return (
    <span style={S.row}>
      <input style={S.input} value={name} autoFocus placeholder="Guest's name" onChange={(e) => setName(e.target.value)}
        onKeyDown={async (e) => { if (e.key === 'Enter' && name.trim()) { if (await onAdd(name)) { setName(''); setOpen(false) } } }} />
      <button style={S.btn} disabled={!name.trim()} onClick={async () => { if (await onAdd(name)) { setName(''); setOpen(false) } }}>Add</button>
      <button style={S.btn} onClick={() => setOpen(false)}>Cancel</button>
    </span>
  )
}

// Scanning (needs signal). Unknown card → link it to someone on this register, then it's counted.
function ScanPanel({ registerKey, sheet, onDone }) {
  const [log, setLog] = useState([])                 // last few results, newest first
  const [unknown, setUnknown] = useState(null)       // a code no one has yet
  const [linkTo, setLinkTo] = useState('')
  const [visitorOrg, setVisitorOrg] = useState(sheet.groups.find((g) => g.can_take)?.org_id || '')
  const act = useAction()
  const takeable = sheet.groups.filter((g) => g.can_take)
  const people = sheet.entries.filter((e) => e.athlete_user_id && takeable.some((g) => g.id === e.register_group_id))

  const onCode = async (pCode) => {
    const r = await act.run(() => scanCode(registerKey, pCode, visitorOrg || null), null, errorText)
    if (!r?.data) return
    setLog((l) => [{ t: Date.now(), text: scanText(r.data), ok: r.data.result === 'in' || r.data.result === 'out' }, ...l].slice(0, 5))
    if (r.data.result === 'unknown_card') { setUnknown(r.data.code); setLinkTo('') } else { setUnknown(null); onDone() }
  }
  const link = async () => {
    const r = await act.run(() => linkCard(linkTo, unknown, 'other', 'Linked at the register'), null, errorText)
    if (r) { const c = unknown; setUnknown(null); await onCode(c) }
  }

  return (
    <div style={{ ...S.card, margin: '12px 0' }}>
      <div style={{ ...S.row, marginBottom: 6 }}>
        <strong>Scan in / out</strong>
        <span style={S.muted}>Scan again 10+ min later to sign out (full session).</span>
        {takeable.length > 1 && (
          <span style={S.small}>Visitors join:{' '}
            <select style={{ ...S.input, minWidth: 100 }} value={visitorOrg} onChange={(e) => setVisitorOrg(e.target.value)}>
              {takeable.map((g) => <option key={g.org_id} value={g.org_id}>{g.name}</option>)}
            </select>
          </span>
        )}
      </div>
      <ScanBox onCode={onCode} />
      {log.map((x) => <div key={x.t} style={{ ...S.small, color: x.ok ? '#137333' : '#856404', marginTop: 4 }}>{x.ok ? '✓' : '•'} {x.text}</div>)}
      {unknown && (
        <div style={{ ...S.panel }}>
          <div style={S.small}>Card <strong>{unknown}</strong> isn't linked to anyone. Whose is it?</div>
          <div style={{ ...S.row, marginTop: 6 }}>
            <select style={S.input} value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
              <option value="">Pick a swimmer on this register…</option>
              {people.map((e) => <option key={e.id} value={e.athlete_user_id}>{e.name}</option>)}
            </select>
            <button style={S.btn} disabled={!linkTo || act.busy} onClick={link}>Link and tick in</button>
            <button style={S.btn} onClick={() => setUnknown(null)}>Ignore</button>
          </div>
        </div>
      )}
      <Message error={act.error} />
    </div>
  )
}
