// src/hr/hrMonitor.js
// Live heart rate from a standard Bluetooth LE heart-rate sensor
// (Polar Verity Sense, H10, H9, most chest straps / armbands).
//
// Zero imports. Browser only (Web Bluetooth: Chrome/Edge on Android, Windows,
// macOS — not iOS Safari). Needs a secure context: https:// or http://localhost.
// Copied to public/poolside/ by scripts/copy-setformat.mjs — edit THIS file.
//
// Design (see context/70-POOLSIDE.md → Heart rate devices):
//   - Each athlete owns one sensor; the athlete → sensor map lives in localStorage.
//   - BLE HR packets carry no timestamp: we stamp each sample with Date.now() on
//     arrival, the same clock Poolside taps use, so no alignment is needed.
//   - Underwater the link drops. We never give up: reconnect with backoff until
//     disconnect() is called. Gaps are normal; hrMetrics.js measures coverage.

export const HR_STORE_KEY = 'poolside-hr-sensors-v1';

const HR_SERVICE = 'heart_rate';
const HR_MEASUREMENT = 'heart_rate_measurement';
const BATTERY_SERVICE = 'battery_service';
const BATTERY_LEVEL = 'battery_level';

export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

// ── Packet parsing (pure — tested in node) ───────────────────────────────────
// GATT Heart Rate Measurement (0x2A37):
//   flags bit0: bpm is uint16 (else uint8)
//   bit1: contact detected · bit2: contact status supported
//   bit3: energy expended present (uint16, skipped) · bit4: RR intervals present
export function parseHeartRate(pView) {
  const mFlags = pView.getUint8(0);
  let mI = 1;
  const mIs16 = (mFlags & 0x01) !== 0;
  const bpm = mIs16 ? pView.getUint16(mI, true) : pView.getUint8(mI);
  mI += mIs16 ? 2 : 1;
  const contact = (mFlags & 0x04) ? (mFlags & 0x02) !== 0 : null;
  if (mFlags & 0x08) mI += 2;
  const rr = [];
  if (mFlags & 0x10) {
    for (; mI + 1 < pView.byteLength; mI += 2) {
      rr.push(Math.round((pView.getUint16(mI, true) / 1024) * 1000)); // ms
    }
  }
  return { bpm, contact, rr };
}

// ── Athlete → sensor registry ────────────────────────────────────────────────
export function loadSensors() {
  try { return JSON.parse(localStorage.getItem(HR_STORE_KEY)) || {}; } catch { return {}; }
}
export function sensorFor(pAthleteId) {
  return loadSensors()[pAthleteId] || null;
}
export function saveSensor(pAthleteId, pSensor) {
  const mAll = loadSensors();
  mAll[pAthleteId] = { id: pSensor.id, name: pSensor.name || '', savedAt: new Date().toISOString() };
  try { localStorage.setItem(HR_STORE_KEY, JSON.stringify(mAll)); } catch { /* storage full/blocked */ }
  return mAll[pAthleteId];
}
export function forgetSensor(pAthleteId) {
  const mAll = loadSensors();
  delete mAll[pAthleteId];
  try { localStorage.setItem(HR_STORE_KEY, JSON.stringify(mAll)); } catch { /* ignore */ }
}

function withTimeout(pPromise, pMs, pMsg) {
  let mTimer;
  return Promise.race([
    pPromise,
    new Promise((_, rej) => { mTimer = setTimeout(() => rej(new Error(pMsg)), pMs); }),
  ]).finally(() => clearTimeout(mTimer));
}

// ── One monitor = one athlete's sensor ───────────────────────────────────────
// status: idle | needs-tap | connecting | connected | reconnecting | disconnected
export class HrMonitor {
  constructor({ athleteId, onSample = () => {}, onStatus = () => {}, staleMs = 4000 } = {}) {
    this.athleteId = athleteId;
    this.onSample = onSample;
    this.onStatus = onStatus;
    this.staleMs = staleMs;
    this.status = 'idle';
    this.device = null;
    this.battery = null;
    this.lastSample = null;
    this.samples = [];          // { t, bpm, contact, rr } — t = Date.now() on arrival
    this._stopped = true;
    this._char = null;
    this._retry = 0;
    this._retryTimer = null;
    this._onValue = (e) => this._handleValue(e.target.value);
    this._onDisconnect = () => this._handleDisconnect();
  }

  get sensorName() { return this.device?.name || sensorFor(this.athleteId)?.name || ''; }

  /** 'live' when a sample arrived within staleMs, else 'gap' (swimmer underwater / out of range). */
  signal(pNow = Date.now()) {
    if (!this.lastSample) return 'none';
    return pNow - this.lastSample.t <= this.staleMs ? 'live' : 'gap';
  }

  /** Show the browser picker for any HR sensor, remember it for this athlete, connect. */
  async pair() {
    if (!isSupported()) throw new Error('Web Bluetooth is not available in this browser.');
    const mDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HR_SERVICE] }],
      optionalServices: [BATTERY_SERVICE],
    });
    saveSensor(this.athleteId, mDevice);
    return this._start(mDevice);
  }

  /**
   * Connect the sensor already saved for this athlete. Uses getDevices() where the
   * browser supports remembered permissions (no prompt); otherwise shows the picker
   * filtered to that one sensor — one tap. Must run from a user gesture in the latter case.
   * With { prompt:false } it never shows the picker: resolves null and sets status
   * 'needs-tap' when a tap is required.
   */
  async connectSaved({ prompt = true } = {}) {
    if (!isSupported()) throw new Error('Web Bluetooth is not available in this browser.');
    const mSaved = sensorFor(this.athleteId);
    if (!mSaved) throw new Error('No sensor saved for this athlete — pair one first.');
    let mDevice = null;
    if (navigator.bluetooth.getDevices) {
      try {
        const mKnown = await navigator.bluetooth.getDevices();
        mDevice = mKnown.find((d) => d.id === mSaved.id) || null;
      } catch { /* not permitted — fall back to picker */ }
    }
    if (!mDevice) {
      // Without remembered permission the browser must show its picker, which
      // needs a tap. prompt:false (e.g. on page load / athlete switch) → report it.
      if (!prompt) { this._setStatus('needs-tap'); return null; }
      mDevice = await navigator.bluetooth.requestDevice({
        filters: mSaved.name ? [{ name: mSaved.name }] : [{ services: [HR_SERVICE] }],
        optionalServices: [HR_SERVICE, BATTERY_SERVICE],
      });
      if (mDevice.id !== mSaved.id) saveSensor(this.athleteId, mDevice);
    }
    return this._start(mDevice);
  }

  /** Stop for good (profile switch, end of session). Keeps collected samples. */
  async disconnect() {
    this._stopped = true;
    clearTimeout(this._retryTimer);
    if (this._char) {
      try { this._char.removeEventListener('characteristicvaluechanged', this._onValue); } catch { /* ignore */ }
      try { await this._char.stopNotifications(); } catch { /* already gone */ }
    }
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnect);
      try { if (this.device.gatt.connected) this.device.gatt.disconnect(); } catch { /* ignore */ }
    }
    this._char = null;
    this._setStatus('disconnected');
  }

  /** Drop collected samples (e.g. after they've been saved). */
  clearSamples() { this.samples = []; }

  // ── internals ──
  async _start(pDevice) {
    if (this.device && this.device !== pDevice) await this.disconnect();
    this.device = pDevice;
    this._stopped = false;
    this._retry = 0;
    pDevice.removeEventListener('gattserverdisconnected', this._onDisconnect);
    pDevice.addEventListener('gattserverdisconnected', this._onDisconnect);
    this._setStatus('connecting');
    try {
      await this._connectGatt();
    } catch (err) {
      this._scheduleReconnect(err);
    }
    return this;
  }

  async _connectGatt() {
    const mServer = await withTimeout(this.device.gatt.connect(), 10000, 'Sensor did not answer');
    const mService = await mServer.getPrimaryService(HR_SERVICE);
    const mChar = await mService.getCharacteristic(HR_MEASUREMENT);
    mChar.removeEventListener('characteristicvaluechanged', this._onValue);
    mChar.addEventListener('characteristicvaluechanged', this._onValue);
    await mChar.startNotifications();
    this._char = mChar;
    this._retry = 0;
    this._setStatus('connected');
    this._readBattery(mServer);
  }

  async _readBattery(pServer) {
    try {
      const mSvc = await pServer.getPrimaryService(BATTERY_SERVICE);
      const mChar = await mSvc.getCharacteristic(BATTERY_LEVEL);
      this.battery = (await mChar.readValue()).getUint8(0);
      this.onStatus(this.status, this);
    } catch { /* battery service optional */ }
  }

  _handleValue(pView) {
    let mParsed;
    try { mParsed = parseHeartRate(pView); } catch { return; }
    if (!mParsed.bpm) return;                       // 0 = no skin contact
    const mSample = { t: Date.now(), bpm: mParsed.bpm, contact: mParsed.contact, rr: mParsed.rr };
    this.lastSample = mSample;
    this.samples.push(mSample);
    this.onSample(mSample, this);
  }

  _handleDisconnect() {
    this._char = null;
    if (this._stopped) return;
    this._scheduleReconnect();
  }

  _scheduleReconnect(pErr) {
    if (this._stopped) return;
    this._setStatus('reconnecting', pErr);
    clearTimeout(this._retryTimer);
    const mDelay = Math.min(1000 * 2 ** this._retry, 10000);  // 1,2,4,8,10,10… s
    this._retry += 1;
    this._retryTimer = setTimeout(async () => {
      if (this._stopped) return;
      try { await this._connectGatt(); } catch (err) { this._scheduleReconnect(err); }
    }, mDelay);
  }

  _setStatus(pStatus, pErr) {
    this.status = pStatus;
    this.lastError = pErr ? String(pErr.message || pErr) : null;
    this.onStatus(pStatus, this);
  }
}
