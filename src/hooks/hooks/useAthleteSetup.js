// hooks/useAthleteSetup.js - State management for athlete setup tab

import { useState } from "react";

export function useAthleteSetup() {
  const [rawPaste, setRawPaste] = useState("");
  const [showCsv, setShowCsv] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [athleteName, setAthleteName] = useState("");
  const [seNumber, setSeNumber] = useState("");
  const [clubName, setClubName] = useState("");
  const [athleteTimes, setAthleteTimes] = useState({});
  const [parseLog, setParseLog] = useState([]);
  const [activeAthlete, setActiveAthlete] = useState(null);
  const [derivedProfile, setDerivedProfile] = useState(null);

  return {
    rawPaste,
    setRawPaste,
    showCsv,
    setShowCsv,
    showPrintPreview,
    setShowPrintPreview,
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
    activeAthlete,
    setActiveAthlete,
    derivedProfile,
    setDerivedProfile,
  };
}
