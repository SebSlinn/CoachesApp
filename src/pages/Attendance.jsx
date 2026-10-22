// pages/Attendance.jsx — /registers/attendance — a whole group over a period, one letter per session:
//   C complete · P partial · I in, not signed out · A absent · Ap apologies · E expected (open) · N not booked
// Colour and letter both carry the meaning. Rows: the group's swimmers now, plus visitors and past
// members who were on one of these registers. A % per swimmer over the sessions they were booked on.
// For anyone who takes registers for, or coaches, the group. Talks only to services/registers.js.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getGroupAttendance, errorText } from '../services/registers'
import { groupsFromMemberships } from '../services/groupLabels'
import { ATTENDANCE_CODES, ATTENDANCE_CODE, attendanceTotals, todayLocal, clock } from '../services/registerLabels'
import { S, Badge, Message, useAction } from '../components/AccountsUi'

const PAGE = { ...S.page, padding: 'clamp(16px, 4vw, 40px)', maxWidth: 1200 }
const daysAgo = (n) => todayLocal(new Date(Date.now() - n * 86400000))
const PRESETS = [
  { key: '4w', label: 'Last 4 weeks', from: () => daysAgo(27) },
  { key: 'm', label: 'This month', from: () => todayLocal().slice(0, 8) + '01' },
  { key: '3m', label: 'Last 3 months', from: () => daysAgo(91) },
  { key: 'y', label: 'Last 12 months', from: () => daysAgo(365) },
]
const T = {
  wrap: { overflowX: 'auto', border: '1px solid #8886', borderRadius: 10, marginTop: 12 },
  table: { borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: '100%' },
  th: { padding: '6px 4px', fontWeight: 600, fontSize: 11, textAlign: 'center', borderBottom: '1px solid #8886', whiteSpace: 'nowrap', background: 'var(--sz-bg, #fff)' },
  name: { position: 'sticky', left: 0, background: 'var(--sz-bg, #fff)', padding: '4px 10px', whiteSpace: 'nowrap', borderRight: '1px solid #8886', zIndex: 1 },
  cell: { width: 30, minWidth: 30, height: 26, textAlign: 'center', fontWeight: 700, borderBottom: '1px solid #8882' },
}

export default function Attendance() {
  const navigate = useNavigate()
  const { memberships } = useAuth()
  const [params, setParams] = useSearchParams()
  const groups = useMemo(() => groupsFromMemberships(memberships).filter((g) => g.take_register || g.is_staff), [memberships])
  const org = params.get('org') || groups[0]?.org_id || ''
  const [from, setFrom] = useState(params.get('from') || daysAgo(27))
  const [to, setTo] = useState(params.get('to') || todayLocal())
  const [grid, setGrid] = useState(null)
  const act = useAction()

  useEffect(() => {
    if (!org) return
    act.run(() => getGroupAttendance(org, from, to), null, errorText).then((r) => setGrid(r?.data || null))
  }, [org, from, to])

  const setOrg = (v) => setParams({ org: v, from, to })
  const groupName = groups.find((g) => g.org_id === org)?.name || 'Group'

  const downloadCsv = () => {
    if (!grid) return
    const head = ['Swimmer', 'Member', ...grid.registers.map((r) => new Date(r.starts_at).toLocaleString('en-GB')), 'Booked', 'Attended', '%']
    const rows = grid.athletes.map((a) => {
      const t = attendanceTotals(a.cells)
      return [a.name, a.member ? 'yes' : 'visitor', ...grid.registers.map((r) => a.cells[r.id] || ''), t.booked, t.attended, t.pct ?? '']
    })
    const csv = [head, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `attendance-${groupName}-${from}-to-${to}.csv`.replace(/\s+/g, '-'); a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div style={PAGE}>
      <div style={S.head}>
        <h2 style={S.h2}>Attendance</h2>
        <div style={S.row}>
          {org && <button style={S.btn} onClick={() => navigate('/registers/cards/' + org)}>Print QR cards</button>}
          <button style={S.btn} onClick={() => navigate('/registers')}>Registers</button>
        </div>
      </div>

      {groups.length === 0 && <p style={S.muted}>You don't take registers for, or coach, any group.</p>}
      {groups.length > 0 && (
        <div style={{ ...S.card, ...S.row }}>
          <select style={S.input} value={org} onChange={(e) => setOrg(e.target.value)}>
            {groups.map((g) => <option key={g.org_id} value={g.org_id}>{g.name}</option>)}
          </select>
          <input type="date" style={{ ...S.input, minWidth: 140 }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span style={S.small}>to</span>
          <input type="date" style={{ ...S.input, minWidth: 140 }} value={to} onChange={(e) => setTo(e.target.value)} />
          {PRESETS.map((p) => <button key={p.key} style={S.btn} onClick={() => { setFrom(p.from()); setTo(todayLocal()) }}>{p.label}</button>)}
        </div>
      )}

      <div style={{ ...S.row, marginTop: 10 }}>
        {ATTENDANCE_CODES.map((c) => (
          <span key={c.code} style={S.small}><Cell code={c.code} /> {c.label}</span>
        ))}
      </div>
      <Message error={act.error} />

      {grid && grid.registers.length === 0 && <p style={{ ...S.muted, marginTop: 12 }}>No registers for {groupName} in this period.</p>}
      {grid && grid.registers.length > 0 && (
        <>
          <div style={T.wrap}>
            <table style={T.table}>
              <thead>
                <tr>
                  <th style={{ ...T.th, ...T.name, textAlign: 'left', zIndex: 2 }}>{grid.athletes.length} swimmers · {grid.registers.length} sessions</th>
                  {grid.registers.map((r) => {
                    const d = new Date(r.starts_at)
                    return (
                      <th key={r.id} style={{ ...T.th, cursor: 'pointer' }} title={`${d.toLocaleString('en-GB')}${r.venue ? ' · ' + r.venue : ''}${r.guests ? ` · ${r.guests} guest(s)` : ''}`}
                        onClick={() => navigate('/registers/' + r.id)}>
                        {d.toLocaleDateString('en-GB', { weekday: 'narrow' })}<br />{d.getDate()}/{d.getMonth() + 1}<br />
                        <span style={{ fontWeight: 400 }}>{clock(r.starts_at)}</span>
                      </th>
                    )
                  })}
                  <th style={T.th}>%</th>
                </tr>
              </thead>
              <tbody>
                {grid.athletes.map((a) => {
                  const t = attendanceTotals(a.cells)
                  return (
                    <tr key={a.user_id}>
                      <td style={T.name}>
                        {a.name} {a.is_junior && <Badge kind="warn">U18</Badge>} {!a.member && <Badge kind="role">visitor</Badge>}
                      </td>
                      {grid.registers.map((r) => <td key={r.id} style={{ borderBottom: '1px solid #8882', padding: 1 }}><Cell code={a.cells[r.id]} /></td>)}
                      <td style={{ ...T.cell, fontWeight: 600, width: 46 }} title={`${t.attended} of ${t.booked} booked sessions (${t.complete} complete, ${t.partial} partial, ${t.absent} absent)`}>
                        {t.pct == null ? '–' : t.pct + '%'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ ...S.row, marginTop: 10 }}>
            <button style={S.btn} onClick={downloadCsv}>Download CSV</button>
            <span style={S.muted}>Tap a date to open that register. % = attended (C, P, I) of sessions they were booked on.</span>
          </div>
        </>
      )}
    </div>
  )
}

function Cell({ code }) {
  const c = ATTENDANCE_CODE[code] || ATTENDANCE_CODE.N
  return (
    <span title={c.label} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 26, height: 24,
      borderRadius: 5, background: c.bg, color: c.fg, fontWeight: 700, fontSize: 12, border: c.code === 'N' ? '1px dashed #bbb' : 'none' }}>
      {c.code}
    </span>
  )
}
