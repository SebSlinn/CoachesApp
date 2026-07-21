// lib/classifier/helpers.js - Classifier helper functions

import { parseTime, secToDisplay, fmtTime } from "../../zones/index.js";

// Pool conversion constants
const POOL_TO_LC = { "50LC": 1.0, "25SC": 1.0344, "25Y": 1.0966 };
const POOL_FROM_LC = { "50LC": 1.0, "25SC": 0.9667, "25Y": 0.9119 };
const POOL_LABEL = { "50LC": "50m LC", "25SC": "25m SC", "25Y": "25 yard" };

/**
 * Convert time between pool types
 */
export function convertTime(secStr, fromPool, toPool) {
  fromPool = fromPool || "50LC";
  toPool = toPool || "50LC";
  if (!secStr || fromPool === toPool) return secStr;
  const sec = parseTime(String(secStr));
  if (!sec || isNaN(sec)) return secStr;

  // Convert: fromPool → LC → toPool
  const lcSec = sec * (POOL_TO_LC[fromPool] || 1.0);
  const converted = lcSec * (POOL_FROM_LC[toPool] || 1.0);
  const m = Math.floor(converted / 60);
  const s = converted % 60;
  let sStr = s.toFixed(1);
  if (sStr.endsWith(".0")) sStr = sStr.slice(0, -2);
  if (m > 0) return m + ":" + (parseFloat(sStr) < 10 ? "0" : "") + sStr;
  return sStr;
}

/**
 * Generate coaching notes from result
 */
export function generateCoachNote(result) {
  if (!result) return "";
  const { speedRatio, workDur, restWorkRatio, restoreCheck, lastRep, avgAtpcp, avgGlycolytic } = result;
  const notes = [];

  if (!restoreCheck.atpcpRestored && avgAtpcp * 100 < 5)
    notes.push(
      "ATP-CP virtually absent after rep 1 (rest:work " +
        restWorkRatio.toFixed(1) +
        ":1, needs 6:1). Set is glycolytic/aerobic from rep 2."
    );
  if (restoreCheck.atpcpRestored)
    notes.push(
      "Rest is sufficient (" +
        restWorkRatio.toFixed(1) +
        ":1 ≥ 6:1) — ATP-CP partially replenishes between reps."
    );
  if (workDur > 90 && speedRatio < 0.95)
    notes.push("Rep duration " + workDur.toFixed(0) + "s — glycolytic system under sustained stress.");
  if (lastRep && lastRep.aerobic > 0.65)
    notes.push("By the last rep, aerobic contribution is ~" + (lastRep.aerobic * 100).toFixed(0) + "%.");

  return notes.join(" ");
}

/**
 * Export session as JSON
 */
export function generateSessionJson(session, activeAthlete, inputs, derivedProfile) {
  const exportObj = {
    _format: "SwimZone-v1",
    exportedAt: new Date().toISOString(),
    athlete: activeAthlete
      ? {
          name: activeAthlete.name || "",
          seNumber: activeAthlete.seNumber || "",
          club: activeAthlete.club || "",
          athleteType: inputs.athleteType,
          phvStatus: inputs.phvStatus,
          times: activeAthlete.times || {},
          derivedProfile: activeAthlete.derivedProfile || derivedProfile || null,
          pace200: inputs.pace200,
          stroke: inputs.stroke,
        }
      : null,
    session: session,
  };
  return JSON.stringify(exportObj, null, 2);
}

/**
 * Import session from JSON
 */
export function importSessionJson(
  text,
  onUpdateSession,
  onUpdateActiveGroup,
  onUpdateInputs,
  onSetAthleteTimes,
  onSetAthleteName,
  onSetSeNumber,
  onSetClubName,
  onSetActiveAthlete
) {
  try {
    const obj = JSON.parse(text);
    if (!obj._format || !obj._format.startsWith("SwimZone")) {
      return "Not a SwimZone session file";
    }

    if (obj.session) {
      onUpdateSession(obj.session);
      if (obj.session.groups && obj.session.groups[0]) {
        onUpdateActiveGroup(obj.session.groups[0].id);
      }
    }

    if (obj.athlete) {
      if (obj.athlete.athleteType) onUpdateInputs("athleteType", obj.athlete.athleteType);
      if (obj.athlete.phvStatus) onUpdateInputs("phvStatus", obj.athlete.phvStatus);
      if (obj.athlete.pace200) onUpdateInputs("pace200", obj.athlete.pace200);
      if (obj.athlete.stroke) onUpdateInputs("stroke", obj.athlete.stroke);

      if (obj.athlete.times && Object.keys(obj.athlete.times).length > 0) {
        onSetAthleteTimes(obj.athlete.times);
        onSetAthleteName(obj.athlete.name || "");
        onSetSeNumber(obj.athlete.seNumber || "");
        onSetClubName(obj.athlete.club || "");
        onSetActiveAthlete({
          times: obj.athlete.times,
          derivedProfile: obj.athlete.derivedProfile || null,
          name: obj.athlete.name || "",
          seNumber: obj.athlete.seNumber || "",
          club: obj.athlete.club || "",
        });
      }
    }
    return null; // success
  } catch (e) {
    return "Invalid JSON: " + e.message;
  }
}

/**
 * Generate session as HTML for printing
 */
export function generateSetHtml(
  session,
  activeAthlete,
  inputsStroke,
  poolDisplay,
  sbGroupVolume,
  sbBlockVolume,
  sbGroupTime,
  sbBlockTotalTime,
  sbFmtDur,
  sbSessionVolume
) {
  const ZONE_COLORS = {
    HVO: "#FF2D55",
    LT: "#FF5500",
    LP: "#FF9500",
    AT: "#FFCC00",
    CS: "#30B0C7",
    A3: "#34C759",
    A2: "#30B0C7",
    A1: "#007AFF",
    Drill: "#8E8E93",
    Skills: "#BF5AF2",
  };

  function cvtTime(secStr, fromPool) {
    return convertTime(secStr, fromPool, poolDisplay);
  }

  function zoneTag(z) {
    if (!z) return "";
    const c = ZONE_COLORS[z] || "#888";
    return (
      '<span style="background:' +
      c +
      '22;border:1px solid ' +
      c +
      '66;color:' +
      c +
      ';padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;' +
      'font-family:monospace;margin-left:6px;">' +
      z +
      "</span>"
    );
  }

  function renderLines(children, depth) {
    let html = "";
    const pad = depth * 20;

    children.forEach((child) => {
      if (child.children !== undefined) {
        // Inner bracket
        const reps = parseFloat(child.repeats) || 1;
        const vol = sbBlockVolume(child);
        const time = sbBlockTotalTime(child);

        html +=
          '<tr><td colspan="5" style="padding:4px 8px 2px ' +
          (pad + 8) +
          'px;">';
        html +=
          '<span style="color:#FFCC00;font-weight:900;font-size:14px;font-family:monospace;">' +
          child.repeats +
          "&times;</span>";

        if (child.label)
          html +=
            ' <span style="color:#aaa;font-style:italic;font-size:11px;">' +
            child.label +
            "</span>";

        html +=
          ' <span style="color:#888;font-size:10px;">' +
          Math.round(vol) +
          "m &middot; " +
          sbFmtDur(time) +
          "</span>";
        html += "</td></tr>";
        html += renderLines(child.children, depth + 1);
      } else if (child.type === "swim") {
        const qty = parseFloat(child.qty) || 1;
        const zBg = child.intensity ? (ZONE_COLORS[child.intensity] || "#888") + "11" : "transparent";
        const zBorder = child.intensity
          ? "border-left:3px solid " + (ZONE_COLORS[child.intensity] || "#ccc") + ";"
          : "border-left:3px solid #eee;";

        html += '<tr style="' + zBorder + '">';
        html +=
          '<td style="padding:5px 8px 5px ' + (pad + 16) + 'px;font-family:monospace;font-size:12px;">';

        if (qty > 1) html += '<span style="color:#888;">' + child.qty + "&times; </span>";
        html += "<strong>" + child.distM + "m " + child.stroke + "</strong>";

        if (child.modifier && child.modifier !== "Full")
          html += ' <span style="color:#888;font-size:11px;">' + child.modifier + "</span>";

        if (child.note)
          html += ' <span style="color:#666;font-style:italic;font-size:10px;">' + child.note + "</span>";

        html += "</td>";
        html +=
          '<td style="padding:5px 12px;font-family:monospace;font-size:12px;white-space:nowrap;">';

        if (child.targetTime) html += "IN <strong>" + cvtTime(child.targetTime, child.poolType) + "</strong>";

        html += "</td>";
        html +=
          '<td style="padding:5px 12px;font-family:monospace;font-size:12px;color:#888;white-space:nowrap;">';

        if (child.onTime) html += "ON " + cvtTime(child.onTime, child.poolType);

        html += "</td>";
        html +=
          '<td style="padding:5px 8px;font-size:11px;font-family:monospace;color:#888;">';

        if (child.onTime && child.targetTime) {
          const tc1 = String(child.targetTime).indexOf(":");
          const tc2 = String(child.onTime).indexOf(":");
          const wk =
            tc1 > -1
              ? parseInt(child.targetTime) * 60 + parseFloat(child.targetTime.slice(tc1 + 1))
              : parseFloat(child.targetTime) || 0;
          const on =
            tc2 > -1
              ? parseInt(child.onTime) * 60 + parseFloat(child.onTime.slice(tc2 + 1))
              : parseFloat(child.onTime) || 0;
          const rest = Math.max(0, on - wk);

          if (rest > 0) html += Math.round(rest) + "s rest";
        }

        html += "</td>";
        html += "<td style='padding:5px 8px;'>" + zoneTag(child.intensity) + "</td>";
        html += "</tr>";
      } else if (child.type === "rest") {
        html +=
          '<tr><td colspan="5" style="padding:3px 8px 3px ' +
          (pad + 16) +
          'px;' +
          'color:#cc8800;font-style:italic;font-size:11px;border-left:3px solid #cc880033;">' +
          "&mdash; " +
          (child.note || "Rest") +
          (child.onTime ? " " + cvtTime(child.onTime) : "") +
          "</td></tr>";
      } else if (child.type === "note") {
        html +=
          '<tr><td colspan="5" style="padding:3px 8px 3px ' +
          (pad + 16) +
          'px;' +
          'color:#999;font-style:italic;font-size:11px;">&#x2605; ' +
          child.note +
          "</td></tr>";
      }
    });

    return html;
  }

  const now = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const athleteStr = activeAthlete
    ? (activeAthlete.name || "") +
      (activeAthlete.seNumber ? " (" + activeAthlete.seNumber + ")" : "") +
      (activeAthlete.club ? " &middot; " + activeAthlete.club : "")
    : "";

  const cssStr =
    activeAthlete && activeAthlete.derivedProfile && activeAthlete.derivedProfile.css
      ? " &middot; CSS " + secToDisplay(activeAthlete.derivedProfile.css) + "/100m"
      : "";

  const poolStr = POOL_LABEL[poolDisplay] || "50m LC";

  let groupsHtml = "";

  session.groups.forEach((g) => {
    if (sbGroupVolume(g) === 0) return;

    groupsHtml +=
      '<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f0f0;' +
      'font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;' +
      'border-top:2px solid #ccc;color:#333;">' +
      g.label +
      '<span style="float:right;font-weight:400;color:#666;">' +
      Math.round(sbGroupVolume(g)) +
      "m &middot; " +
      sbFmtDur(sbGroupTime(g)) +
      "</span></td></tr>";

    g.blocks.forEach((b) => {
      const reps = parseFloat(b.repeats) || 1;
      const vol = sbBlockVolume(b);
      const time = sbBlockTotalTime(b);

      if (reps > 1 || b.label) {
        groupsHtml +=
          '<tr><td colspan="5" style="padding:6px 8px 2px 8px;' +
          'background:#fff8e6;border-left:4px solid #FFCC00;">';
        groupsHtml +=
          '<span style="color:#cc8800;font-weight:900;font-size:16px;font-family:monospace;">' +
          b.repeats +
          "&times;</span>";

        if (b.label)
          groupsHtml +=
            ' <span style="color:#997700;font-style:italic;">' + b.label + "</span>";

        groupsHtml +=
          ' <span style="color:#aaa;font-size:10px;">' +
          Math.round(vol) +
          "m &middot; " +
          sbFmtDur(time) +
          "</span>";
        groupsHtml += "</td></tr>";
      }

      groupsHtml += renderLines(b.children, reps > 1 || b.label ? 1 : 0);
    });
  });

  return (
    "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
    "<title>" +
    (session.title || "Session") +
    "</title><style>" +
    "body{font-family:Arial,sans-serif;margin:32px;color:#111;font-size:13px}" +
    "h1{font-size:20px;margin:0 0 2px}" +
    "table{width:100%;border-collapse:collapse;margin-bottom:8px}" +
    "tr:nth-child(even){background:#fafafa}" +
    "tr:hover{background:#f5f5f5}" +
    "@media print{body{margin:16px}.no-print{display:none}}" +
    "</style></head><body>" +
    "<div style='display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px'>" +
    "<div>" +
    "<h1>" +
    (session.title || "Untitled Session") +
    "</h1>" +
    "<div style='font-size:11px;color:#888;'>" +
    now +
    " &middot; " +
    poolStr +
    (athleteStr ? " &middot; " + athleteStr + cssStr : "") +
    "</div>" +
    "</div>" +
    "<div style='text-align:right;font-size:11px;color:#888;'>" +
    "<div>" +
    Math.round(sbSessionVolume()) +
    "m total</div>" +
    "<div>" +
    sbFmtDur(session.groups.reduce((s, g) => s + sbGroupTime(g), 0)) +
    "</div>" +
    "</div></div>" +
    "<table>" +
    groupsHtml +
    "</table>" +
    "<div style='margin-top:16px;font-size:9px;color:#bbb;border-top:1px solid #eee;padding-top:6px'>" +
    "Generated by Swim Zone Classifier &middot; Sweetenham model &middot; " +
    poolStr +
    "</div></body></html>"
  );
}

/**
 * Generate session as CSV
 */
export function generateSessionCsv(session, sbBlockVolume, sbGroupVolume) {
  const rows = ["Group,Block,Repeats,Line,Qty,Dist,Stroke,Target,ON,Rest,Zone,Note"];

  session.groups.forEach((g) => {
    g.blocks.forEach((b, bi) => {
      function addLines(block) {
        (block.children || []).forEach((c) => {
          if (c.children !== undefined) {
            addLines(c);
          } else if (c.type === "swim") {
            const on = c.onTime || "";
            const tgt = c.targetTime || "";
            const tc = String(tgt).indexOf(":");
            const w = tc > -1 ? parseInt(tgt) * 60 + parseFloat(tgt.slice(tc + 1)) : parseFloat(tgt) || 0;
            const oc = String(on).indexOf(":");
            const o2 = oc > -1 ? parseInt(on) * 60 + parseFloat(on.slice(oc + 1)) : parseFloat(on) || w;
            const rest = Math.max(0, o2 - w);

            rows.push(
              [
                g.label,
                bi + 1,
                block.repeats || 1,
                c.id,
                c.qty || 1,
                c.distM || "",
                c.stroke || "FS",
                tgt,
                on,
                Math.round(rest) + "s",
                c.intensity || "",
                (c.note || "").replace(/,/g, ""),
              ].join(",")
            );
          } else if (c.type === "rest") {
            rows.push(
              [
                g.label,
                bi + 1,
                block.repeats || 1,
                c.id,
                "",
                "",
                "",
                "",
                c.onTime || "",
                "",
                "REST",
                (c.note || "").replace(/,/g, ""),
              ].join(",")
            );
          }
        });
      }

      addLines(b);
    });
  });

  return rows.join("\n");
}
