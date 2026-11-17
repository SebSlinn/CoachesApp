// src/pages/Classifier.jsx
// Orchestrator for the classifier screen.
// Owns cross-page state (athlete, session bridge, classifier inputs).
// Delegates all UI to screens/classifier/ClassifierScreen.jsx. Colours: styles/theme.js.

import { storage, KEYS } from '../lib/storage.js';

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { STROKE_MULT, REST_TYPE_OPTS, ATHLETE_TYPE_OPTS, parseTime, classifySet } from '../zones/index.js';
import { flattenBlock, classifySequence } from '../session/model.js';
import { sbNewLine, sbNewBlock } from '../session/utils.js';
import { loadAthlete } from '../services/athleteService.js';
import {
  loadSession as loadSessionRecord,
  saveSession,
  getActiveGroup,
} from '../services/sessionService.js';
import ClassifierScreen from '../screens/classifier/ClassifierScreen.jsx';
import { T, FONT } from '../styles/theme.js';
import { ui } from '../styles/ui.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { THEME_CHOICES } from '../services/themeService.js';

const POOLS = [['50LC', '50m LC'], ['25SC', '25m SC'], ['25Y', '25 yard']];

export default function Classifier() {
  const navigate = useNavigate();

  // ── Persisted state ──────────────────────────────────────────────────────
  const savedState = useMemo(() => storage.get(KEYS.CLASSIFIER_STATE), []);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [poolDisplay,     setPoolDisplay]     = useState(savedState?.poolDisplay || '25SC');
  const [seqResult,       setSeqResult]       = useState(null);
  const [activeAthlete,   setActiveAthlete]   = useState(null);
  const [athleteKey,      setAthleteKey]      = useState(savedState?.athleteKey || '');
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

  // ── Load athlete from AthleteSetup (via athleteService -> IAthleteRepository)
  useEffect(() => {
    let mCancelled = false;
    loadAthlete().then(mData => {
      if (mCancelled || !mData) return;
      const mProfile = mData.derivedProfile || null;
      // A DIFFERENT athlete from last time → take their 200 time for the chosen
      // stroke (blank if they have none), never the previous swimmer's pace.
      // The same athlete → keep any pace the coach typed here.
      const mKey = mData.athleteId || mData.name || '';
      const mNewAthlete = mKey !== (savedState?.athleteKey || '');
      setAthleteKey(mKey);
      setInputs(i => {
        const m200 = (mData.times || {})['200_' + (i.stroke || 'FS')]?.display || mData.pace200 || '';
        return {
          ...i,
          athleteType: mData.athleteType || 'allround',
          phvStatus:   mData.phvStatus   || 'post',
          pace200:     mNewAthlete ? m200 : (m200 || i.pace200),
        };
      });
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
        maxHr:          mData.maxHr         || null,   // max HR in use (athlete/maxHr.js), cached by Athlete Setup
        maxHrEstimated: !!mData.maxHrEstimated,
      });
    });
    return () => { mCancelled = true; };
  }, []);

  // ── Input helper ─────────────────────────────────────────────────────────
  function set(k, v) { setInputs(p => ({ ...p, [k]: v })); }

  // ── Session bridge (via sessionService -> ISessionRepository) ────────────
  function loadSession() {
    const mParsed = loadSessionRecord();
    const mEmpty  = { title: '', groups: [{ id: 'g1', label: 'Main Set', blocks: [] }] };
    return mParsed?.groups?.length ? mParsed : mEmpty;
  }

  function sbCommitBlock(pBlock) {
    const mSession  = loadSession();
    const mGroups   = mSession.groups?.length
      ? mSession.groups
      : [{ id: 'g1', label: 'Main Set', blocks: [] }];
    const mTargetId = (() => {
      const mSaved = getActiveGroup();
      return mSaved && mGroups.some(g => g.id === mSaved) ? mSaved : mGroups[0].id;
    })();
    const mUpdated  = mGroups.map(g =>
      g.id === mTargetId ? { ...g, blocks: [...(g.blocks || []), pBlock] } : g
    );
    saveSession({ ...mSession, groups: mUpdated });
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
    const mPace200Map = Object.fromEntries(Object.entries(STROKE_MULT).map(([s, m]) => [s, mBase * m]));
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
      inputs, selectedZone, classifierDrill, resultView, poolDisplay, athleteKey,
    });
  }, [inputs, selectedZone, classifierDrill, resultView, poolDisplay, athleteKey]);

  // ── Props bundle ──────────────────────────────────────────────────────────
  const sharedClassifierProps = {
    inputs, set,
    selectedZone, setSelectedZone,
    classifierDrill, setClassifierDrill,
    singleResult, seqResult,
    resultView, setResultView,
    activeAthlete, derivedProfile,
    poolDisplay, selectedElement,
    sbNewLine, sbNewBlock, sbCommitBlock,
    editingBlock, setEditingBlock,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const navBtn = { ...ui.button, padding: '6px 10px', fontWeight: 400 };
  const { theme, choice, setChoice } = useTheme();
  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: FONT.mono, padding: '16px 12px', colorScheme: theme }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ ...ui.caption, fontSize: 11, letterSpacing: '0.15em', marginBottom: 2 }}>ELLESMERE PORT ASC</div>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.04em' }}>TRAINING CLASSIFIER</div>
            <div style={{ ...ui.caption, marginTop: 2 }}>SWEETENHAM ENERGY ZONE MODEL · v5</div>
          </div>
          <div style={{ display: 'flex', gap: 3 }} role="group" aria-label="Screen colours">
            {THEME_CHOICES.map(o => (
              <button key={o.v} onClick={() => setChoice(o.v)} style={ui.toggle(choice === o.v)}>{o.l}</button>
            ))}
          </div>
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/dashboard')} style={navBtn}>Dashboard</button>
          <button onClick={() => navigate('/athlete-setup')} style={navBtn}>Athlete Setup</button>
          <button onClick={() => navigate('/set-builder')} style={navBtn}>Set Builder</button>
          {selectedElement && <button onClick={() => setSelectedElement(null)} style={navBtn}>Clear Selection</button>}
        </div>

        {/* Pool selector */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ ...ui.caption, marginRight: 2 }}>Pool:</span>
          {POOLS.map(([p, l]) => (
            <button key={p} onClick={() => setPoolDisplay(p)} style={ui.toggle(poolDisplay === p)}>{l}</button>
          ))}
        </div>

        {/* Status bar */}
        {activeAthlete && (
          <div style={{ fontSize: 10, color: T.text3, letterSpacing: '0.06em', marginBottom: 12 }}>
            Athlete: {activeAthlete.name || 'Unnamed'} · {derivedProfile?.label || 'No profile'}
          </div>
        )}
        {selectedElement && (
          <div style={{ fontSize: 10, color: T.text3, letterSpacing: '0.06em', marginBottom: 12 }}>
            Selected: {selectedElement.type} {selectedElement.id}
          </div>
        )}

        <ClassifierScreen {...sharedClassifierProps} />

      </div>
    </div>
  );
}
