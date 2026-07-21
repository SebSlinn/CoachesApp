// src/pages/Classifier.jsx
// Orchestrator for the classifier screen.
// Owns cross-page state (athlete, session bridge, classifier inputs).
// Delegates all UI to ClassifierScreenRefactor.

import { storage, KEYS } from '../lib/storage.js';

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  STROKE_MULT, REST_TYPE_OPTS, ATHLETE_TYPE_OPTS,
  ENERGY_SYSTEMS, ZONE_GROUPS, ZONES,
  parseTime, fmtTime, secToDisplay,
  validatePace,
  glycoCapacity, phvZoneCaps, repEnergy, paceImpairment, consistencyCheck,
  classifySet, suggestTimes,
} from '../zones/index.js';import { flattenBlock, classifySequence } from '../session/model.js';
import { sbNewLine, sbNewBlock } from '../session/utils.js';
import EnergyGraph from '../components/EnergyGraph.jsx';
import ZoneBar     from '../components/ZoneBar.jsx';
import RepChart    from '../components/RepChart.jsx';
import { ClassifierScreenRefactor } from '../screens/ClassifierScreenRefactor.jsx';

export default function Classifier() {
  const navigate = useNavigate();

  // ── Persisted state ──────────────────────────────────────────────────────
  const savedState = useMemo(() => storage.get(KEYS.CLASSIFIER_STATE), []);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [poolDisplay,     setPoolDisplay]     = useState(savedState?.poolDisplay || '25SC');
  const [seqResult,       setSeqResult]       = useState(null);
  const [activeAthlete,   setActiveAthlete]   = useState(null);
  const [derivedProfile,  setDerivedProfile]  = useState(null);
  const [inputs,          setInputs]          = useState(savedState?.inputs || {
    distM: '100', qty: '10', targetTime: '1:10', onTime: '',
    pace200: '2:12', stroke: 'FS', phvStatus: 'post',
    restType: 'stationary', athleteType: 'allround',
  });
  const [selectedZone,    setSelectedZone]    = useState(savedState?.selectedZone    || null);
  const [classifierDrill, setClassifierDrill] = useState(savedState?.classifierDrill || '');
  const [singleResult,    setSingleResult]    = useState(null);
  const [resultView,      setResultView]      = useState(savedState?.resultView      || 'zones');
  const [selectedElement, setSelectedElement] = useState(() => storage.get(KEYS.SELECTED_ELEMENT));
  const [editingBlock,    setEditingBlock]    = useState(() => storage.get(KEYS.EDITING_BLOCK));

  // ── Load athlete from AthleteSetup ───────────────────────────────────────
  useEffect(() => {
    const mData = storage.get(KEYS.ATHLETE);
    if (!mData) return;
    const mProfile = mData.derivedProfile || null;
    setInputs(i => ({
      ...i,
      athleteType: mData.athleteType || 'allround',
      phvStatus:   mData.phvStatus   || 'post',
      pace200:     mData.pace200     || i.pace200,
    }));
    setDerivedProfile(mProfile);
    setActiveAthlete({
      name:           mData.name          || '',
      seNumber:       mData.seNumber      || '',
      club:           mData.club          || '',
      times:          mData.times         || {},
      derivedProfile: mProfile,
      athleteType:    mData.athleteType   || 'allround',
      phvStatus:      mData.phvStatus     || 'post',
      pace200:        mData.pace200       || '',
    });
  }, []);

  // ── Input helper ─────────────────────────────────────────────────────────
  function set(k, v) { setInputs(p => ({ ...p, [k]: v })); }

  // ── Session bridge ────────────────────────────────────────────────────────
  function loadSession() {
    const mParsed = storage.get(KEYS.SESSION);
    const mEmpty  = { title: '', groups: [{ id: 'g1', label: 'Main Set', blocks: [] }] };
    return mParsed?.groups?.length ? mParsed : mEmpty;
  }

  function sbCommitBlock(pBlock) {
    const mSession  = loadSession();
    const mGroups   = mSession.groups?.length
      ? mSession.groups
      : [{ id: 'g1', label: 'Main Set', blocks: [] }];
    const mTargetId = (() => {
      const mSaved = storage.getRaw(KEYS.ACTIVE_GROUP);
      return mSaved && mGroups.some(g => g.id === mSaved) ? mSaved : mGroups[0].id;
    })();
    const mUpdated  = mGroups.map(g =>
      g.id === mTargetId ? { ...g, blocks: [...(g.blocks || []), pBlock] } : g
    );
    storage.set(KEYS.SESSION, { ...mSession, groups: mUpdated });
  }

  // ── Live single-set classification ───────────────────────────────────────
  useEffect(() => {
    const mDist   = parseFloat(inputs.distM);
    const mQty    = parseFloat(inputs.qty);
    const mTime   = parseTime(inputs.targetTime);
    const mPace   = parseTime(inputs.pace200);
    if (!mDist || !mQty || !mTime || !mPace) { setSingleResult(null); return; }

    // Rest = ON time − IN time. Straight-on (no onTime) = 0 rest.
    const mOnSec  = parseTime(inputs.onTime);
    const mRestSec = mOnSec ? Math.max(0, mOnSec - mTime) : 0;

    // Combined lactate clearance multiplier: rest type × athlete type
    const mRestOpt    = REST_TYPE_OPTS.find(o => o.v === inputs.restType);
    const mAthleteOpt = ATHLETE_TYPE_OPTS.find(o => o.v === inputs.athleteType);
    const mClearMult  = (mRestOpt?.clearMult || 1.0) * (mAthleteOpt?.clearMult || 1.0);

    try {
      setSingleResult(classifySet({
        distM: mDist, qty: mQty, targetTimeSec: mTime,
        restSec: mRestSec,
        pace200Sec: mPace, stroke: inputs.stroke,
        phvStatus: inputs.phvStatus, lactateClearMult: mClearMult,
        cssValue: derivedProfile?.css || null,
        athleteCtx: activeAthlete ? {
          css:         derivedProfile?.css        || null,
          athleteType: activeAthlete.athleteType  || 'allround',
          gender:      activeAthlete.gender       || 'F',
          times:       activeAthlete.times        || {},
          pool:        '50LC',
        } : null,
      }));
    } catch (e) { console.error('Classification error:', e); setSingleResult(null); }
  }, [inputs]);

  // ── Sequence classification ───────────────────────────────────────────────
  useEffect(() => {
    if (!selectedElement) { setSeqResult(null); return; }
    const mSession   = loadSession();
    const mBase      = activeAthlete ? parseTime(activeAthlete.pace200) || 120 : 120;
    const mPace200Map = { FS: mBase, BK: mBase * 1.045, BR: mBase * 1.254, Fly: mBase * 1.051, IM: mBase * 1.082 };
    let mSeq = [];
    mSession.groups.forEach(g => {
      if (selectedElement.type === 'group' && g.id === selectedElement.id) {
        g.blocks.forEach(b => flattenBlock(b, mPace200Map, inputs.phvStatus).forEach(s => mSeq.push(s)));
      } else {
        g.blocks.forEach(b => {
          if (selectedElement.type === 'block' && b.id === selectedElement.id)
            mSeq = flattenBlock(b, mPace200Map, inputs.phvStatus);
          (b.children || []).forEach(c => {
            if (c.children !== undefined && selectedElement.type === 'block' && c.id === selectedElement.id)
              mSeq = flattenBlock(c, mPace200Map, inputs.phvStatus);
          });
        });
      }
    });
    if (mSeq.length > 0) {
      try {
        setSeqResult(classifySequence(mSeq, inputs.phvStatus, 1.0, activeAthlete ? parseTime(activeAthlete.pace200) : null));
      } catch (e) { console.error('Sequence classification error:', e); setSeqResult(null); }
    } else {
      setSeqResult(null);
    }
  }, [selectedElement, inputs.phvStatus, activeAthlete]);

  // ── Persist selectedElement ───────────────────────────────────────────────
  useEffect(() => {
    if (selectedElement) storage.set(KEYS.SELECTED_ELEMENT, selectedElement);
    else storage.remove(KEYS.SELECTED_ELEMENT);
  }, [selectedElement]);

  // ── Persist editingBlock ──────────────────────────────────────────────────
  useEffect(() => {
    if (editingBlock) storage.set(KEYS.EDITING_BLOCK, editingBlock);
    else storage.remove(KEYS.EDITING_BLOCK);
  }, [editingBlock]);

  // ── Persist classifier inputs ─────────────────────────────────────────────
  useEffect(() => {
    storage.set(KEYS.CLASSIFIER_STATE, {
      inputs, selectedZone, classifierDrill, resultView, poolDisplay,
    });
  }, [inputs, selectedZone, classifierDrill, resultView, poolDisplay]);

  // ── Props bundle ──────────────────────────────────────────────────────────
  const sharedClassifierProps = {
    inputs, set,
    selectedZone, setSelectedZone,
    classifierDrill, setClassifierDrill,
    singleResult, setSingleResult,
    seqResult, setSeqResult,
    resultView, setResultView,
    activeAthlete, derivedProfile,
    poolDisplay, setPoolDisplay,
    selectedElement,
    sbNewLine, sbNewBlock, sbCommitBlock,
    editingBlock, setEditingBlock,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#1a1a2e', color: '#fff', fontFamily: 'monospace', padding: '16px 12px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em', marginBottom: 2 }}>ELLESMERE PORT ASC</div>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.04em' }}>TRAINING CLASSIFIER</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 2, letterSpacing: '0.08em' }}>SWEETENHAM ENERGY ZONE MODEL · v5</div>
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/dashboard')} style={{ padding: '6px 10px', fontSize: 11, borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer' }}>Dashboard</button>
          <button onClick={() => navigate('/athlete-setup')} style={{ padding: '6px 10px', fontSize: 11, borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(48,176,199,0.12)', color: '#fff', cursor: 'pointer' }}>Athlete Setup</button>
          <button onClick={() => navigate('/set-builder')} style={{ padding: '6px 10px', fontSize: 11, borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(52,199,89,0.12)', color: '#fff', cursor: 'pointer' }}>Set Builder</button>
          {selectedElement && (
            <button onClick={() => setSelectedElement(null)} style={{ padding: '6px 10px', fontSize: 11, borderRadius: 5, border: '1px solid rgba(48,176,199,0.3)', background: 'rgba(48,176,199,0.08)', color: '#30B0C7', cursor: 'pointer' }}>
              Clear Selection
            </button>
          )}
        </div>

        {/* Pool selector */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.08em', marginRight: 2 }}>POOL:</span>
          {['50LC', '25SC', '25Y'].map(p => (
            <button key={p} onClick={() => setPoolDisplay(p)} style={{ padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700, border: '1px solid', borderColor: poolDisplay === p ? 'rgba(48,176,199,0.5)' : 'rgba(255,255,255,0.08)', background: poolDisplay === p ? 'rgba(48,176,199,0.12)' : 'transparent', color: poolDisplay === p ? '#30B0C7' : 'rgba(255,255,255,0.28)' }}>
              {p === '50LC' ? '50m LC' : p === '25SC' ? '25m SC' : '25 yard'}
            </button>
          ))}
        </div>

        {/* Status bar */}
        {activeAthlete && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em', marginBottom: 12 }}>
            Athlete: {activeAthlete.name || 'Unnamed'} · {derivedProfile?.label || 'No profile'}
          </div>
        )}
        {selectedElement && (
          <div style={{ fontSize: 10, color: 'rgba(48,176,199,0.8)', letterSpacing: '0.06em', marginBottom: 12 }}>
            Selected: {selectedElement.type} {selectedElement.id}
          </div>
        )}

        <ClassifierScreenRefactor {...sharedClassifierProps} />

      </div>
    </div>
  );
}
