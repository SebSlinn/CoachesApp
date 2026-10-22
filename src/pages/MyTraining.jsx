// pages/MyTraining.jsx — /my-training — the athlete's training log (or their junior's, for a guardian).
//   Every session they were on a register for: when, which group, complete / partial / absent…, how
//   much they did, the plan (once coaches attach one), and their own note — theirs (or their
//   guardian's) to write, shown to coaches only if they tick "share".
//   Also their check-in code: the SwimZone QR to show at the pool, and any linked cards or fobs.
// Talks to services/registers.js and services/logSharing.js (who I'm guardian of).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { useAuth } from '../hooks/useAuth'
import {
  getAthleteRegisterEntries, setRegisterNote, getMyQrCode, listCards, linkCard, revokeCard, errorText,
} from '../services/registers'
import { getLoadableAthletes } from '../services/logSharing'
import { ATTENDANCE_CODE, attendanceTotals, entryCode, entryStatus, when, todayLocal, toIso } from '../services/registerLabels'
import { S, Badge, Message, Tick, useAction } from '../components/AccountsUi'

const PAGE = { ...S.page, padding: 'clamp(16px, 4vw, 40px)' }
const PERIODS = [{ key: 30, label: '30 days' }, { key: 91, label: '3 months' }, { key: 365, label: '12 months' }]

export default function MyTraining() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [juniors, setJuniors] = useState([])
  const [who, setWho] = useState(null)
  const [days, setDays] = useState(91)
  const [rows, setRows] = useState(null)
  const act = useAction()

  useEffect(() => { getLoadableAthletes().then((r) => setJuniors((r.data || []).filter((a) => a.relation === 'guardian'))) }, [])
  const athleteId = who || user?.id
  const people = useMemo(() => [{ id: user?.id, name: 'Me' }, ...juniors.map((j) => ({ id: j.athlete_id, name: j.name }))], [user, juniors])

  const load = async () => {
    if (!athleteId) return
    const from = toIso(todayLocal(new Date(Date.now() - days * 86400000)), '00:00')
    const r = await act.run(() => getAthleteRegisterEntries(athleteId, from, null), null, errorText)
    setRows(r?.data || [])
  }
  useEffect(() => { load() }, [athleteId, days])

  const cells = Object.fromEntries((rows || []).map((e) => [e.entry_id, entryCode(e)]))
  const t = attendanceTotals(cells)

  return (
    <div style={PAGE}>
      <div style={S.head}>
        <h2 style={S.h2}>Training log</h2>
        <button style={S.btn} onClick={() => navigate('/dashboard')}>Back</button>
      </div>

      <div style={{ ...S.card, ...S.row }}>
        {people.length > 1 && (
          <select style={S.input} value={athleteId || ''} onChange={(e) => setWho(e.target.value)}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {PERIODS.map((p) => (
          <button key={p.key} style={{ ...S.btn, fontWeight: days === p.key ? 700 : 400 }} onClick={() => setDays(p.key)}>{p.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        {t.booked > 0 && <span style={S.small}><strong>{t.pct}%</strong> attended · {t.complete} complete · {t.partial} partial · {t.absent} missed</span>}
      </div>
      <Message error={act.error} />

      {rows && rows.length === 0 && <p style={S.muted}>No sessions on a register in this period yet.</p>}
      {(rows || []).map((e) => <LogRow key={e.entry_id} e={e} onSaved={load} />)}

      <CheckInCode userId={athleteId} name={who ? people.find((p) => p.id === who)?.name : (profile?.public_name || profile?.full_name || 'Me')} />
    </div>
  )
}

function LogRow({ e, onSaved }) {
  const [note, setNote] = useState(e.note || '')
  const [share, setShare] = useState(!!e.share)
  const [open, setOpen] = useState(false)
  const act = useAction()
  const c = ATTENDANCE_CODE[entryCode(e)]
  const dirty = note !== (e.note || '') || share !== !!e.share
  const save = async () => { if (await act.run(() => setRegisterNote(e.entry_id, note, share), 'Saved.', errorText)) onSaved() }
  return (
    <div style={S.card}>
      <div style={S.row}>
        <span title={c.label} style={{ display: 'inline-flex', minWidth: 28, height: 26, alignItems: 'center', justifyContent: 'center',
          borderRadius: 6, background: c.bg, color: c.fg, fontWeight: 700 }}>{c.code}</span>
        <strong>{when(e.starts_at)}</strong>
        <span style={S.muted}>{e.group_name}{e.venue ? ' · ' + e.venue : ''}</span>
        {e.kind === 'visitor' && <Badge kind="role">visitor</Badge>}
        <span style={{ flex: 1 }} />
        <span style={S.small}>{entryStatus(e) || c.label}</span>
      </div>
      {e.plan_title && <div style={{ ...S.small, marginTop: 4 }}>Plan: {e.plan_title}{e.plan_summary?.volumeM ? ` · ${e.plan_summary.volumeM} m` : ''}</div>}
      {!open && (
        <div style={{ ...S.small, marginTop: 6 }}>
          {e.note ? <span>📝 {e.note} {e.share && <Badge>shared with coaches</Badge>} </span> : null}
          <a href="#note" onClick={(ev) => { ev.preventDefault(); setOpen(true) }}>{e.note ? 'edit note' : 'Add a note'}</a>
        </div>
      )}
      {open && (
        <div style={{ marginTop: 8 }}>
          <textarea style={{ ...S.input, width: '100%', minHeight: 70 }} value={note} placeholder="How did it go? Times, how it felt…"
            onChange={(ev) => setNote(ev.target.value)} />
          <Tick checked={share} onChange={setShare}>Share this note with my coaches</Tick>
          <div style={S.row}>
            <button style={S.primary} disabled={!dirty || act.busy} onClick={save}>Save</button>
            <button style={S.btn} onClick={() => { setOpen(false); setNote(e.note || ''); setShare(!!e.share) }}>Close</button>
          </div>
          <Message error={act.error} ok={act.ok} />
        </div>
      )}
    </div>
  )
}

// The code to show at the pool, and cards/fobs linked to this person.
function CheckInCode({ userId, name }) {
  const [code, setCode] = useState(null)
  const [img, setImg] = useState(null)
  const [cards, setCards] = useState([])
  const [newCode, setNewCode] = useState('')
  const [kind, setKind] = useState('rfid')
  const [show, setShow] = useState(false)
  const act = useAction()

  const load = async () => {
    if (!userId) return
    const r = await getMyQrCode(userId)
    if (r.data) { setCode(r.data); setImg(await QRCode.toDataURL(r.data, { margin: 1, width: 260 })) }
    const c = await listCards(userId)
    setCards((c.data || []).filter((x) => x.kind !== 'qr'))
  }
  useEffect(() => { if (show) load() }, [userId, show])

  return (
    <div style={{ ...S.card, marginTop: 24 }}>
      <div style={S.row}>
        <strong>Check-in code{name ? ` — ${name}` : ''}</strong>
        <span style={S.muted}>Show it at the pool; the coach scans it to tick you in.</span>
        <span style={{ flex: 1 }} />
        <button style={S.btn} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show my code'}</button>
      </div>
      {show && (
        <>
          {img && (
            <div style={{ textAlign: 'center', margin: '12px 0' }}>
              <img src={img} alt="Check-in QR code" style={{ width: 220, height: 220, background: '#fff', padding: 8, borderRadius: 8 }} />
              <div style={{ ...S.small, letterSpacing: 1 }}>{code}</div>
            </div>
          )}
          <div style={S.small}><strong>Cards and fobs</strong> (a leisure-centre card, an RFID fob…)</div>
          {cards.length === 0 && <div style={S.muted}>None linked.</div>}
          {cards.map((c) => (
            <div key={c.id} style={{ ...S.row, marginTop: 4 }}>
              <span style={S.small}>{c.label || c.kind}: {c.code}</span>
              <button style={S.btn} onClick={async () => { if (await act.run(() => revokeCard(c.id), null, errorText)) load() }}>Remove</button>
            </div>
          ))}
          <div style={{ ...S.row, marginTop: 8 }}>
            <input style={S.input} value={newCode} placeholder="Card number (or scan it with a reader)" onChange={(e) => setNewCode(e.target.value)} />
            <select style={{ ...S.input, minWidth: 100 }} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="rfid">RFID / fob</option><option value="barcode">Barcode card</option><option value="other">Other</option>
            </select>
            <button style={S.btn} disabled={!newCode.trim() || act.busy}
              onClick={async () => { if (await act.run(() => linkCard(userId, newCode, kind), 'Linked.', errorText)) { setNewCode(''); load() } }}>Link</button>
          </div>
          <Message error={act.error} ok={act.ok} />
        </>
      )}
    </div>
  )
}
