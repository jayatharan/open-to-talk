import { StyleSheet } from "react-native";

// Mirrors the web/desktop tokens in packages/call-react/src/styles.css.
export const colors = {
  bg: "#0d0f12",
  surface: "#161a20",
  surface2: "#1e232b",
  border: "#2a313b",
  text: "#e8ebef",
  muted: "#8b95a3",
  accent: "#4f8cff",
  danger: "#e5484d",
  warn: "#f5a524",
  ok: "#46a758",
};

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 16 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 20,
    gap: 14,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
  },
  error: { color: colors.danger, fontSize: 14 },
  button: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
