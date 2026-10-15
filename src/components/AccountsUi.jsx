// components/AccountsUi.jsx — small shared pieces for the Accounts screens
// (Dashboard, Groups, Join, Sponsorship, Account). Presentation only.
import { useState } from 'react'

export const S = {
  page: { padding: 40, fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' },
  h2: { margin: 0 },
  h3: { margin: '28px 0 10px' },
  card: { border: '1px solid #8886', borderRadius: 10, padding: '12px 16px', marginBottom: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  muted: { color: '#999', fontSize: 13 },
  small: { fontSize: 13 },
  btn: { padding: '5px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 6 },
  primary: { padding: '7px 14px', fontSize: 14, cursor: 'pointer', borderRadius: 8, border: 'none',
             background: '#30b0c7', color: '#fff', fontWeight: 700 },
  panel: { marginTop: 10, padding: 12, border: '1px dashed #8888', borderRadius: 8 },
  input: { padding: '6px 9px', fontSize: 14, borderRadius: 6, border: '1px solid #8889', minWidth: 180, boxSizing: 'border-box' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, margin: '12px 0 4px' },
  error: { color: '#e55', fontSize: 13, marginTop: 6 },
  ok: { color: '#2a2', fontSize: 13, marginTop: 6 },
  banner: { border: '1px solid #e0b000', background: '#fff8e1', color: '#5c4600', borderRadius: 10, padding: '12px 16px', margin: '12px 0' },
}

const BADGE = {
  role:    ['#e8f0fe', '#174ea6'],
  staff:   ['#e6f4ea', '#137333'],
  warn:    ['#fff8e1', '#856404'],
  danger:  ['#fce8e6', '#a50e0e'],
  neutral: ['#eee', '#555'],
}
export function Badge({ kind = 'neutral', children, title }) {
  const [bg, fg] = BADGE[kind] || BADGE.neutral
  return <span title={title} style={{ background: bg, color: fg, padding: '1px 9px', borderRadius: 10, fontSize: 12, whiteSpace: 'nowrap' }}>{children}</span>
}

export function Message({ error, ok }) {
  if (error) return <div style={S.error}>{error}</div>
  if (ok) return <div style={S.ok}>{ok}</div>
  return null
}

export function Tick({ checked, onChange, disabled, children, hint }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '6px 0', opacity: disabled ? 0.55 : 1, fontSize: 14 }}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} style={{ marginTop: 3 }} />
      <span>{children}{hint && <span style={{ ...S.muted, display: 'block' }}>{hint}</span>}</span>
    </label>
  )
}

// Run an async { data, error } action, showing busy / error / ok.
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(null)
  const run = async (pFn, pOkText, pErrorText) => {
    setBusy(true); setError(null); setOk(null)
    try {
      const r = await pFn()
      if (r?.error) { setError(pErrorText ? pErrorText(r.error) : (r.error.message || 'Something went wrong.')); return null }
      if (pOkText) setOk(typeof pOkText === 'function' ? pOkText(r?.data) : pOkText)
      return r ?? { data: null }
    } catch (e) {
      setError(e.message || 'Something went wrong.')
      return null
    } finally { setBusy(false) }
  }
  return { busy, error, ok, run, setError, setOk }
}
