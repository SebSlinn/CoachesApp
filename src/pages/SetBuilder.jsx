// src/pages/SetBuilder.jsx
// Set builder page — UI and session state only.
// All session data operations live in src/services/sessionService.js.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SbBlockView   from '../components/SbBlockView.jsx';
import SbBlockEditor from '../components/SbBlockEditor.jsx';
import {
  sbNewLine, sbNewBlock, sbAddChild, sbDeleteChild,
  sbUpdateChild, sbMoveChild, sbParseSec, sbFmtDur,
  sbZoneColor, sbBlockVolume, sbBlockTotalTime, sbLineRest, sbFmtTime,
} from '../session/index.js';
import { parseTime } from '../zones/index.js';
import { validateSession, importSessionJson, exportSessionJson } from '../services/sessionService.js';
import { generateSessionPrintHtml } from '../services/classifierService.js';
import { storage, KEYS, convertTimeForDisplay } from '../lib/storage.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_SESSION = () => ({
  title: '',
  groups: [
    { id: 'g1', label: 'Warm Up',   blocks: [] },
    { id: 'g2', label: 'Main Set',  blocks: [] },
  ],
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadSavedSession() {
  const mParsed = storage.get(KEYS.SESSION);
  return validateSession(mParsed) ? mParsed : DEFAULT_SESSION();
}

function findSelectedElementGroup(pSession, pElement) {
  if (!pElement || !pSession?.groups) return null;
  for (const mGroup of pSession.groups) {
    if (pElement.type === 'group' && mGroup.id === pElement.id) return mGroup.id;
    if (pElement.type === 'block') {
      if (mGroup.blocks.some(b => b.id === pElement.id)) return mGroup.id;
      if (mGroup.blocks.some(b => b.children?.some(c => c.id === pElement.id))) return mGroup.id;
    }
  }
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SetBuilder() {
  const navigate = useNavigate();

  // Hydrate from localStorage once on mount
  const mInitialSession         = loadSavedSession();
  const mInitialSelectedElement = storage.get(KEYS.SELECTED_ELEMENT);
  const mInitialEditingBlock    = storage.get(KEYS.EDITING_BLOCK);

  const [session,         setSession]         = useState(mInitialSession);
  const [activeGroup, setActiveGroup] = useState(() => {
    const mDefault = mInitialSession.groups?.[0]?.id || 'g1';
    const mSaved   = storage.getRaw(KEYS.ACTIVE_GROUP);
    if (mSaved && mInitialSession.groups.some(g => g.id === mSaved)) return mSaved;
    if (mInitialSelectedElement) return findSelectedElementGroup(mInitialSession, mInitialSelectedElement) || mDefault;
    return mDefault;
  });
  const [editingBlock,    setEditingBlock]    = useState(mInitialEditingBlock);
  const [selectedElement, setSelectedElement] = useState(mInitialSelectedElement);
  const [poolDisplay,     setPoolDisplay]     = useState('25SC');
  const [showCsv,         setShowCsv]         = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [importError,     setImportError]     = useState('');
  const [activeAthlete,   setActiveAthlete]   = useState(null);
  const [pace200Map,      setPace200Map]       = useState(null);
  const [phvStatus,       setPhvStatus]       = useState('post');

  // ── Persistence effects ───────────────────────────────────────────────────

  useEffect(() => {
    storage.set(KEYS.SESSION, JSON.parse(exportSessionJson(session)));
  }, [session]);

  useEffect(() => {
    if (selectedElement) storage.set(KEYS.SELECTED_ELEMENT, selectedElement);
    else storage.remove(KEYS.SELECTED_ELEMENT);
  }, [selectedElement]);

  useEffect(() => {
    if (editingBlock) storage.set(KEYS.EDITING_BLOCK, editingBlock);
    else storage.remove(KEYS.EDITING_BLOCK);
  }, [editingBlock]);

  useEffect(() => {
    if (activeGroup) storage.setRaw(KEYS.ACTIVE_GROUP, activeGroup);
    else storage.remove(KEYS.ACTIVE_GROUP);
  }, [activeGroup]);

  // ── Athlete data ──────────────────────────────────────────────────────────

  function loadAthleteData() {
    const mData = storage.get(KEYS.ATHLETE);
    if (!mData) { setPace200Map(null); setActiveAthlete(null); return; }
    setPhvStatus(mData.phvStatus || 'post');
    setActiveAthlete({
      name: mData.name || '', seNumber: mData.seNumber || '', club: mData.club || '',
      times: mData.times || {}, derivedProfile: mData.derivedProfile || null,
      athleteType: mData.athleteType || 'allround', phvStatus: mData.phvStatus || 'post', pace200: mData.pace200 || '',
    });
    const mP200 = parseTime(mData.pace200) || 120;
    setPace200Map({ FS: mP200, BK: mP200 * 1.045, BR: mP200 * 1.254, Fly: mP200 * 1.051, IM: mP200 * 1.082 });
  }

  useEffect(() => {
    loadAthleteData();
    window.addEventListener('focus', loadAthleteData);
    return () => window.removeEventListener('focus', loadAthleteData);
  }, []);

  // Keep activeGroup aligned with selectedElement; clear stale selections
  useEffect(() => {
    if (!selectedElement) return;
    const mTarget = findSelectedElementGroup(session, selectedElement);
    if (mTarget) setActiveGroup(mTarget);
    else setSelectedElement(null);
  }, [session, selectedElement]);

  // ── Session mutations ─────────────────────────────────────────────────────

  function updateSession(pUpdater) {
    setSession(mPrev => {
      const mNext = typeof pUpdater === 'function' ? pUpdater(mPrev) : pUpdater;
      storage.set(KEYS.SESSION, mNext);
      return mNext;
    });
  }

  const sbAddGroup = () => {
    const mId = 'g' + Date.now();
    updateSession(s => ({ ...s, groups: [...s.groups, { id: mId, label: 'Set', blocks: [] }] }));
    setActiveGroup(mId);
  };

  const sbUpdateGroup = (pId, pKey, pVal) =>
    updateSession(s => ({ ...s, groups: s.groups.map(g => g.id === pId ? { ...g, [pKey]: pVal } : g) }));

  const sbDeleteGroup = (pId) => {
    updateSession(s => ({ ...s, groups: s.groups.filter(g => g.id !== pId) }));
    setActiveGroup('g1');
  };

  const sbCommitBlock = (pBlock) => {
    updateSession(s => ({ ...s, groups: s.groups.map(g => g.id === activeGroup ? { ...g, blocks: [...g.blocks, pBlock] } : g) }));
    setEditingBlock(null);
    setSelectedElement(null);
  };

  const sbReplaceBlock = (pBlock) => {
    updateSession(s => ({ ...s, groups: s.groups.map(g => g.id === activeGroup ? { ...g, blocks: g.blocks.map(b => b.id === pBlock.id ? pBlock : b) } : g) }));
    setEditingBlock(null);
    setSelectedElement(null);
  };

  const sbDeleteBlock = (pGroupId, pBlockId) =>
    updateSession(s => ({ ...s, groups: s.groups.map(g => g.id === pGroupId ? { ...g, blocks: g.blocks.filter(b => b.id !== pBlockId) } : g) }));

  const sbMoveBlock = (pGroupId, pBlockId, pDir) =>
    updateSession(s => ({ ...s, groups: s.groups.map(g => {
      if (g.id !== pGroupId) return g;
      const mArr = [...g.blocks];
      const mI = mArr.findIndex(b => b.id === pBlockId);
      const mJ = mI + pDir;
      if (mI < 0 || mJ < 0 || mJ >= mArr.length) return g;
      [mArr[mI], mArr[mJ]] = [mArr[mJ], mArr[mI]];
      return { ...g, blocks: mArr };
    })}));

  const sbBracketLines = (pGroupId, pBlockId, pLineIds) => {
    updateSession(s => ({ ...s, groups: s.groups.map(g => {
      if (g.id !== pGroupId) return g;
      return { ...g, blocks: g.blocks.map(b => {
        if (b.id !== pBlockId) return b;
        const mInner      = sbNewBlock({ repeats: '2', children: pLineIds.map(id => b.children.find(c => c.id === id)).filter(Boolean) });
        const mRemaining  = b.children.filter(c => !pLineIds.includes(c.id));
        const mFirstIdx   = b.children.findIndex(c => c.id === pLineIds[0]);
        return { ...b, children: [...mRemaining.slice(0, mFirstIdx), mInner, ...mRemaining.slice(mFirstIdx)] };
      })};
    })}));
    setSelectedElement(null);
  };

  // ── Import ────────────────────────────────────────────────────────────────

  function handleLoadSession() {
    const mEl = document.getElementById('json-import-area');
    if (!mEl?.value?.trim()) { setImportError('Please paste valid SwimZone session JSON.'); return; }
    try {
      const mResult = importSessionJson(mEl.value);
      setSession(mResult);
      setActiveGroup(mResult.groups[0]?.id || 'g1');
      storage.set(KEYS.SESSION, mResult);
      setImportError('');
      mEl.value = '';
      setShowCsv(false);
    } catch (e) {
      setImportError(e.message);
      alert('Import error: ' + e.message);
    }
  }

  // ── Pool time converter — depends on poolDisplay, passed to SbBlockView ──
  // Converts stored times for display only. Stored poolType on each line is
  // never mutated — only the display changes when the pool toggle changes.
  const convertTime = (pTimeStr, pFromPool) =>
    convertTimeForDisplay(pTimeStr, pFromPool || '25SC', poolDisplay);

  // ── Derived totals ────────────────────────────────────────────────────────

  const mSessionVolume = () => session.groups.reduce((s, g) => s + g.blocks.reduce((s2, b) => s2 + sbBlockVolume(b), 0), 0);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a2e', color: '#fff', fontFamily: 'monospace', padding: '16px 12px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em', marginBottom: 2 }}>ELLESMERE PORT ASC</div>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.04em' }}>SET BUILDER</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 2, letterSpacing: '0.08em' }}>SWEETENHAM ENERGY ZONE MODEL · v5</div>
        </div>

        <button onClick={() => navigate('/classifier')} style={{ padding: '6px 10px', fontSize: 11, borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(48,176,199,0.12)', color: '#fff', cursor: 'pointer', marginBottom: 16 }}>
          Back to Classifier
        </button>

        {/* Session title + totals */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input
            value={session.title}
            onChange={e => updateSession(s => ({ ...s, title: e.target.value }))}
            placeholder="Session title…"
            style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 6, color: '#fff', padding: '7px 11px', fontFamily: 'monospace', fontSize: 12, outline: 'none' }}
          />
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>
            {mSessionVolume()}m &middot; {sbFmtDur(session.groups.reduce((s, g) => s + g.blocks.reduce((s2, b) => s2 + sbBlockTotalTime(b), 0), 0))}
          </div>
        </div>

        {/* Pool toggle */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginRight: 2 }}>POOL:</span>
          {['50LC', '25SC', '25Y'].map(p => (
            <button key={p} onClick={() => setPoolDisplay(p)} style={{ padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700, border: '1px solid', borderColor: poolDisplay === p ? 'rgba(48,176,199,0.5)' : 'rgba(255,255,255,0.08)', background: poolDisplay === p ? 'rgba(48,176,199,0.12)' : 'transparent', color: poolDisplay === p ? '#30B0C7' : 'rgba(255,255,255,0.28)' }}>
              {p === '50LC' ? '50m LC' : p === '25SC' ? '25m SC' : '25 yard'}
            </button>
          ))}
        </div>

        {/* Group tabs */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
          {session.groups.map(g => (
            <button key={g.id} onClick={() => { setActiveGroup(g.id); setSelectedElement(null); }} style={{ padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, fontWeight: 700, border: '1px solid', borderColor: activeGroup === g.id ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)', background: activeGroup === g.id ? 'rgba(255,255,255,0.10)' : 'transparent', color: activeGroup === g.id ? '#fff' : 'rgba(255,255,255,0.35)' }}>
              {g.label}{g.blocks.length > 0 ? ' (' + g.blocks.reduce((s, b) => s + sbBlockVolume(b), 0) + 'm)' : ''}
            </button>
          ))}
          <button onClick={sbAddGroup} style={{ padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, border: '1px dashed rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.3)' }}>+ Group</button>
        </div>

        {/* Active group */}
        {session.groups.filter(g => g.id === activeGroup).map(group => (
          <div key={group.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <input value={group.label} onChange={e => sbUpdateGroup(group.id, 'label', e.target.value)} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', padding: '6px 10px', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, outline: 'none' }} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>
                {group.blocks.reduce((s, b) => s + sbBlockVolume(b), 0)}m &middot; {sbFmtDur(group.blocks.reduce((s, b) => s + sbBlockTotalTime(b), 0))}
              </span>
              {session.groups.length > 1 && (
                <button onClick={() => sbDeleteGroup(group.id)} style={{ padding: '3px 7px', background: 'rgba(255,45,85,0.08)', border: '1px solid rgba(255,45,85,0.25)', borderRadius: 4, color: 'rgba(255,45,85,0.6)', cursor: 'pointer', fontSize: 10 }}>✕</button>
              )}
            </div>

            {group.blocks.map((block, bi) => (
              <SbBlockView
                key={block.id} block={block}
                onEdit={() => setEditingBlock({ ...block, _mode: 'edit' })}
                onDelete={() => sbDeleteBlock(group.id, block.id)}
                onMoveUp={() => sbMoveBlock(group.id, block.id, -1)}
                onMoveDown={() => sbMoveBlock(group.id, block.id, 1)}
                isFirst={bi === 0} isLast={bi === group.blocks.length - 1}
                sbZoneColor={sbZoneColor} sbFmtDur={sbFmtDur}
                sbBlockVolume={sbBlockVolume} sbBlockTotalTime={sbBlockTotalTime} sbLineRest={sbLineRest}
                isSelected={selectedElement?.type === 'block' && selectedElement?.id === block.id}
                onSelect={() => {
                  const mSel = { type: 'block', id: block.id };
                  setSelectedElement(mSel);
                  storage.set(KEYS.SELECTED_ELEMENT, mSel);
                }}
                onToggleSelect={() => {}} selectMode={false} selectedLines={{}} onBracket={() => {}}
                pace200Map={pace200Map} phvStatus={phvStatus}
                convertTime={convertTime}
              />
            ))}

            {!editingBlock && (
              <button onClick={() => setEditingBlock(sbNewBlock())} style={{ width: '100%', padding: '9px', marginTop: 4, background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.10)', borderRadius: 8, color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.06em' }}>
                + ADD BLOCK
              </button>
            )}
          </div>
        ))}

        {/* Block editor */}
        {editingBlock && (
          <SbBlockEditor
            block={editingBlock} onChange={setEditingBlock}
            onCommit={() => { if (editingBlock._mode === 'edit') sbReplaceBlock(editingBlock); else sbCommitBlock(editingBlock); }}
            onCancel={() => setEditingBlock(null)}
            sbNewLine={sbNewLine} sbNewBlock={sbNewBlock}
            sbAddChild={sbAddChild} sbDeleteChild={sbDeleteChild}
            sbUpdateChild={sbUpdateChild} sbMoveChild={sbMoveChild}
            sbParseSec={sbParseSec} sbFmtDur={sbFmtDur}
            sbZoneColor={sbZoneColor} sbLineRest={sbLineRest}
            sbBlockVolume={sbBlockVolume} sbBlockTotalTime={sbBlockTotalTime}
            pace200Map={pace200Map} phvStatus={phvStatus} poolDisplay={poolDisplay}
          />
        )}

        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => setShowCsv(showCsv === 'import' ? false : 'import')} style={{ padding: '5px 14px', background: 'rgba(48,176,199,0.06)', border: '1px solid rgba(48,176,199,0.2)', borderRadius: 5, color: 'rgba(48,176,199,0.6)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>
            {showCsv === 'import' ? 'HIDE IMPORT' : '⬇ IMPORT SESSION'}
          </button>
        </div>

        {showCsv === 'import' && (
          <div style={{ marginTop: 6, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(48,176,199,0.15)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 4 }}>Paste SwimZone JSON to load a saved session:</div>
            <textarea placeholder="Paste session JSON here…" rows={4} id="json-import-area" style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace', fontSize: 9, padding: 8, resize: 'vertical', boxSizing: 'border-box', outline: 'none', marginBottom: 6 }} />
            <button onClick={handleLoadSession} style={{ padding: '5px 14px', background: 'rgba(48,176,199,0.12)', border: '1px solid rgba(48,176,199,0.4)', borderRadius: 5, color: '#30B0C7', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>LOAD SESSION</button>
            {importError && <div style={{ marginTop: 8, fontSize: 9, color: '#ff6b6b' }}>{importError}</div>}
          </div>
        )}

        {/* Export */}
        {mSessionVolume() > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => setShowPrintPreview(!showPrintPreview)} style={{ padding: '5px 14px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 5, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>
              {showPrintPreview ? 'HIDE PREVIEW' : '⎙ PRINT PREVIEW'}
            </button>
            <button onClick={() => setShowCsv(showCsv === 'json' ? false : 'json')} style={{ padding: '5px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 5, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>
              {showCsv === 'json' ? 'HIDE EXPORT' : 'EXPORT SESSION'}
            </button>
          </div>
        )}

        {showPrintPreview && mSessionVolume() > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button onClick={() => {
                const mWin = window.open('', '_blank');
                if (!mWin) return;
                mWin.document.write(generateSessionPrintHtml(session, activeAthlete, poolDisplay, convertTime));
                mWin.document.close();
                setTimeout(() => mWin.print(), 400);
              }} style={{ padding: '5px 14px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 5, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>
                ⎙ OPEN PRINT VIEW
              </button>
            </div>
            {/* Inline preview */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: 12, fontSize: 10, fontFamily: 'monospace' }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 8 }}>
                PREVIEW — {poolDisplay} · {mSessionVolume()}m
              </div>
              {session.groups.map(g => (
                <div key={g.id} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{g.label}</div>
                  {g.blocks.map(b => (
                    <div key={b.id} style={{ marginBottom: 6, paddingLeft: 8, borderLeft: '2px solid rgba(255,255,255,0.08)' }}>
                      {parseFloat(b.repeats) > 1 && (
                        <span style={{ color: '#FFCC00', fontWeight: 700, marginRight: 6 }}>{b.repeats}×</span>
                      )}
                      {b.label && <span style={{ color: 'rgba(255,255,255,0.4)', marginRight: 6 }}>{b.label}</span>}
                      {(b.children || []).filter(c => c.type === 'swim').map(c => (
                        <div key={c.id} style={{ color: 'rgba(255,255,255,0.55)', paddingLeft: 8, marginTop: 2 }}>
                          {c.qty && parseFloat(c.qty) > 1 ? c.qty + '× ' : ''}{c.distM}m {c.stroke}
                          {c.targetTime && <span style={{ color: 'rgba(255,255,255,0.35)' }}> IN {convertTime(c.targetTime, c.poolType)}</span>}
                          {c.onTime && <span style={{ color: 'rgba(255,255,255,0.25)' }}> ON {convertTime(c.onTime, c.poolType)}</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {showCsv === 'json' && mSessionVolume() > 0 && (
          <div style={{ marginTop: 8, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 4 }}>SESSION JSON</div>
            <textarea value={exportSessionJson(session)} readOnly onClick={e => e.target.select()} rows={6} style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace', fontSize: 9, padding: 8, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
          </div>
        )}

      </div>
    </div>
  );
}
