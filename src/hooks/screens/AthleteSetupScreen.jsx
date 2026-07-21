// screens/AthleteSetupScreen.jsx - Athlete Setup tab as a separate screen component

export function AthleteSetupScreen({
  athleteName,
  setAthleteName,
  seNumber,
  setSeNumber,
  clubName,
  setClubName,
  athleteTimes,
  setAthleteTimes,
  parseLog,
  setParseLog,
  rawPaste,
  setRawPaste,
  showCsv,
  setShowCsv,
  showPrintPreview,
  setShowPrintPreview,
  activeAthlete,
  setActiveAthlete,
  derivedProfile,
  setDerivedProfile,
}) {
  return (
    <div>
      {/* Placeholder - This screen will contain the athlete setup UI */}
      <div style={{ padding: "20px", color: "rgba(255,255,255,0.5)" }}>
        AthleteSetupScreen - Under Construction
        <pre style={{ marginTop: "10px", fontSize: "12px" }}>
          {JSON.stringify(
            {
              athleteName,
              seNumber,
              clubName,
              hasActiveAthlete: !!activeAthlete,
              derivedProfile,
              rawPasteLength: rawPaste ? rawPaste.length : 0,
              athleteTimesCount: athleteTimes ? Object.keys(athleteTimes).length : 0,
            },
            null,
            2
          )}
        </pre>
      </div>
    </div>
  );
}
