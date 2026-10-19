import { SCREEN_QUALITIES, type ScreenQuality } from "@open2talk/core";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/lib/theme";

/** Row of screen-share quality presets (used in Settings and in the call). */
export function ScreenQualityPicker({ value, onChange }: { value: ScreenQuality; onChange: (q: ScreenQuality) => void }) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {SCREEN_QUALITIES.map((q) => {
        const selected = q.id === value;
        return (
          <Pressable
            key={q.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(q.id)}
            style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && { opacity: 0.8 }]}
          >
            <Text style={[styles.text, selected && { color: "#fff" }]}>{q.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { color: colors.text, fontSize: 14, fontWeight: "500" },
});
