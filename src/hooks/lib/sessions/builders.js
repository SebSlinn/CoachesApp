// sessions/builders.js - Session and block building utilities

/**
 * Generate unique ID for session elements
 */
export function generateId() {
  return "x" + Date.now() + Math.random().toString(36).slice(2, 6);
}

/**
 * Create a new swim line with defaults
 */
export function createLine(defaults = {}) {
  return {
    id: generateId(),
    qty: "1",
    distM: "",
    stroke: "FS",
    modifier: "Full",
    intensity: "A2",
    targetTime: "",
    onTime: "",
    note: "",
    type: "swim",
    poolType: "25SC",
    ...defaults,
  };
}

/**
 * Create a new block with defaults
 */
export function createBlock(defaults = {}) {
  return {
    id: generateId(),
    repeats: "1",
    label: "",
    children: [],
    ...defaults,
  };
}

/**
 * Calculate volume of a block in meters
 */
export function calculateBlockVolume(block, calculateLineVolume) {
  const reps = parseFloat(block.repeats) || 1;
  const childVolume = (block.children || []).reduce((sum, child) => {
    if (child.children !== undefined) {
      return sum + calculateBlockVolume(child, calculateLineVolume);
    } else if (child.type === "swim") {
      return sum + (calculateLineVolume ? calculateLineVolume(child) : 0);
    }
    return sum;
  }, 0);
  return childVolume * reps;
}

/**
 * Calculate total time of a block
 */
export function calculateBlockTotalTime(block, calculateLineTotalTime) {
  const reps = parseFloat(block.repeats) || 1;
  const childTime = (block.children || []).reduce((sum, child) => {
    if (child.children !== undefined) {
      return sum + calculateBlockTotalTime(child, calculateLineTotalTime);
    } else if (child.type === "swim" || child.type === "rest") {
      return sum + (calculateLineTotalTime ? calculateLineTotalTime(child) : 0);
    }
    return sum;
  }, 0);
  return childTime * reps;
}

/**
 * Calculate volume of a group
 */
export function calculateGroupVolume(group, calculateBlockVolume) {
  return (group.blocks || []).reduce((sum, block) => {
    return sum + (calculateBlockVolume ? calculateBlockVolume(block) : 0);
  }, 0);
}

/**
 * Calculate total time of a group
 */
export function calculateGroupTime(group, calculateBlockTotalTime) {
  return (group.blocks || []).reduce((sum, block) => {
    return sum + (calculateBlockTotalTime ? calculateBlockTotalTime(block) : 0);
  }, 0);
}

/**
 * Format duration in HH:MM:SS format
 */
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Bracket selected lines into a new inner block
 */
export function bracketLines(block, lineIds) {
  const newInner = createBlock({
    repeats: "2",
    children: lineIds
      .map((lid) => block.children.find((c) => c.id === lid))
      .filter(Boolean),
  });

  const remaining = block.children.filter((c) => !lineIds.includes(c.id));

  return {
    ...block,
    children: [...remaining, newInner],
  };
}

/**
 * Delete a child element from a block
 */
export function deleteChild(block, childId) {
  return {
    ...block,
    children: block.children.filter((c) => c.id !== childId),
  };
}

/**
 * Update a child element in a block
 */
export function updateChild(block, childId, updater) {
  return {
    ...block,
    children: block.children.map((c) =>
      c.id === childId
        ? typeof updater === "function"
          ? updater(c)
          : { ...c, ...updater }
        : c
    ),
  };
}

/**
 * Flatten a session into a simple array of swim lines and rests
 */
export function flattenSession(session) {
  const result = [];

  function traverse(block, blockReps = 1) {
    const reps = parseFloat(block.repeats) || 1;
    for (let r = 0; r < reps * blockReps; r++) {
      (block.children || []).forEach((child) => {
        if (child.children !== undefined) {
          traverse(child, reps);
        } else {
          result.push(child);
        }
      });
    }
  }

  (session.groups || []).forEach((group) => {
    (group.blocks || []).forEach((block) => {
      traverse(block, 1);
    });
  });

  return result;
}
