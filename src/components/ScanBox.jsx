// components/ScanBox.jsx — where a code comes in at the poolside door.
//   • Card / fob readers (USB or Bluetooth, barcode or RFID) type the code and press Enter:
//     keep this box focused and they just work.
//   • "Camera" reads a QR code (a swimmer's SwimZone QR on their phone or a printed card), and
//     barcodes too where the browser can (BarcodeDetector). jsQR covers QR everywhere else (iPhone).
//   • Or type the code.
// Calls onCode(code) once per code; the same code again within 3 s is ignored (a reader double-fire,
// or the camera still pointing at the same card).
import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { S } from './AccountsUi'

const REPEAT_MS = 3000

export default function ScanBox({ onCode, disabled, placeholder = 'Scan a card or type a code, then Enter' }) {
  const [text, setText] = useState('')
  const [camera, setCamera] = useState(false)
  const last = useRef({ code: null, at: 0 })
  const input = useRef(null)

  const give = (pCode) => {
    const c = String(pCode || '').trim()
    if (!c) return
    const now = Date.now()
    if (last.current.code === c && now - last.current.at < REPEAT_MS) return
    last.current = { code: c, at: now }
    onCode(c)
  }

  useEffect(() => { if (!disabled && !camera) input.current?.focus() }, [disabled, camera])

  return (
    <div>
      <div style={S.row}>
        <input ref={input} style={{ ...S.input, flex: 1, fontSize: 16 }} value={text} disabled={disabled}
          placeholder={placeholder} autoComplete="off" autoCapitalize="characters" enterKeyHint="go"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); give(text); setText('') } }} />
        <button style={S.btn} disabled={disabled || !text.trim()} onClick={() => { give(text); setText('') }}>Go</button>
        <button style={S.btn} disabled={disabled} onClick={() => setCamera(!camera)}>{camera ? 'Stop camera' : 'Camera'}</button>
      </div>
      {camera && <Camera onCode={give} onClose={() => setCamera(false)} />}
    </div>
  )
}

function Camera({ onCode, onClose }) {
  const video = useRef(null)
  const canvas = useRef(null)
  const [error, setError] = useState(null)
  const cb = useRef(onCode)
  cb.current = onCode   // the latest handler, without restarting the camera

  useEffect(() => {
    let stream = null; let raf = 0; let stopped = false
    const detector = typeof window !== 'undefined' && 'BarcodeDetector' in window
      ? new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'itf'] })
      : null
    const tick = async () => {
      if (stopped) return
      const v = video.current; const c = canvas.current
      if (v && c && v.readyState >= 2) {
        try {
          if (detector) {
            const found = await detector.detect(v)
            if (found[0]?.rawValue) cb.current(found[0].rawValue)
          } else {
            const w = v.videoWidth; const h = v.videoHeight
            c.width = w; c.height = h
            const ctx = c.getContext('2d', { willReadFrequently: true })
            ctx.drawImage(v, 0, 0, w, h)
            const img = ctx.getImageData(0, 0, w, h)
            const q = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
            if (q?.data) cb.current(q.data)
          }
        } catch (e) { /* a frame failed; keep going */ }
      }
      raf = requestAnimationFrame(tick)
    }
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        video.current.srcObject = stream
        await video.current.play()
        raf = requestAnimationFrame(tick)
      } catch (e) {
        setError('The camera isn\'t available here (permission refused, or no camera). Use a reader or type the code.')
      }
    })()
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()) }
  }, [])

  return (
    <div style={{ marginTop: 8 }}>
      {error ? <div style={S.error}>{error} <button style={S.btn} onClick={onClose}>OK</button></div> : (
        <>
          <video ref={video} playsInline muted style={{ width: '100%', maxWidth: 420, borderRadius: 10, background: '#000' }} />
          <canvas ref={canvas} style={{ display: 'none' }} />
          <div style={S.muted}>Hold the swimmer's QR code in view. It ticks them in as soon as it reads.</div>
        </>
      )}
    </div>
  )
}
