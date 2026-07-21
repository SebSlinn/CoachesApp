// styles/theme.js - Shared style constants and utilities

export const colors = {
  dark: "#1a1a2e",
  darkGray: "#0d0d1a",
  text: "#fff",
  textSecondary: "rgba(255,255,255,0.6)",
  textMuted: "rgba(255,255,255,0.3)",
  textFaint: "rgba(255,255,255,0.18)",
  border: "rgba(255,255,255,0.08)",
  borderLight: "rgba(255,255,255,0.1)",
  borderMedium: "rgba(255,255,255,0.15)",
  bgOverlay: "rgba(255,255,255,0.025)",
  bgHover: "rgba(255,255,255,0.04)",
  bgLight: "rgba(255,255,255,0.02)",
};

export const zones = {
  HVO: "#FF2D55",
  LT: "#FF5500",
  LP: "#FF9500",
  AT: "#FFCC00",
  CS: "#30B0C7",
  A3: "#34C759",
  A2: "#30B0C7",
  A1: "#007AFF",
};

export const styles = {
  // Labels
  label: {
    fontSize: 9,
    color: colors.textMuted,
    letterSpacing: "0.08em",
    marginBottom: 4,
  },

  // Input fields
  input: {
    background: colors.bgOverlay,
    border: `1px solid ${colors.border}`,
    borderRadius: 5,
    color: colors.text,
    padding: "5px 8px",
    fontFamily: "monospace",
    outline: "none",
    fontSize: 13,
  },

  // Button styles
  button: {
    primary: {
      background: colors.bgLight,
      border: `1px solid ${colors.borderLight}`,
      color: colors.text,
      borderRadius: 6,
      padding: "8px 14px",
      fontFamily: "monospace",
      fontSize: 12,
      cursor: "pointer",
      letterSpacing: "0.06em",
    },
    secondary: {
      background: "transparent",
      border: `1px solid ${colors.border}`,
      color: colors.textMuted,
      borderRadius: 4,
      padding: "4px 8px",
      fontFamily: "monospace",
      fontSize: 11,
      cursor: "pointer",
    },
  },

  // Cards
  card: {
    background: colors.bgLight,
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    padding: "10px 14px",
  },

  // Sections
  section: {
    background: colors.bgOverlay,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: "10px 14px",
    marginBottom: 12,
  },

  // Headers
  heading: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: colors.text,
  },

  // Divider
  divider: {
    borderTop: `1px solid ${colors.border}`,
  },
};

// Create conditional style helpers
export function getInputStyle(focused = false) {
  return {
    ...styles.input,
    ...(focused && {
      borderColor: colors.borderMedium,
    }),
  };
}

export function getButtonStyle(variant = "primary", active = false) {
  const baseStyle = styles.button[variant] || styles.button.primary;
  return {
    ...baseStyle,
    ...(active && {
      background: colors.bgHover,
      borderColor: colors.borderMedium,
      color: colors.text,
    }),
  };
}
