// hooks/useSessionBuilder.js - State management for set builder tab

import { useState, useCallback } from "react";
import {
  generateId,
  createBlock,
  createLine,
  deleteChild,
  updateChild,
  bracketLines,
} from "../lib/sessions/builders.js";

export function useSessionBuilder() {
  const [session, setSession] = useState({
    title: "",
    groups: [
      { id: "g1", label: "Warm Up", blocks: [] },
      { id: "g2", label: "Main Set", blocks: [] },
    ],
  });

  const [activeGroup, setActiveGroup] = useState("g1");
  const [editingBlock, setEditingBlock] = useState(null);
  const [editingInnerBlock, setEditingInnerBlock] = useState(null);
  const [lineSelectMode, setLineSelectMode] = useState(null); // blockId or null
  const [selectedLines, setSelectedLines] = useState({}); // {lineId: true}
  const [poolDisplay, setPoolDisplay] = useState("25SC");

  // Add group
  const addGroup = useCallback(() => {
    const id = generateId();
    setSession((s) => ({
      ...s,
      groups: [...s.groups, { id, label: "Set", blocks: [] }],
    }));
    setActiveGroup(id);
  }, []);

  // Update group
  const updateGroup = useCallback((id, key, val) => {
    setSession((s) => ({
      ...s,
      groups: s.groups.map((g) =>
        g.id === id ? { ...g, [key]: val } : g
      ),
    }));
  }, []);

  // Delete group
  const deleteGroup = useCallback((id) => {
    setSession((s) => ({
      ...s,
      groups: s.groups.filter((g) => g.id !== id),
    }));
    setActiveGroup("g1");
  }, []);

  // Commit block to active group
  const commitBlock = useCallback((block) => {
    setSession((s) => ({
      ...s,
      groups: s.groups.map((g) =>
        g.id === activeGroup
          ? { ...g, blocks: [...g.blocks, block] }
          : g
      ),
    }));
    setEditingBlock(null);
  }, [activeGroup]);

  // Replace block
  const replaceBlock = useCallback((block) => {
    setSession((s) => ({
      ...s,
      groups: s.groups.map((g) =>
        g.id === activeGroup
          ? {
              ...g,
              blocks: g.blocks.map((b) =>
                b.id === block.id ? block : b
              ),
            }
          : g
      ),
    }));
    setEditingBlock(null);
  }, [activeGroup]);

  // Delete block
  const deleteBlock = useCallback((groupId, blockId) => {
    setSession((s) => ({
      ...s,
      groups: s.groups.map((g) =>
        g.id === groupId
          ? { ...g, blocks: g.blocks.filter((b) => b.id !== blockId) }
          : g
      ),
    }));
  }, []);

  // Move block up or down
  const moveBlock = useCallback((groupId, blockId, dir) => {
    setSession((s) => ({
      ...s,
      groups: s.groups.map((g) => {
        if (g.id !== groupId) return g;
        const arr = [...g.blocks];
        const i = arr.findIndex((b) => b.id === blockId);
        if (i < 0) return g;
        const j = i + dir;
        if (j < 0 || j >= arr.length) return g;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        return { ...g, blocks: arr };
      }),
    }));
  }, []);

  return {
    session,
    setSession,
    activeGroup,
    setActiveGroup,
    editingBlock,
    setEditingBlock,
    editingInnerBlock,
    setEditingInnerBlock,
    lineSelectMode,
    setLineSelectMode,
    selectedLines,
    setSelectedLines,
    poolDisplay,
    setPoolDisplay,
    addGroup,
    updateGroup,
    deleteGroup,
    commitBlock,
    replaceBlock,
    deleteBlock,
    moveBlock,
  };
}
