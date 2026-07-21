// src/services/classifierService.js
// Classifier data operations: result formatting, HTML/print export.
// Pure functions — no React, no DOM (callers handle rendering/window.open).
// Future: replace function bodies with fetch('/api/classifier/…') calls; signatures stay the same.

import { ZONES, secToDisplay } from '../zones/index.js';

// ─── formatResultSummary ──────────────────────────────────────────────────────

/**
 * Format a classifySet() result as a plain-text summary string.
 * Useful for copy-to-clipboard.
 *
 * @param {Object} pResult   Return value of classifySet()
 * @param {Object} pInputs   Classifier inputs { distM, qty, targetTime, onTime, stroke }
 * @returns {string}
 */
export function formatResultSummary(pResult, pInputs) {
  if (!pResult) return '';
  const mZone  = ZONES[pResult.zone];
  const mLines = [
    pInputs.qty + ' × ' + pInputs.distM + 'm ' + pInputs.stroke,
    'Target: ' + pInputs.targetTime + (pInputs.onTime ? '  On: ' + pInputs.onTime : ''),
    'Zone: ' + pResult.zone + (mZone ? ' — ' + mZone.name : ''),
    'Speed ratio: ' + (pResult.speedRatio * 100).toFixed(1) + '%',
  ];
  if (pResult.consistencyWarning) mLines.push('Note: ' + pResult.consistencyWarning);
  return mLines.join('\n');
}

// ─── generatePrintHtml ────────────────────────────────────────────────────────

/**
 * Generate a complete, self-contained HTML document string for printing.
 * Caller is responsible for window.open() and win.document.write().
 *
 * @param {Object} pResult      classifySet() result
 * @param {Object} pInputs      { distM, qty, targetTime, onTime, stroke }
 * @param {Object|null} pAthlete  active athlete object (may be null)
 * @returns {string}  Full HTML document string
 */
export function generatePrintHtml(pResult, pInputs, pAthlete) {
  if (!pResult) return '';

  const mDate      = new Date().toLocaleDateString('en-GB');
  const mAthleteLn = pAthlete
    ? `<p style="font-size:11px;color:#666;margin:0 0 4px">${pAthlete.name || 'Unnamed'} · ${pAthlete.club || ''}</p>`
    : '';
  const mSetLn     = `${pInputs.stroke} · ${pInputs.distM}m × ${pInputs.qty} · IN ${pInputs.targetTime} · ON ${pInputs.onTime || '—'}`;
  const mZoneRows  = pResult.breakdown
    .filter(z => z.pct > 0)
    .map(z => `
      <tr>
        <td style="padding:5px 8px">${z.name}</td>
        <td style="padding:5px 8px;font-weight:700;color:${z.color}">${z.pct}%</td>
        <td style="padding:5px 8px">${z.rpe}</td>
        <td style="padding:5px 8px;font-size:11px;color:#666">${z.desc}</td>
      </tr>`).join('');
  const mEnergy    = `ATP-CP: ${(pResult.avgAtpcp * 100).toFixed(0)}% · Glycolytic: ${(pResult.avgGlycolytic * 100).toFixed(0)}% · Aerobic: ${(pResult.avgAerobic * 100).toFixed(0)}%`;
  const mPhvBlock  = pResult.phvWarning
    ? `<div style="background:#fff3cd;border-left:4px solid #ff9500;padding:10px;margin:12px 0">${pResult.phvWarning}</div>`
    : '';
  const mConsBlock = pResult.consistencyWarning
    ? `<div style="background:#fff3cd;border-left:4px solid #ff9500;padding:10px;margin:12px 0">
        <strong>Consistency Warning</strong><br>
        Rep ${pResult.consistencyWarning.rep} estimated ${pResult.consistencyWarning.estimatedTime}s
        (${pResult.consistencyWarning.degradationPct.toFixed(1)}% slower).
        Suggest rest ~${pResult.consistencyWarning.suggestedRest}s.
       </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <title>Zone Report</title>
  <style>
    body { font-family: monospace; margin: 32px; color: #111 }
    h1   { font-size: 16px; text-transform: uppercase; margin: 0 0 4px }
    h2   { font-size: 13px; text-transform: uppercase; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin: 16px 0 8px }
    table { width: 100%; border-collapse: collapse }
    th    { background: #111; color: #fff; padding: 6px 8px; font-size: 10px; text-align: left }
    @media print { body { margin: 16px } }
  </style>
</head>
<body>
  <h1>Swim Zone Classifier</h1>
  ${mAthleteLn}
  <p style="font-size:11px;color:#888;margin:0 0 12px">${mDate} · ${mSetLn}</p>
  <h2>Primary Zone: ${pResult.primary.name} — ${pResult.primary.pct}%</h2>
  <p style="font-size:12px">${pResult.primary.desc}</p>
  ${mConsBlock}
  ${mPhvBlock}
  <h2>Zone Breakdown</h2>
  <table>
    <thead><tr><th>Zone</th><th>%</th><th>RPE</th><th>Description</th></tr></thead>
    <tbody>${mZoneRows}</tbody>
  </table>
  <h2>Energy Systems</h2>
  <p style="font-size:12px">${mEnergy}</p>
</body>
</html>`;
}

// ─── generateSessionPrintHtml ────────────────────────────────────────────────

/**
 * Generate a printable HTML document for a full session.
 *
 * @param {Object}      pSession       session object with groups/blocks
 * @param {Object|null} pAthlete       active athlete (may be null)
 * @param {string}      pPoolDisplay   e.g. '25SC', '50LC', '25Y'
 * @param {Function}    pConvertTime   fn(timeStr, fromPool) → displayStr
 * @returns {string} full HTML document
 */
export function generateSessionPrintHtml(pSession, pAthlete, pPoolDisplay, pConvertTime) {
  const mDate      = new Date().toLocaleDateString('en-GB');
  const mTitle     = pSession.title || 'Training Session';
  const mAthleteLn = pAthlete
    ? `<p style="margin:0 0 2px;font-size:11px;color:#555">${pAthlete.name || 'Unnamed'} · ${pAthlete.club || ''}</p>`
    : '';

  const mGroupRows = pSession.groups.map(g => {
    if (!g.blocks?.length) return '';

    const mBlockRows = g.blocks.map(b => {
      const mRepStr = parseFloat(b.repeats) > 1 ? `${b.repeats}× ` : '';
      const mLabel  = b.label ? ` <em style="color:#666">${b.label}</em>` : '';

      const mLineRows = (b.children || []).map(c => {
        if (c.children !== undefined) {
          // Nested block
          const mInner = (c.children || []).filter(l => l.type === 'swim').map(l => {
            const mIN = l.targetTime ? ' IN ' + pConvertTime(l.targetTime, l.poolType) : '';
            const mON = l.onTime     ? ' ON ' + pConvertTime(l.onTime,     l.poolType) : '';
            return `<div style="padding:1px 0 1px 16px;font-size:11px;color:#444">`
              + (parseFloat(l.qty) > 1 ? l.qty + '× ' : '') + l.distM + 'm ' + l.stroke
              + mIN + mON + '</div>';
          }).join('');
          return `<div style="padding:2px 0 2px 8px;border-left:2px solid #ddd">`
            + `<span style="font-weight:700;color:#333">${parseFloat(c.repeats) > 1 ? c.repeats + '× ' : ''}</span>`
            + mInner + '</div>';
        }
        if (c.type === 'rest' || c.type === 'note') {
          return `<div style="padding:1px 0;font-size:11px;color:#888;font-style:italic">— ${c.note || 'Rest'}${c.onTime ? ' ' + c.onTime : ''}</div>`;
        }
        if (c.type !== 'swim') return '';
        const mIN = c.targetTime ? ' IN <strong>' + pConvertTime(c.targetTime, c.poolType) + '</strong>' : '';
        const mON = c.onTime     ? ' ON ' + pConvertTime(c.onTime, c.poolType) : '';
        const mNote = c.note ? ` <em style="color:#888">${c.note}</em>` : '';
        return `<div style="padding:2px 0;font-size:12px">`
          + (parseFloat(c.qty) > 1 ? c.qty + '× ' : '')
          + `<strong>${c.distM}m ${c.stroke}</strong>${mIN}${mON}${mNote}</div>`;
      }).join('');

      return `<div style="margin-bottom:10px;padding:8px;background:#fafafa;border-radius:4px;border:1px solid #eee">`
        + `<div style="font-weight:700;margin-bottom:4px">${mRepStr}${mLabel}</div>`
        + mLineRows + '</div>';
    }).join('');

    // Group volume
    const mVol = g.blocks.reduce((s, b) => {
      let mBVol = 0;
      const countBlock = bl => {
        (bl.children || []).forEach(c => {
          if (c.children !== undefined) countBlock(c);
          else if (c.type === 'swim') mBVol += (parseFloat(c.qty) || 1) * (parseFloat(c.distM) || 0);
        });
      };
      countBlock(b);
      return s + mBVol * (parseFloat(b.repeats) || 1);
    }, 0);

    return `<div style="margin-bottom:20px">`
      + `<h2 style="font-size:13px;border-bottom:1px solid #ddd;padding-bottom:4px;margin:0 0 8px">`
      + `${g.label} <span style="font-size:10px;color:#888;font-weight:400">${Math.round(mVol)}m</span></h2>`
      + mBlockRows + '</div>';
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <title>${mTitle}</title>
  <style>
    body { font-family: monospace; margin: 32px; color: #111; max-width: 680px }
    h1   { font-size: 18px; margin: 0 0 4px }
    h2   { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em }
    @media print { body { margin: 16px } }
  </style>
</head>
<body>
  <h1>${mTitle}</h1>
  ${mAthleteLn}
  <p style="font-size:10px;color:#888;margin:0 0 16px">${mDate} · ${pPoolDisplay}</p>
  ${mGroupRows}
</body>
</html>`;
}
