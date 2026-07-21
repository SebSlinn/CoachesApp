// components/SbBlockEditor.jsx
import { useState } from 'react';
import SbLineView from './SbLineView.jsx';
import SbLineEditor from './SbLineEditor.jsx';

function SbBlockEditor({ block, onChange, onCommit, onCancel,
  sbNewLine, sbNewBlock, sbAddChild, sbDeleteChild, sbUpdateChild, sbMoveChild,
  sbParseSec, sbFmtDur, sbZoneColor, sbLineRest, sbBlockVolume, sbBlockTotalTime,
  pace200Map }) {

  const [addingInner, setAddingInner] = useState(false);
  const [innerBlock, setInnerBlock] = useState(null);

  const inp = { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6, color: "#fff", padding: "7px 9px", fontFamily: "monospace",
    fontSize: 13, outline: "none", boxSizing: "border-box", width: "100%" };
  const lbl = { fontSize: 9, color: "rgba(255,255,255,0.3)", display: "block",
    marginBottom: 3, letterSpacing: "0.08em" };

  function commitInner() {
    onChange(sbAddChild(block, innerBlock));
    setInnerBlock(null);
    setAddingInner(false);
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 14, marginTop: 8 }}>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)",
        letterSpacing: "0.1em", marginBottom: 10 }}>
        {block._mode === "edit" ? "EDITING BLOCK" : "NEW BLOCK"}
        <span style={{ marginLeft: 10, color: "rgba(255,255,255,0.2)" }}>
          {Math.round(sbBlockVolume(block))}m &middot; {sbFmtDur(sbBlockTotalTime(block))}
        </span>
      </div>

      {/* Block settings */}
      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, marginBottom: 12 }}>
        <div>
          <label style={lbl}>REPEATS</label>
          <input type="number" min="1" value={block.repeats}
            onChange={e => onChange({ ...block, repeats: e.target.value })} style={inp} />
        </div>
        <div>
          <label style={lbl}>LABEL (optional — e.g. "Fast", "Perfect turns")</label>
          <input placeholder="Coaching note on this block…" value={block.label}
            onChange={e => onChange({ ...block, label: e.target.value })} style={inp} />
        </div>
      </div>

      {/* Children list */}
      {block.children.map((child, ci) => (
        child.children !== undefined ? (
          // Inner block — display only with delete
          <div key={child.id} style={{ marginBottom: 6,
            background: "rgba(255,204,0,0.05)", border: "1px solid rgba(255,204,0,0.2)",
            borderLeft: "3px solid rgba(255,204,0,0.4)", borderRadius: 7, padding: "7px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap:6 }}>
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <input type="number" min="1" value={child.repeats}
                  onChange={e => onChange(sbUpdateChild(block, child.id, {...child, repeats: e.target.value}))}
                  style={{ width:40, background:"rgba(255,204,0,0.12)",
                    border:"1px solid rgba(255,204,0,0.3)", borderRadius:4,
                    color:"#FFCC00", padding:"2px 5px", fontFamily:"monospace",
                    fontSize:13, fontWeight:900, outline:"none", textAlign:"center" }} />
                <span style={{ fontSize:12, color:"rgba(255,204,0,0.7)",
                  fontFamily:"monospace", fontWeight:900 }}>&times;</span>
              </div>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                {Math.round(sbBlockVolume(child))}m &middot; {sbFmtDur(sbBlockTotalTime(child))}
              </span>
              <div style={{ display: "flex", gap: 3 }}>
                {ci > 0 && <button onClick={() => onChange(sbMoveChild(block, child.id, -1))}
                  style={{ padding: "2px 5px", background: "transparent",
                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3,
                    color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 9 }}>↑</button>}
                {ci < block.children.length - 1 && <button onClick={() => onChange(sbMoveChild(block, child.id, 1))}
                  style={{ padding: "2px 5px", background: "transparent",
                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3,
                    color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 9 }}>↓</button>}
                <button onClick={() => onChange(sbDeleteChild(block, child.id))}
                  style={{ padding: "2px 6px", background: "rgba(255,45,85,0.08)",
                    border: "1px solid rgba(255,45,85,0.2)", borderRadius: 3,
                    color: "rgba(255,45,85,0.6)", cursor: "pointer", fontSize: 9 }}>✕</button>
              </div>
            </div>
            {child.children.map((l, li) => l.children === undefined &&
              <SbLineEditor key={l.id} line={l}
                onChange={updated => onChange(sbUpdateChild(block, child.id, {
                  ...child,
                  children: child.children.map(c => c.id === l.id ? updated : c)
                }))}
                onDelete={() => onChange(sbUpdateChild(block, child.id, {
                  ...child,
                  children: child.children.filter(c => c.id !== l.id)
                }))}
                onMoveUp={() => {
                  var arr = [...child.children];
                  var i = arr.findIndex(c => c.id === l.id);
                  if (i > 0) { var tmp = arr[i-1]; arr[i-1] = arr[i]; arr[i] = tmp; }
                  onChange(sbUpdateChild(block, child.id, {...child, children: arr}));
                }}
                onMoveDown={() => {
                  var arr = [...child.children];
                  var i = arr.findIndex(c => c.id === l.id);
                  if (i < arr.length-1) { var tmp = arr[i]; arr[i] = arr[i+1]; arr[i+1] = tmp; }
                  onChange(sbUpdateChild(block, child.id, {...child, children: arr}));
                }}
                isFirst={li === 0} isLast={li === child.children.length - 1}
                pace200Map={pace200Map} />
            )}
            <button onClick={() => onChange(sbUpdateChild(block, child.id, {
                ...child, children: [...child.children, sbNewLine()]
              }))}
              style={{ width:"100%", marginTop:4, padding:"4px",
                background:"rgba(255,255,255,0.02)",
                border:"1px dashed rgba(255,255,255,0.08)", borderRadius:5,
                color:"rgba(255,255,255,0.25)", cursor:"pointer",
                fontFamily:"monospace", fontSize:9 }}>+ line</button>
          </div>
        ) : (
          <SbLineEditor key={child.id} line={child}
            onChange={updated => onChange(sbUpdateChild(block, child.id, () => updated))}
            onDelete={() => onChange(sbDeleteChild(block, child.id))}
            onMoveUp={() => onChange(sbMoveChild(block, child.id, -1))}
            onMoveDown={() => onChange(sbMoveChild(block, child.id, 1))}
            isFirst={ci === 0} isLast={ci === block.children.length - 1}
            pace200Map={pace200Map} />
        )
      ))}

      {/* Add line / inner block buttons */}
      {!addingInner && (
        <div style={{ display: "flex", gap: 6, marginTop: 4, marginBottom: 10 }}>
          <button onClick={() => onChange(sbAddChild(block, sbNewLine()))}
            style={{ flex: 2, padding: "7px", background: "rgba(255,255,255,0.03)",
              border: "1px dashed rgba(255,255,255,0.10)", borderRadius: 6,
              color: "rgba(255,255,255,0.3)", cursor: "pointer",
              fontFamily: "monospace", fontSize: 10 }}>+ LINE</button>
          <button onClick={() => { setAddingInner(true); setInnerBlock(sbNewBlock()); }}
            style={{ flex: 1, padding: "7px", background: "rgba(255,204,0,0.03)",
              border: "1px dashed rgba(255,204,0,0.2)", borderRadius: 6,
              color: "rgba(255,204,0,0.35)", cursor: "pointer",
              fontFamily: "monospace", fontSize: 10 }}>+ INNER BRACKET</button>
        </div>
      )}

      {/* Inner block editor (inline) */}
      {addingInner && innerBlock && (
        <div style={{ background: "rgba(255,204,0,0.04)",
          border: "1px solid rgba(255,204,0,0.2)", borderRadius: 8,
          padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: "rgba(255,204,0,0.5)",
            letterSpacing: "0.1em", marginBottom: 8 }}>INNER BRACKET</div>
          <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ ...lbl, color: "rgba(255,204,0,0.4)" }}>REPEATS</label>
              <input type="number" min="1" value={innerBlock.repeats}
                onChange={e => setInnerBlock(b => ({ ...b, repeats: e.target.value }))}
                style={{ ...inp, background: "rgba(255,204,0,0.06)",
                  border: "1px solid rgba(255,204,0,0.2)" }} />
            </div>
            <div>
              <label style={{ ...lbl, color: "rgba(255,204,0,0.4)" }}>LABEL (optional)</label>
              <input placeholder="e.g. Fast" value={innerBlock.label}
                onChange={e => setInnerBlock(b => ({ ...b, label: e.target.value }))}
                style={{ ...inp, background: "rgba(255,204,0,0.06)",
                  border: "1px solid rgba(255,204,0,0.2)" }} />
            </div>
          </div>
          {innerBlock.children.map((child, ci) => (
            <SbLineEditor key={child.id} line={child}
              onChange={updated => setInnerBlock(b => ({ ...b,
                children: b.children.map(c => c.id === child.id ? updated : c) }))}
              onDelete={() => setInnerBlock(b => ({ ...b,
                children: b.children.filter(c => c.id !== child.id) }))}
              onMoveUp={() => setInnerBlock(b => {
                const a = [...b.children]; const i = a.findIndex(c => c.id === child.id);
                if (i > 0) { [a[i-1],a[i]] = [a[i],a[i-1]]; } return { ...b, children: a };
              })}
              onMoveDown={() => setInnerBlock(b => {
                const a = [...b.children]; const i = a.findIndex(c => c.id === child.id);
                if (i < a.length-1) { [a[i],a[i+1]] = [a[i+1],a[i]]; } return { ...b, children: a };
              })}
              isFirst={ci === 0} isLast={ci === innerBlock.children.length - 1} />
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button onClick={() => setInnerBlock(b => ({ ...b,
              children: [...b.children, sbNewLine()] }))}
              style={{ flex: 2, padding: "6px", background: "rgba(255,255,255,0.03)",
                border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 5,
                color: "rgba(255,255,255,0.3)", cursor: "pointer",
                fontFamily: "monospace", fontSize: 10 }}>+ LINE</button>
            <button onClick={commitInner}
              style={{ flex: 1, padding: "6px", background: "rgba(255,204,0,0.08)",
                border: "1px solid rgba(255,204,0,0.3)", borderRadius: 5,
                color: "#FFCC00", cursor: "pointer",
                fontFamily: "monospace", fontSize: 10, fontWeight: 700 }}>ADD BRACKET</button>
            <button onClick={() => { setAddingInner(false); setInnerBlock(null); }}
              style={{ padding: "6px 10px", background: "transparent",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5,
                color: "rgba(255,255,255,0.3)", cursor: "pointer",
                fontFamily: "monospace", fontSize: 10 }}>CANCEL</button>
          </div>
        </div>
      )}

      {/* Commit / cancel */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ padding: "7px 16px", background: "transparent",
          border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6,
          color: "rgba(255,255,255,0.4)", cursor: "pointer",
          fontFamily: "monospace", fontSize: 10 }}>CANCEL</button>
        <button onClick={onCommit} style={{ padding: "7px 16px",
          background: "rgba(52,199,89,0.12)", border: "1px solid rgba(52,199,89,0.4)",
          borderRadius: 6, color: "#34C759", cursor: "pointer",
          fontFamily: "monospace", fontSize: 10, fontWeight: 700 }}>
          {block._mode === "edit" ? "SAVE" : "ADD TO SET"}
        </button>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

// ─── Multi-line sequence classifier ─────────────────────────────────────────

export default SbBlockEditor;
