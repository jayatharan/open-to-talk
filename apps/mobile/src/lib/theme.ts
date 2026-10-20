import { StyleSheet } from "react-native";
import { Easing } from "react-native-reanimated";

// Mirrors the web/desktop tokens in packages/call-react/src/styles.css.
export const colors = {
  bg: "#050816",
  bg2: "#0b1220",
  surface: "rgba(15,23,42,0.72)",
  surfaceSolid: "#0f172a",
  surface2: "rgba(30,41,59,0.7)",
  field: "rgba(2,6,23,0.6)",
  border: "rgba(148,163,184,0.18)",
  borderStrong: "rgba(148,163,184,0.32)",
  text: "#e2e8f0",
  muted: "#94a3b8",
  accent: "#60a5fa",
  accentText: "#04101f",
  danger: "#f2555a",
  warn: "#f5a524",
  ok: "#4ade80",
};

// One small motion vocabulary, shared by every screen. Reanimated honours the system
// "Reduce Motion" setting for these by default.
export const motion = {
  micro: 140,
  ui: 200,
  pop: 240,
  enter: 420,
  stagger: 60,
  rise: 12,
  easeOut: Easing.bezier(0.22, 1, 0.36, 1),
};

/** Deep navy with two soft glows, the same backdrop as the desktop and web app. */
export const screenBackground = [
  "radial-gradient(circle at 15% 0%, rgba(59,130,246,0.16), transparent 60%)",
  "radial-gradient(circle at 100% 100%, rgba(139,92,246,0.12), transparent 55%)",
  `linear-gradient(180deg, ${colors.bg}, ${colors.bg2})`,
].join(", ");

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, experimental_backgroundImage: screenBackground },
  scroll: { padding: 16, gap: 16 },
  card: {
    backgroundColor: colors.surface,
    experimental_backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015))",
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(148,163,184,0.34)",
    borderRadius: 20,
    padding: 20,
    gap: 14,
    boxShadow: "0 18px 40px rgba(2,6,23,0.5)",
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "600", letterSpacing: -0.2 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  label: { color: colors.muted, fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: {
    backgroundColor: colors.field,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
  },
  inputFocused: {
    borderColor: colors.accent,
    boxShadow: "0 0 0 3px rgba(96,165,250,0.2)",
  },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  button: {
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
    experimental_backgroundImage: "linear-gradient(180deg, #7cb6fc, #60a5fa)",
    borderColor: "transparent",
    boxShadow: "0 8px 20px -8px rgba(96,165,250,0.7)",
  },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  buttonTextPrimary: { color: colors.accentText },
});
