// src/pages/AthleteSetup.jsx
// Athlete setup page — UI and local state only.
// All parse / build / export / import logic lives in services/athleteService.js.

import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { secToDisplay } from '../zones/helpers.js';
import { ATHLETE_TYPE_OPTS } from '../zones/constants.js';
import { deriveAthleteType, parseTimeToSec } from '../athlete/parse.js';
import {
  parseSwimmingResultsText,
  buildAthleteObject,
  exportAthleteJson,
  importAthleteJson,
  loadAthlete,
  saveAthlete,
} from '../services/athleteService.js';
import { getAthleteBests, ingestPoolsideExport, persistAthleteTimes, importOfficialRecords } from '../services/results.js';
import { parsePaste } from '../athlete/swimmingResults.js';

// Records store the stroke as a code (FS/BK/BR/Fly/IM); the setup grid keys
// times as `${dist}_${code}` with a full stroke name — same codes, so mapping
// is just the display name. Kick has no PB row here and is skipped.
const STROKE_NAME = { FS: 'Freestyle', BK: 'Backstroke', BR: 'Breaststroke', Fly: 'Butterfly', IM: 'Individual Medley' };

// Turn getAthleteBests().bests into the setup page's `times` shape. lcEq is a
// long-course equivalent so profile derivation compares like with like (factors
// from storage.js: 25SC→50LC ×1.014, 25Y→25SC ×1.10). Loaded times are a
// starting point for the coach to review, not a locked profile.
function bestsToTimes(pBests) {
  const mTimes = {};
  (pBests || []).forEach((b) => {
    const mName = STROKE_NAME[b.stroke];
    const mSec = Number(b.timeSec);
    if (!mName || !(mSec > 0)) return;
    const mLcEq = b.poolType === '50LC' ? mSec : b.poolType === '25Y' ? mSec * 1.10 * 1.014 : mSec * 1.014;
    mTimes[`${b.distM}_${b.stroke}`] = {
      sec: mSec, lcEq: Math.round(mLcEq * 100) / 100, display: secToDisplay(mSec),
      pool: b.poolType === '50LC' ? 'LC' : 'SC', dist: b.distM, code: b.stroke, stroke: mName,
      date: b.swumOn || '', monthsOld: 0, stale: false,
    };
  });
  return mTimes;
}

export default function AthleteSetup() {
  const navigate = useNavigate();
  const location = useLocation();

  const [rawPaste,       setRawPaste]       = useState('');
  const [athleteName,    setAthleteName]    = useState('');
  const [seNumber,       setSeNumber]       = useState('');
  const [clubName,       setClubName]       = useState('');
  const [athleteType,    setAthleteType]    = useState('allround');
  const [phvStatus,      setPhvStatus]      = useState('post');
  const [athleteTimes,   setAthleteTimes]   = useState({});
  const [parseLog,       setParseLog]       = useState([]);
  const [derivedProfile, setDerivedProfile] = useState(null);
  const [loadedNote,     setLoadedNote]     = useState('');
  const [athleteId,      setAthleteId]      = useState(null);   // SwimZone athlete_user_id, when loaded from a member/child
  const [poolsideMsg,    setPoolsideMsg]    = useState('');
  const [dbMsg,          setDbMsg]          = useState('');
  const [officialRecords, setOfficialRecords] = useState([]);   // parsed SwimmingResults rows w/ provenance (date/meet/venue/licence)

  // ── On mount: if we arrived via "load this athlete" (a member/child clicked
  //    on the Dashboard or Organisations), pre-fill from THEIR records — a shell
  //    (just the name) when they have none yet, so nothing blocks. Otherwise
  //    load the saved active athlete as before. ─────────────────────────────
  useEffect(() => {
    let mCancelled = false;
    const mHandoff = location.state?.loadAthlete;

    if (mHandoff) {
      setAthleteId(mHandoff.athleteId || null);
      setAthleteName(mHandoff.name || '');
      setSeNumber(''); setClubName('');
      setAthleteType('allround'); setPhvStatus('post');
      setAthleteTimes({}); setDerivedProfile(null);
      setLoadedNote('Loaded ' + (mHandoff.name || 'athlete') + ' from records — review the profile below, then Save Athlete to make them active.');
      if (mHandoff.athleteId) {
        getAthleteBests(mHandoff.athleteId).then(({ data }) => {
          if (mCancelled || !data) return;
          const mTimes = bestsToTimes(data.bests || []);
          setAthleteTimes(mTimes);
          setDerivedProfile(deriveAthleteType(mTimes) || null);
          if (Object.keys(mTimes).length === 0) {
            setLoadedNote('Loaded ' + (mHandoff.name || 'athlete') + ' — no race/trial times on record yet. Add times below or import from SwimmingResults.org, then Save Athlete.');
          }
        });
      }
      return () => { mCancelled = true; };
    }

    loadAthlete().then(mData => {
      if (mCancelled || !mData) return;
      const mTimes = mData.times || {};
      setAthleteName(mData.name        || '');
      setSeNumber(mData.seNumber       || '');
      setClubName(mData.club           || '');
      setAthleteType(mData.athleteType || 'allround');
      setPhvStatus(mData.phvStatus     || 'post');
      setAthleteTimes(mTimes);
      setDerivedProfile(mData.derivedProfile || deriveAthleteType(mTimes) || null);
    });
    return () => { mCancelled = true; };
  }, [location.state]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleParse() {
    // Your existing best-times parser fills the grid. It only understands the
    // Individual Best Times page, so guard it and fall back to the auto-detecting
    // parser for a single-event All-Times page.
    let mResult = { times: {}, log: [], name: '', seNumber: '', club: '' };
    try { mResult = parseSwimmingResultsText(rawPaste) || mResult; } catch { /* not a best-times page */ }

    // Auto-detect + capture official records (date/meet/venue/licence) for saving.
    let mParsed = { records: [], times: {}, name: '', seNumber: '', club: '', pageType: 'unknown' };
    try { mParsed = parsePaste(rawPaste) || mParsed; } catch { /* leave empty */ }

    // Grid: prefer your best-times parse; if it found nothing (a single-event
    // page), show what the detector derived for that event instead.
    const mTimes = Object.keys(mResult.times || {}).length ? mResult.times : mParsed.times;
    setAthleteTimes(mTimes);
    setParseLog(mResult.log || []);
    setDerivedProfile(deriveAthleteType(mTimes));

    const mName = mResult.name || mParsed.name;
    const mSe = mResult.seNumber || mParsed.seNumber;
    const mClub = mResult.club || mParsed.club;
    if (mName) setAthleteName(mName);
    if (mSe) setSeNumber(mSe);
    if (mClub) setClubName(mClub);

    setOfficialRecords(mParsed.records || []);
    setDbMsg(mParsed.records && mParsed.records.length
      ? 'Parsed ' + mParsed.records.length + ' official swim' + (mParsed.records.length === 1 ? '' : 's') +
        ' (' + (mParsed.pageType === 'event-history' ? 'single event' : 'best times, all strokes') + ') — ready to Save Times To Records.'
      : '');
  }

  async function handleSave() {
    const mAthlete = buildAthleteObject({
      name: athleteName, seNumber, club: clubName,
      times: athleteTimes, athleteType, phvStatus, derivedProfile,
    });
    setDerivedProfile(mAthlete.derivedProfile);
    await saveAthlete(mAthlete);
    alert('Athlete saved!');
  }

  function handleExportJson() {
    const mJson = exportAthleteJson({
      name: athleteName, seNumber, club: clubName,
      times: athleteTimes, derivedProfile, athleteType, phvStatus,
    });
    const mEl = document.getElementById('athlete-json-area');
    if (mEl) { mEl.value = mJson; mEl.select(); }
  }

  function handleImportJson() {
    const mEl = document.getElementById('athlete-json-area');
    if (!mEl?.value?.trim()) return;
    try {
      const mFields = importAthleteJson(mEl.value);
      setAthleteName(mFields.name);
      setSeNumber(mFields.seNumber);
      setClubName(mFields.club);
      setAthleteTimes(mFields.times);
      setDerivedProfile(mFields.derivedProfile);
      setAthleteType(mFields.athleteType);
      setPhvStatus(mFields.phvStatus);
      mEl.value = '';
    } catch (e) {
      alert(e.message);
    }
  }

  // ── Persist the time grid to the athlete's records (DB) ───────────────────
  // The local Save Athlete keeps the coaching profile; this writes the TIMES to
  // performance_results so they persist as the swimmer's log and best times.
  // Dated (SwimmingResults-parsed) times save as official meets; undated (typed)
  // times as non-official time trials. Requires a loaded athlete; the DB enforces
  // write rights.
  async function handlePersistTimes() {
    setDbMsg('');
    if (!athleteId) { setDbMsg('Load an athlete first (from the Dashboard or Organisations) to save times to their records.'); return; }
    if (Object.keys(athleteTimes).length === 0 && officialRecords.length === 0) { setDbMsg('No times to save yet.'); return; }

    let mAdded = 0, mSkipped = 0, mOfficial = 0, mTrials = 0;

    // Official path: the parsed records carry date + licence (unique meet ref),
    // so they save as real meets and DEDUPE cleanly on re-import.
    if (officialRecords.length) {
      const { data, error } = await importOfficialRecords(athleteId, officialRecords);
      if (error) { setDbMsg(error.message || 'Save failed — you may not have rights to this athlete’s log.'); return; }
      mAdded += data.added; mSkipped += data.skipped; mOfficial = officialRecords.length;
    }

    // Trials: only the manually-typed grid cells (no date). The grid's dated
    // cells are just the on-screen echo of the parsed records above, so they're
    // not re-saved here (that would duplicate without the licence to dedupe on).
    const mManual = {};
    for (const [k, v] of Object.entries(athleteTimes)) if (!v.date) mManual[k] = v;
    if (Object.keys(mManual).length) {
      const { data, error } = await persistAthleteTimes(athleteId, mManual);
      if (error) { setDbMsg(error.message || 'Saved official times, but trials failed to save.'); return; }
      mAdded += data.added; mSkipped += data.skipped; mTrials = data.trials;
    }

    setDbMsg('Saved to records: ' + mOfficial + ' official + ' + mTrials + ' trial — ' +
      mAdded + ' new, ' + mSkipped + ' already on record.');
  }

  function viewRecords() {
    navigate('/athlete-records', { state: { athleteId, name: athleteName } });
  }

  // ── Poolside timing: hand this athlete off, and take results back ──────────
  // Open the Poolside app carrying the athlete's identity (id is the key
  // Poolside stamps every export with; name + SE number are the human check).
  function openPoolside() {
    const mParams = new URLSearchParams();
    if (athleteId)   mParams.set('aid', athleteId);
    if (athleteName) mParams.set('name', athleteName);
    if (seNumber)    mParams.set('se', seNumber);
    window.open('/poolside/?' + mParams.toString(), '_blank');
  }

  // Import a Poolside export (paste its JSON) and save the swims to the athlete.
  // Recognises the athlete by the id stamped in the file; only saves when it
  // matches the loaded athlete (or when nothing is loaded and the file names one).
  // The database enforces write rights — a save you're not permitted to make
  // returns an error, surfaced below.
  async function handlePoolsideImport() {
    setPoolsideMsg('');
    const mEl = document.getElementById('poolside-json-area');
    const mRaw = mEl?.value?.trim();
    if (!mRaw) { setPoolsideMsg('Paste a Poolside export first.'); return; }
    let mEnv;
    try { mEnv = JSON.parse(mRaw); } catch { setPoolsideMsg('That isn\'t valid JSON.'); return; }
    if (mEnv.fmt !== 'swimzone.import/1') { setPoolsideMsg('That isn\'t a Poolside SwimZone export.'); return; }

    const mFileId = mEnv.athlete?.id || null;
    const mFileName = mEnv.athlete?.name || 'the file\'s athlete';
    if (athleteId && mFileId && mFileId !== athleteId) {
      setPoolsideMsg('This file is for ' + mFileName + ', not the loaded athlete. Load ' + mFileName + ' first, then import.');
      return;
    }
    const mTarget = athleteId || mFileId;
    if (!mTarget) { setPoolsideMsg('No athlete to save to — load an athlete first, or open Poolside from an athlete so the file carries their id.'); return; }

    const { data, error } = await ingestPoolsideExport(mTarget, mEnv);
    if (error) { setPoolsideMsg(error.message || 'Save failed — you may not have rights to add to this athlete\'s log.'); return; }
    setPoolsideMsg('Saved ' + data.added + ' swim' + (data.added === 1 ? '' : 's') +
      (data.skipped ? ' (' + data.skipped + ' already on record)' : '') + ' to ' + (athleteName || 'the athlete') + '.');
    mEl.value = '';
  }

  // ── Manual time-grid cell ────────────────────────────────────────────────
  function makeTimeCell(pKey, pDist, pCode, pStrokeName) {
    return (
      <input
        key={pKey}
        placeholder="—"
        value={athleteTimes[pKey] ? athleteTimes[pKey].display : ''}
        onChange={e => {
          const mVal = e.target.value.trim();
          if (!mVal) {
            setAthleteTimes(p => { const n = { ...p }; delete n[pKey]; return n; });
          } else {
            const mSec = parseTimeToSec(mVal);
            if (mSec) {
              setAthleteTimes(p => ({
                ...p,
                [pKey]: {
                  sec: mSec, lcEq: mSec, display: mVal, pool: 'LC',
                  dist: pDist, code: pCode, stroke: pStrokeName,
                  date: '', monthsOld: 0, stale: false,
                },
              }));
            }
          }
        }}
        style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 4, color: '#fff', padding: '3px 4px', fontFamily: 'monospace',
          fontSize: 11, outline: 'none', textAlign: 'center', width: '100%', boxSizing: 'border-box',
        }}
      />
    );
  }

  const mStrokeDefs = [
    { code: 'FS',  name: 'Freestyle'         },
    { code: 'BK',  name: 'Backstroke'        },
    { code: 'BR',  name: 'Breaststroke'      },
    { code: 'Fly', name: 'Butterfly'         },
    { code: 'IM',  name: 'Individual Medley' },
  ];
  const mDistDefs = [50, 100, 200, 400, 800, 1500];

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#1a1a2e', color: '#fff', fontFamily: 'monospace', padding: '16px 12px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em', marginBottom: 2 }}>ELLESMERE PORT ASC</div>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.04em' }}>ATHLETE SETUP</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 2, letterSpacing: '0.08em' }}>SWEETENHAM ENERGY ZONE MODEL · v5</div>
        </div>

        <button onClick={() => navigate('/classifier')} style={{ padding: '6px 10px', fontSize: 11, borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(48,176,199,0.12)', color: '#fff', cursor: 'pointer', marginBottom: 16 }}>
          Back to Classifier
        </button>

        {/* Loaded-from-records banner */}
        {loadedNote && (
          <div style={{ background: 'rgba(48,176,199,0.10)', border: '1px solid rgba(48,176,199,0.35)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 11, color: '#8fd6e4', lineHeight: 1.5 }}>
            {loadedNote}
          </div>
        )}

        {/* Identity */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Athlete details</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'Name',      value: athleteName, setter: setAthleteName, placeholder: 'Athlete name', flex: 2 },
              { label: 'SE Number', value: seNumber,    setter: setSeNumber,    placeholder: '1234567',      flex: 1 },
              { label: 'Club',      value: clubName,    setter: setClubName,    placeholder: 'Club name',    flex: 2 },
            ].map(f => (
              <div key={f.label} style={{ flex: f.flex, minWidth: 90 }}>
                <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2, display: 'block' }}>{f.label}</label>
                <input value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', padding: '8px 11px', width: '100%', fontFamily: 'monospace', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
        </div>

        {/* Athlete type */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>
            Athlete type <span style={{ opacity: 0.4, fontWeight: 400 }}>— affects lactate clearance rate</span>
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {ATHLETE_TYPE_OPTS.map(opt => (
              <button key={opt.v} onClick={() => setAthleteType(opt.v)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace',
                  border: '1px solid ' + (athleteType === opt.v ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.08)'),
                  background: athleteType === opt.v ? 'rgba(255,255,255,0.10)' : 'transparent',
                  color: athleteType === opt.v ? '#fff' : 'rgba(255,255,255,0.3)' }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{opt.l}</div>
                <div style={{ fontSize: 9, marginTop: 2, opacity: 0.6 }}>{opt.sub}</div>
              </button>
            ))}
          </div>
          {derivedProfile?.type && (
            <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(52,199,89,0.7)' }}>
              Auto-detected: {derivedProfile.label} ({derivedProfile.aiPct}% drop/doubling) — override above if needed
            </div>
          )}
        </div>

        {/* PHV status */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Athlete maturation (PHV status)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { v: 'pre',        l: 'Pre-PHV',        sub: 'Lactate system undeveloped' },
              { v: 'developing', l: 'Early Post-PHV', sub: 'Lactate system maturing'    },
              { v: 'post',       l: 'Post-PHV',       sub: 'Full glycolytic capacity'   },
            ].map(opt => (
              <button key={opt.v} onClick={() => setPhvStatus(opt.v)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace',
                  border: '1px solid ' + (phvStatus === opt.v ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.08)'),
                  background: phvStatus === opt.v ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: phvStatus === opt.v ? '#fff' : 'rgba(255,255,255,0.3)' }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{opt.l}</div>
                <div style={{ fontSize: 9, marginTop: 2, opacity: 0.6 }}>{opt.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Derived profile card */}
        {derivedProfile && (
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', marginBottom: 8 }}>AUTO-DETECTED ATHLETE PROFILE</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{derivedProfile.label}</span>
              {derivedProfile.mult && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>clearance x{derivedProfile.mult.toFixed(2)}</span>}
              {derivedProfile.confidence && derivedProfile.confidence !== 'none' && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4,
                  background: derivedProfile.confidence === 'high' ? 'rgba(52,199,89,0.15)' : 'rgba(255,204,0,0.15)',
                  border: '1px solid ' + (derivedProfile.confidence === 'high' ? 'rgba(52,199,89,0.4)' : 'rgba(255,204,0,0.4)'),
                  color: derivedProfile.confidence === 'high' ? '#34C759' : '#FFCC00' }}>
                  {derivedProfile.confidence} confidence
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>{derivedProfile.reasoning}</div>
            {derivedProfile.aiPct && <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Drop-off: {derivedProfile.aiPct}% per doubling · &lt;3% Endurance · 3–6% All-Round · &gt;6% Sprint</div>}
            {derivedProfile.staleUsed && <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(255,149,0,0.7)', background: 'rgba(255,149,0,0.06)', borderRadius: 4, padding: '4px 8px' }}>⚠ Some times used in this profile are over 13 months old. Profile may not reflect current fitness.</div>}
            {derivedProfile.css && <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>CSS: {secToDisplay(derivedProfile.css)}/100m (from {derivedProfile.cssMethod})</div>}
          </div>
        )}

        {/* Manual time grid */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Manual time entry</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 4, marginBottom: 8 }}>
            <div />
            {mStrokeDefs.map(s => (
              <div key={s.code} style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textAlign: 'center', fontFamily: 'monospace', letterSpacing: '0.06em', paddingBottom: 3, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{s.code}</div>
            ))}
            {mDistDefs.map(mDist => [
              <div key={'lbl-' + mDist} style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{mDist}m</div>,
              ...mStrokeDefs.map(mS => makeTimeCell(mDist + '_' + mS.code, mDist, mS.code, mS.name)),
            ])}
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 8 }}>Enter times as m:ss or ss.cc</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {Object.keys(athleteTimes).length > 0 && (
              <button onClick={handleSave} style={{ padding: '6px 16px', background: 'rgba(52,199,89,0.12)', border: '1px solid rgba(52,199,89,0.4)', borderRadius: 5, color: '#34C759', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>
                SAVE ATHLETE
              </button>
            )}
            {athleteId && (Object.keys(athleteTimes).length > 0 || officialRecords.length > 0) && (
              <button onClick={handlePersistTimes} style={{ padding: '6px 16px', background: 'rgba(48,176,199,0.12)', border: '1px solid rgba(48,176,199,0.4)', borderRadius: 5, color: '#30B0C7', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>
                SAVE TIMES TO RECORDS{officialRecords.length ? ' (' + officialRecords.length + ' official)' : ''}
              </button>
            )}
            {athleteId && (
              <button onClick={viewRecords} style={{ padding: '6px 16px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 5, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>
                VIEW RECORDS / LOG
              </button>
            )}
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>
            Save Athlete keeps the coaching profile here. {athleteId ? 'Save Times To Records writes the times to ' + (athleteName || 'the athlete') + '’s log — dated (parsed) times as official, typed times as time trials.' : 'Load an athlete to save their times to records.'}
          </div>
          {dbMsg && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>{dbMsg}</div>}
        </div>

        {/* Parsed times table */}
        {Object.keys(athleteTimes).length > 0 && (
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', marginBottom: 8 }}>IMPORTED TIMES — {Object.keys(athleteTimes).length} events</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {['Event','Time','Pool','LC equiv'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Event' ? 'left' : 'right', padding: '4px 0', fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.values(athleteTimes)
                  .sort((a, b) => a.code.localeCompare(b.code) || a.dist - b.dist)
                  .map(t => (
                    <tr key={t.dist + '_' + t.code} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '5px 0', color: '#fff' }}>{t.dist}m {t.stroke}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: t.stale ? 'rgba(255,255,255,0.35)' : '#fff', fontWeight: 700 }}>
                        {t.display}{t.stale && <span style={{ marginLeft: 5, fontSize: 9, color: '#FF9500' }}>stale</span>}
                      </td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: t.pool === 'LC' ? 'rgba(48,176,199,0.8)' : 'rgba(255,204,0,0.8)' }}>{t.pool}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{t.pool === 'SC' ? secToDisplay(t.lcEq) : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Parse log */}
        {parseLog.length > 0 && (
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 6 }}>PARSE LOG</div>
            {parseLog.map((l, i) => <div key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>{l}</div>)}
          </div>
        )}

        {/* SwimmingResults.org paste */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Import times from SwimmingResults.org</label>
          <textarea value={rawPaste} onChange={e => setRawPaste(e.target.value)}
            placeholder="Paste the full page text from a SwimmingResults.org individual times page…"
            rows={5} style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(255,255,255,0.7)', padding: '10px', fontFamily: 'monospace', fontSize: 11, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
          <button onClick={handleParse} style={{ marginTop: 8, padding: '8px 18px', background: 'rgba(48,176,199,0.12)', border: '1px solid rgba(48,176,199,0.4)', borderRadius: 6, color: '#30B0C7', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>
            PARSE & IMPORT TIMES
          </button>
        </div>

        {/* Poolside timing */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Poolside timing</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <button onClick={openPoolside} disabled={!athleteName}
              style={{ padding: '6px 14px', background: 'rgba(48,176,199,0.12)', border: '1px solid rgba(48,176,199,0.4)', borderRadius: 6, color: athleteName ? '#30B0C7' : 'rgba(255,255,255,0.25)', cursor: athleteName ? 'pointer' : 'default', fontFamily: 'monospace', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>
              OPEN POOLSIDE{athleteName ? ' FOR ' + athleteName.toUpperCase() : ''}
            </button>
            {!athleteId && athleteName && <span style={{ fontSize: 9, color: 'rgba(255,204,0,0.7)', alignSelf: 'center' }}>no athlete id — import will need a saved/loaded athlete</span>}
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 8, lineHeight: 1.5 }}>
            Times poolside, then paste the SwimZone export below (or import a saved .swimzone.json) to save the swims to this athlete's records.
          </div>
          <textarea id="poolside-json-area" rows={3}
            placeholder="Paste a Poolside SwimZone export here to save its swims to the athlete"
            style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', fontSize: 9, padding: 8, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
          <button onClick={handlePoolsideImport}
            style={{ marginTop: 8, padding: '6px 16px', background: 'rgba(52,199,89,0.12)', border: '1px solid rgba(52,199,89,0.4)', borderRadius: 5, color: '#34C759', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>
            SAVE RESULTS TO {(athleteName || 'ATHLETE').toUpperCase()}
          </button>
          {poolsideMsg && <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>{poolsideMsg}</div>}
        </div>

        {/* Athlete JSON export / import */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Save / Load Athlete Profile</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={handleExportJson} style={{ padding: '5px 14px', background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.25)', borderRadius: 5, color: 'rgba(52,199,89,0.7)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>EXPORT JSON</button>
            <button onClick={handleImportJson} style={{ padding: '5px 14px', background: 'rgba(48,176,199,0.08)', border: '1px solid rgba(48,176,199,0.25)', borderRadius: 5, color: 'rgba(48,176,199,0.6)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>IMPORT JSON</button>
          </div>
          <textarea id="athlete-json-area" rows={4}
            placeholder="JSON appears here after export · paste here to import"
            onClick={e => e.target.select()}
            style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', fontSize: 9, padding: 8, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
        </div>

        {/* No profile warning */}
        {Object.keys(athleteTimes).length > 0 && !derivedProfile && (
          <div style={{ background: 'rgba(255,204,0,0.08)', border: '1px solid rgba(255,204,0,0.2)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,204,0,0.8)' }}>No 200m + 400m freestyle times found — athlete type cannot be auto-detected.</div>
          </div>
        )}

      </div>
    </div>
  );
}
