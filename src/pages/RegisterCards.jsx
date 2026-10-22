// pages/RegisterCards.jsx — /registers/cards/:orgId — printable QR check-in cards for a whole group.
// Each card: the swimmer's name and their SwimZone QR (made if they had none). Print, cut, laminate;
// or swimmers show the same code on their phone ("My training" page). Talks only to services/registers.js.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { getGroupQrCodes, errorText } from '../services/registers'
import { S, Message, useAction } from '../components/AccountsUi'

export default function RegisterCards() {
  const { orgId } = useParams()
  const navigate = useNavigate()
  const [cards, setCards] = useState(null)
  const act = useAction()

  useEffect(() => {
    act.run(() => getGroupQrCodes(orgId), null, errorText).then(async (r) => {
      const rows = r?.data || []
      const withImg = await Promise.all(rows.map(async (c) => ({ ...c, img: await QRCode.toDataURL(c.code, { margin: 1, width: 220 }) })))
      setCards(withImg)
    })
  }, [orgId])

  return (
    <div style={{ ...S.page, padding: 'clamp(16px, 4vw, 40px)' }}>
      <style>{`@media print { .no-print { display: none !important } body { margin: 0 } }
        .sz-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px }
        .sz-card { border: 1px dashed #999; border-radius: 10px; padding: 12px; text-align: center; break-inside: avoid; background: #fff; color: #000 }`}</style>
      <div className="no-print" style={S.head}>
        <h2 style={S.h2}>QR check-in cards</h2>
        <div style={S.row}>
          <button style={S.primary} onClick={() => window.print()} disabled={!cards?.length}>Print</button>
          <button style={S.btn} onClick={() => navigate(-1)}>Back</button>
        </div>
      </div>
      <p className="no-print" style={S.muted}>One card per swimmer. Scanning it at the register ticks them in; again 10+ minutes later signs them out. Keep cards with the swimmer: anyone holding one can check them in.</p>
      <Message error={act.error} />
      {cards && cards.length === 0 && <p style={S.muted}>No swimmers in this group yet.</p>}
      <div className="sz-cards">
        {(cards || []).map((c) => (
          <div key={c.user_id} className="sz-card">
            <img src={c.img} alt={`QR code for ${c.name}`} style={{ width: 160, height: 160 }} />
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 6 }}>{c.name}</div>
            <div style={{ fontSize: 11, color: '#555', letterSpacing: 1 }}>{c.code}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
