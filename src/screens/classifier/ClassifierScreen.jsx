// screens/classifier/ClassifierScreen.jsx
// The Classifier screen's body (pages/Classifier.jsx owns the state and passes it in).
//
//   StatusNotes        loaded athlete / Set Builder selection
//   InputsPanel        the set + zone picker + rest type
//   SuggestionPanel    IN / ON / HR / drills for the picked zone
//   Add to Set
//   ZoneCheckBanners   does the set meet the picked zone?
//   ResultWarnings     PL territory, pace, consistency, PHV
//   KeyMetrics, ViewTabs, then EnergyView | ZonesView | AdaptationsView
//   CoachNote, Print
//
// Colour rules (styles/theme.js): zone colours from the coach's scheme, energy colours and
// everything else from the theme. No colour literals in this folder.
import { parseTime, resolveZoneStyle } from '../../zones/index.js';
import { useZoneScheme } from '../../context/ZoneSchemeContext.jsx';
import { generatePrintHtml } from '../../services/classifierService.js';
import ResultWarnings from '../../components/ResultWarnings.jsx';
import { T } from '../../styles/theme.js';
import { ui } from '../../styles/ui.js';
import StatusNotes from './StatusNotes.jsx';
import InputsPanel from './InputsPanel.jsx';
import SuggestionPanel from './SuggestionPanel.jsx';
import ZoneCheckBanners from './ZoneCheckBanners.jsx';
import { KeyMetrics, ViewTabs, CoachNote } from './ResultSummary.jsx';
import EnergyView from './EnergyView.jsx';
import ZonesView from './ZonesView.jsx';
import AdaptationsView from './AdaptationsView.jsx';

function AddToSetButton({ inputs, selectedZone, result, classifierDrill, setClassifierDrill, poolDisplay,
                          sbNewLine, sbNewBlock, sbCommitBlock, editingBlock, setEditingBlock }) {
  if (!inputs.distM || !inputs.targetTime || !sbNewLine) return null;
  function add() {
    const mInSec = parseTime(inputs.targetTime) || 0;
    const mOn = inputs.onTime || (mInSec > 0 ? String(Math.round(mInSec)) : '');
    const mLine = sbNewLine({
      distM: inputs.distM, stroke: inputs.stroke, qty: inputs.qty,
      targetTime: inputs.targetTime, onTime: mOn,
      target: inputs.targetTime, turnaround: mOn,          // legacy aliases still read by Set Builder
      intensity: selectedZone || result?.primary?.id || 'A2',
      note: classifierDrill || '',
      modifier: classifierDrill ? 'Drill' : 'Full',
      poolType: poolDisplay,
    });
    if (editingBlock) setEditingBlock(b => b ? { ...b, children: [...b.children, mLine] } : b);
    else sbCommitBlock(sbNewBlock({ children: [mLine] }));
    setClassifierDrill?.('');
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
      <button onClick={add} style={ui.button}>+ ADD TO SET{editingBlock ? ' (open block)' : ''}</button>
    </div>
  );
}

function printReport(pResult, pInputs, pAthlete, pZoneStyle) {
  const mWin = window.open('', '_blank');
  if (!mWin) return;
  mWin.document.write(generatePrintHtml(pResult, pInputs, pAthlete, pZoneStyle));
  mWin.document.close();
  setTimeout(() => mWin.print(), 400);
}

const VIEWS = { energy: EnergyView, zones: ZonesView, adaptations: AdaptationsView };

export default function ClassifierScreen(props) {
  const {
    inputs, set, selectedZone, setSelectedZone, classifierDrill, setClassifierDrill,
    singleResult: pSingleResult, seqResult, resultView, setResultView,
    activeAthlete, derivedProfile, selectedElement, editingBlock,
  } = props;
  const { scheme } = useZoneScheme();
  // Paper is white whatever the screen theme, so print takes the light-theme zone colours.
  const printStyle = (pCode) => resolveZoneStyle(pCode, scheme, 'light');
  const result = seqResult || pSingleResult;   // a Set Builder selection wins over the typed set
  const View = VIEWS[resultView] || ZonesView;

  return (
    <div>
      <StatusNotes activeAthlete={activeAthlete} derivedProfile={derivedProfile} inputs={inputs}
        selectedElement={selectedElement} seqResult={seqResult} editingBlock={editingBlock} />

      <InputsPanel inputs={inputs} set={set} activeAthlete={activeAthlete}
        selectedZone={selectedZone} setSelectedZone={setSelectedZone} setClassifierDrill={setClassifierDrill}
        paused={!!(selectedElement && seqResult && !editingBlock)} />

      <SuggestionPanel inputs={inputs} set={set} selectedZone={selectedZone} activeAthlete={activeAthlete}
        classifierDrill={classifierDrill} setClassifierDrill={setClassifierDrill} />

      <AddToSetButton {...props} result={result} />

      <ZoneCheckBanners selectedZone={selectedZone} singleResult={result} inputs={inputs} activeAthlete={activeAthlete} />

      {result ? (
        <div style={{ animation: 'fadeIn 0.35s ease' }}>
          <ResultWarnings singleResult={result} inputs={inputs} />
          <KeyMetrics result={result} />
          <ViewTabs value={resultView} onChange={setResultView} />
          <View result={result} />
          <CoachNote result={result} />
          <div style={{ textAlign: 'center', marginTop: 8, marginBottom: 24 }}>
            <button onClick={() => printReport(result, inputs, activeAthlete, printStyle)} style={{ ...ui.button, padding: '10px 28px', fontSize: 12 }}>
              ⎙ PRINT REPORT
            </button>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '36px 0', color: T.text4, fontSize: 11, letterSpacing: '0.1em' }}>
          ENTER SET PARAMETERS TO CLASSIFY
        </div>
      )}
    </div>
  );
}
