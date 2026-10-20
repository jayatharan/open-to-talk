import { checkHost, normalizeHost } from "@open2talk/core";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text } from "react-native";
import { Button, Card, ErrorText, Field } from "@/components/form";
import { ScreenQualityPicker } from "@/components/ScreenQualityPicker";
import { useSettings } from "@/lib/settings";
import { ui } from "@/lib/theme";

export default function SettingsScreen() {
  const { host, setHost, loaded, screenQuality, setScreenQuality } = useSettings();
  const [value, setValue] = useState(host);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded) setValue(host);
  }, [loaded, host]);

  async function save() {
    const next = normalizeHost(value);
    setBusy(true);
    setError(null);
    const problem = await checkHost(next);
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    await setHost(next);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <KeyboardAvoidingView style={ui.screen}>
      <ScrollView contentContainerStyle={ui.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Card
          title={host ? "Server" : "Welcome to open2talk"}
          subtitle="Enter the address of the open2talk server to use. Anyone can self-host one; it stores nothing."
        >
          <Field
            label="Server host"
            value={value}
            onChangeText={setValue}
            placeholder="https://talk.example.com"
            keyboardType="url"
            autoFocus={!host}
            onSubmitEditing={() => void save()}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Save" primary busy={busy} onPress={() => void save()} disabled={!value.trim()} />
        </Card>
        {host ? (
          <Card
            title="Screen sharing"
            subtitle="Highest resolution sent when you share your screen. Lower uses less data; you can also change it during a call by long-pressing the share button."
          >
            <ScreenQualityPicker value={screenQuality} onChange={(q) => void setScreenQuality(q)} />
          </Card>
        ) : null}
        <Text style={[ui.muted, { textAlign: "center" }]}>
          Your room names and passwords never leave this device.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
