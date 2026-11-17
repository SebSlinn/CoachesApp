// screens/classifier/StatusNotes.jsx
// Neutral notes above the inputs: the loaded athlete, and whether a Set Builder selection is being shown.
import { ATHLETE_TYPE_OPTS, secToDisplay } from '../../zones/index.js';
import { T } from '../../styles/theme.js';
import { ui } from '../../styles/ui.js';

const PHV_LABEL = { pre: 'Pre-PHV', developing: 'Early Post-PHV', post: 'Post-PHV' };

export default function StatusNotes({ activeAthlete, derivedProfile, inputs, selectedElement, seqResult, editingBlock }) {
  const mShowingSelection = selectedElement && seqResult;
  return (
    <>
      {activeAthlete && (
        <div style={{ ...ui.banner('note'), padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, color: T.text, letterSpacing: '0.06em' }}>
            {activeAthlete.name || 'ACTIVE ATHLETE'} {activeAthlete.seNumber ? '(' + activeAthlete.seNumber + ')' : ''} • {Object.keys(activeAthlete.times || {}).length} events
          </span>
          <span style={{ fontSize: 9, color: T.text3, textAlign: 'right' }}>
            {ATHLETE_TYPE_OPTS.find(o => o.v === inputs.athleteType)?.l || 'All-Round'} • {PHV_LABEL[inputs.phvStatus]}
            {derivedProfile?.aiPct ? ' • ' + derivedProfile.aiPct + '% drop/doubling' : ''}
            {derivedProfile?.css ? ' • CSS ' + secToDisplay(derivedProfile.css) + '/100m' : ''}
          </span>
        </div>
      )}
      {mShowingSelection && !editingBlock && (
        <div style={{ ...ui.banner('note'), padding: '8px 12px', fontSize: 10 }}>
          Showing Set Builder {selectedElement.type} analysis — numeric inputs are paused.
          <span style={{ color: T.text3 }}> Open a block to edit to re-activate inputs.</span>
        </div>
      )}
      {mShowingSelection && editingBlock && (
        <div style={{ ...ui.banner('note'), padding: '8px 12px', fontSize: 10 }}>
          Editing block — classifier active. Use Add To Set to append lines to the open block.
        </div>
      )}
    </>
  );
}
