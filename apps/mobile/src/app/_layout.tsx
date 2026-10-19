import "@/lib/setup";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SettingsProvider } from "@/lib/settings";
import { colors } from "@/lib/theme";

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, primary: colors.accent, border: colors.border },
};

export default function RootLayout() {
  return (
    <SettingsProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="index" options={{ title: "open2talk" }} />
          <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
          <Stack.Screen name="r/[slug]" options={{ title: "Call", headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </SettingsProvider>
  );
}
