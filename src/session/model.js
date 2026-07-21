//
import { STROKE_MULT, ZONES } from '../zones/constants.js';
import { phvZoneCaps, repEnergy } from '../zones/energy.js';

function flattenBlock(block, pace200Map, phvStatus) {
  var seq = [];
  var reps = parseInt(block.repeats) || 1;
  var SMULT = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };
  for (var ri = 0; ri < reps; ri++) {
    (block.children || []).forEach(function(child) {
      if (child.children !== undefined) {
        flattenBlock(child, pace200Map, phvStatus).forEach(function(s) { seq.push(s); });
      } else if (child.type === "swim" && child.distM && child.targetTime) {
        var stroke = child.stroke || "FS";
        var pace200 = pace200Map[stroke] || pace200Map["FS"] || 120;
        var base100 = (pace200 * (SMULT[stroke]||1.0)) / 2;
        var dist = parseFloat(child.distM) || 100;
        var tStr = String(child.targetTime || "");
        var tc = tStr.indexOf(":");
        var workSec = tc > -1 ? parseInt(tStr.slice(0,tc))*60+parseFloat(tStr.slice(tc+1)) : parseFloat(tStr)||60;
        var oSource = child.onTime;
        var oStr = oSource ? String(oSource) : tStr;
        var oc = oStr.indexOf(":");
        var onSec = oc > -1 ? parseInt(oStr.slice(0,oc))*60+parseFloat(oStr.slice(oc+1)) : parseFloat(oStr)||workSec;
        var lineQty = parseInt(child.qty) || 1;
        for (var qi = 0; qi < lineQty; qi++) {
          seq.push({ workSec:workSec, speedRatio:(workSec/dist*100)/base100,
            restSec:Math.max(0,onSec-workSec), stroke:stroke, dist:dist });
        }
      }
    });
  }
  return seq;
}

function classifySequence(seq, phvStatus, lactateClearMult, cssValue) {
  if (!seq || seq.length === 0) return null;
  var aRate=1/180, lRate=(1/300)*(lactateClearMult||1);
  var aStore=1.0, lBuf=1.0, reps=[], cA=0, cG=0, cAe=0;
  seq.forEach(function(rep) {
    var e = repEnergy(rep.workSec, rep.speedRatio, aStore, lBuf, phvStatus);
    reps.push({ rep:reps.length+1, atpcp:e.atpcp, glycolytic:e.glycolytic, aerobic:e.aerobic, atpcpStore:aStore, lactateBuf:lBuf });
    cA+=e.atpcp; cG+=e.glycolytic; cAe+=e.aerobic;
    var used=Math.min(aStore,(Math.min(rep.workSec,15)/15)*aStore);
    aStore=Math.max(0,aStore-used);
    lBuf=Math.max(0,lBuf-e.glycolytic*0.25*(rep.workSec/60));
    aStore=Math.min(1,aStore+rep.restSec*aRate);
    lBuf=Math.min(1,lBuf+rep.restSec*lRate);
  });
  var n=seq.length, avgA=cA/n, avgG=cG/n, avgAe=cAe/n;
  var caps=phvZoneCaps(phvStatus), ltC=caps.ltCap, lpC=caps.lpCap, atC=caps.atCap;
  var mSR=seq.map(function(s){return s.speedRatio;}).sort(function(a,b){return a-b;})[Math.floor(n/2)];
  var gLT=0,gLP=0,gAT=0;
  if(mSR<0.95){gLT=avgG*0.70*ltC;gLP=avgG*0.30*lpC;gAT+=avgG*(0.70*(1-ltC)+0.30*(1-lpC))*atC;}
  else if(mSR<0.97){gLT=avgG*0.85*ltC;gLP=avgG*0.15*lpC;gAT+=avgG*(0.85*(1-ltC)+0.15*(1-lpC))*atC;}
  else if(mSR<1.025){gLP=avgG*0.70*lpC;gAT=avgG*0.30*atC+avgG*0.70*(1-lpC)*atC;}
  else if(mSR<1.10){gAT=avgG*0.75*atC+avgG*0.25*(1-lpC)*atC;gLP=avgG*0.25*lpC;}
  else{gAT=avgG*0.40*atC;gLP=avgG*0.10*lpC;}
  var aA3=0,aA2=0,aA1=0;
  if(mSR<1.10)aA3=avgAe;
  else if(mSR<1.22){aA3=avgAe*0.70;aA2=avgAe*0.25;aA1=avgAe*0.05;}
  else if(mSR<1.38){aA2=avgAe*0.65;aA3=avgAe*0.25;aA1=avgAe*0.10;}
  else{aA1=avgAe*0.65;aA2=avgAe*0.35;}
  var raw={HVO:avgA,LT:gLT,LP:gLP,AT:gAT,A3:aA3,A2:aA2,A1:aA1};
  var tot=raw.HVO+raw.LT+raw.LP+raw.AT+raw.A3+raw.A2+raw.A1;
  var bd=ZONES.map(function(z){var o={};for(var k in z)o[k]=z[k];o.pct=Math.round((raw[z.id]/tot)*100);return o;}).sort(function(a,b){return b.pct-a.pct;});
  var pt=bd.reduce(function(s,z){return s+z.pct;},0); if(pt!==100)bd[0].pct+=(100-pt);
  var totalWorkSec = seq.reduce(function(s,r){return s+r.workSec;},0);
  var totalRestSec = seq.reduce(function(s,r){return s+r.restSec;},0);
  var avgRestWorkRatio = totalRestSec / (totalWorkSec||1);
  var totalVol = seq.reduce(function(s,r){return s+r.dist;},0);

  // CS detection for sequences
  var seqCsDetection = null;
  if (cssValue) {
    var css2 = cssValue;
    var csLow2 = css2*0.95, csHigh2 = css2*1.05;
    // Work reps: speedRatio <= 1.15 (AT or faster) - these are the CS target reps
    var workReps2 = seq.filter(function(r){ return r.speedRatio <= 1.15; });
    // Recovery reps: A1/A2 (speedRatio > 1.30) - their ON time is the rest between work reps
    var recovReps2 = seq.filter(function(r){ return r.speedRatio > 1.30; });
    if (workReps2.length === 0) {
      seqCsDetection = null;
    } else {
      var avgWorkPace2 = workReps2.reduce(function(s,r){return s+r.workSec/r.dist*100;},0)/workReps2.length;
      var speedOk2 = avgWorkPace2 >= csLow2 && avgWorkPace2 <= csHigh2;
      // Total work time = sum of work rep durations
      var csWorkSec = workReps2.reduce(function(s,r){return s+r.workSec;},0);
      var totalWorkMin2 = csWorkSec/60;
      var volumeOk2 = totalWorkMin2 >= 22 && totalWorkMin2 <= 38;
      // Rest = recovery rep ON times (workSec + restSec) + any inline rest from work reps
      var recovOnSec = recovReps2.reduce(function(s,r){return s+r.workSec+r.restSec;},0);
      var inlineRest = workReps2.reduce(function(s,r){return s+r.restSec;},0);
      var totalRestSec2 = recovOnSec + inlineRest;
      var workRestRatio2 = csWorkSec / (totalRestSec2||1);
      var restOk2 = workRestRatio2 >= 1.2 && workRestRatio2 <= 2.5;
      var matchCount2 = [speedOk2, volumeOk2, restOk2].filter(Boolean).length;
      seqCsDetection = {
        isCS: matchCount2 === 3, partial: matchCount2 === 2,
        speedOk: speedOk2, volumeOk: volumeOk2, restOk: restOk2,
        cssPace: css2, repPace100: avgWorkPace2,
        totalWorkMin: totalWorkMin2.toFixed(1),
        workRest: workRestRatio2.toFixed(2),
        distOk: true,
      };
    }
  }

  // PL detection for sequences
  var seqPlSuggestion = null;
  if (mSR < 0.95) {
    seqPlSuggestion = {
      speedOk: true,
      note: "Pace above race pace across this bracket. PL requires 10-15 min active A1 recovery between reps. If swimdown reps are included in this bracket, the full structure qualifies as PL."
    };
  }

  return { breakdown:bd, primary:bd[0], repResults:reps,
    avgAtpcp:avgA, avgGlycolytic:avgG, avgAerobic:avgAe,
    totalVolume:totalVol,
    workDur:totalWorkSec/n,
    speedRatio:mSR, restWorkRatio:avgRestWorkRatio,
    phvStatus:phvStatus, phvWarning:null, consistencyWarning:null,
    restoreCheck:{atpcpRestored:false,atpcpRestorePct:0},
    lastRep:reps[reps.length-1], isSequence:true, sequenceLength:n,
    paceValidation:null, csDetection:seqCsDetection, plSuggestion:seqPlSuggestion };
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export { flattenBlock, classifySequence };
