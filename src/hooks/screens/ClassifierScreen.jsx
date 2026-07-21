// screens/ClassifierScreen.jsx - Classifier tab (placeholder while debugging)

export function ClassifierScreen({
  inputs,
  set,
  updateInput,
  selectedZone,
  setSelectedZone,
  classifierDrill,
  setClassifierDrill,
  singleResult,
  seqResult,
  resultView,
  setResultView,
  suggestions,
  activeAthlete,
  derivedProfile,
  poolDisplay,
  setPoolDisplay,
}) {
  return (
    <div>
      <div style={{ padding: "20px", color: "rgba(255,255,255,0.5)" }}>
        ClassifierScreen (modularized)
        <pre style={{ marginTop: "10px", fontSize: "12px" }}>
          {JSON.stringify(
            {
              inputs,
              suggestionsAvailable: !!suggestions,
              selectedZone,
              classifierDrill,
              singleResult: !!singleResult,
              seqResult: !!seqResult,
              resultView,
              activeAthlete: activeAthlete ? activeAthlete.name : null,
              derivedProfile,
              poolDisplay,
            },
            null,
            2
          )}
        </pre>
      </div>
    </div>
  );
}
