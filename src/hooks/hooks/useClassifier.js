// hooks/useClassifier.js - State management for classifier tab

import { useState, useMemo } from "react";
import { parseTime } from "../zones/index.js";
import { suggestAllZones } from "../lib/zones/suggestions.js";

export function useClassifier() {
  const [inputs, setInputs] = useState({
    distM: "100",
    qty: "10",
    targetTime: "1:10",
    onTime: "",
    restSec: "20",
    pace200: "2:12",
    stroke: "FS",
    phvStatus: "post",
    restType: "stationary",
    athleteType: "allround",
  });

  const [selectedZone, setSelectedZone] = useState(null);
  const [classifierDrill, setClassifierDrill] = useState("");
  const [singleResult, setSingleResult] = useState(null);
  const [seqResult, setSeqResult] = useState(null);
  const [resultView, setResultView] = useState("zones");
  const [selectedElement, setSelectedElement] = useState(null);

  // Helper to update a single input
  const updateInput = (key, value) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  // Get zone suggestions
  const suggestions = useMemo(() => {
    if (!inputs.distM || !inputs.stroke || !inputs.pace200) return null;
    const p200s = parseTime(inputs.pace200);
    return suggestAllZones(inputs.distM, inputs.stroke, p200s, null);
  }, [inputs.distM, inputs.stroke, inputs.pace200]);

  return {
    inputs,
    setInputs,
    updateInput,
    selectedZone,
    setSelectedZone,
    classifierDrill,
    setClassifierDrill,
    singleResult,
    setSingleResult,
    seqResult,
    setSeqResult,
    resultView,
    setResultView,
    selectedElement,
    setSelectedElement,
    suggestions,
  };
}
