// screens/SetBuilderScreen.jsx - Set Builder tab as a separate screen component

export function SetBuilderScreen({
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
}) {
  return (
    <div>
      {/* Placeholder - This screen will contain the set builder UI */}
      <div style={{ padding: "20px", color: "rgba(255,255,255,0.5)" }}>
        SetBuilderScreen - Under Construction
        <pre style={{ marginTop: "10px", fontSize: "12px" }}>
          {JSON.stringify(
            {
              sessionTitle: session?.title,
              groupCount: session?.groups?.length || 0,
              activeGroup,
              poolDisplay,
              editingSection: editingBlock ? "block" : editingInnerBlock ? "inner" : "none",
            },
            null,
            2
          )}
        </pre>
      </div>
    </div>
  );
}
