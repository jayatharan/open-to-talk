import { joinFromLink, parseSlug, unlockRoom, type RoomSecret } from "@open2talk/core";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CallScreen } from "@/components/CallScreen";
import { Button, Card, ErrorText, Field } from "@/components/form";
import { takeSecret, useSettings } from "@/lib/settings";
import { ui } from "@/lib/theme";

export default function RoomScreen() {
  const { slug, k } = useLocalSearchParams<{ slug: string; k?: string }>();
  const { loaded, host, displayName, setDisplayName } = useSettings();
  const [session, setSession] = useState<{ secret: RoomSecret; name: string } | null>(null);
  const [room, setRoom] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the user opened a direct link: the key came with it, so only a display name is needed.
  const [invite, setInvite] = useState<RoomSecret | null>(null);

  useEffect(() => {
    const secret = slug ? takeSecret(slug) : undefined;
    if (secret) setSession({ secret, name: displayName || "Host" });
  }, [slug, displayName]);

  useEffect(() => {
    if (slug && k) void joinFromLink(slug, k).then(setInvite);
  }, [slug, k]);

  useEffect(() => {
    if (displayName) setName((n) => n || displayName);
  }, [displayName]);

  if (!loaded) return null;
  if (!host) return <Redirect href="/settings" />;

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  if (!slug || !parseSlug(slug)) {
    return (
      <SafeAreaView style={[ui.screen, { padding: 16 }]}>
        <Card title="Invalid link" subtitle="This call link is malformed. Ask for a new one.">
          <Button title="Back" primary onPress={leave} />
        </Card>
      </SafeAreaView>
    );
  }

  if (session) {
    return <CallScreen host={host} slug={slug} secret={session.secret} displayName={session.name} onLeave={leave} />;
  }

  async function joinDirect() {
    await setDisplayName(name.trim());
    setSession({ secret: invite!, name: name.trim() });
  }

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const secret = await unlockRoom(slug!, room, password);
      if (!secret) {
        setError("Wrong room name or password.");
        return;
      }
      await setDisplayName(name.trim());
      setSession({ secret, name: name.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlock the room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={ui.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={ui.scroll} keyboardShouldPersistTaps="handled">
          {invite ? (
            <Card title="Join call" subtitle="You were invited with a direct link. Choose the name others will see.">
              <Field label="Your name" value={name} onChangeText={setName} placeholder="Alex" autoFocus autoCapitalize="words" maxLength={40} />
              <Button title="Join" primary disabled={!name.trim()} onPress={() => void joinDirect()} />
              <Button title="Cancel" onPress={leave} />
            </Card>
          ) : (
            <Card title="Join call" subtitle="Enter the room name and password you were given.">
              <Field label="Room name" value={room} onChangeText={setRoom} autoFocus autoCapitalize="sentences" />
              <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" />
              <Field label="Your name" value={name} onChangeText={setName} placeholder="Alex" autoCapitalize="words" maxLength={40} />
              <ErrorText>{error}</ErrorText>
              <Button title="Join" primary busy={busy} disabled={!room || !password || !name.trim()} onPress={() => void join()} />
              <Button title="Cancel" onPress={leave} />
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
