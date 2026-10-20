import { createRoom, extractHost, openRoom, parseRoomLink, passwordStrength, roomNameInUse, roomUrl } from "@open2talk/core";
import * as Clipboard from "expo-clipboard";
import { Link, Redirect, router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { Button, Card, ErrorText, Field } from "@/components/form";
import { rememberSecret, useSettings } from "@/lib/settings";
import { colors, ui } from "@/lib/theme";
import type { RoomSecret } from "@open2talk/core";

export default function HomeScreen() {
  const { loaded, host, displayName, setDisplayName, setHost } = useSettings();
  const [room, setRoom] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; secret: RoomSecret } | null>(null);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const strength = passwordStrength(password);

  useEffect(() => {
    if (displayName) setName((n) => n || displayName);
  }, [displayName]);

  if (!loaded) return null;
  if (!host) return <Redirect href="/settings" />;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { slug, ...secret } = await createRoom(room, password);
      if (await roomNameInUse(host, secret.salt)) {
        setError(`A call named “${room.trim()}” is already in progress. Pick another name, or join it with its password.`);
        return;
      }
      await setDisplayName(name.trim());
      setCreated({ slug, secret });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the room");
    } finally {
      setBusy(false);
    }
  }

  function joinLink() {
    const parsed = parseRoomLink(link);
    if (!parsed) {
      setLinkError("That doesn't look like an open2talk call link.");
      return;
    }
    // Expo Router has no fragments, so the key travels as a route param inside the app.
    router.push(`/r/${parsed.slug}${parsed.linkKey ? `?k=${parsed.linkKey}` : ""}`);
  }

  const linkHost = extractHost(link);
  const url = created ? roomUrl(host, created.slug, created.secret.linkKey) : "";

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={12}>
                <Text style={{ color: colors.accent, fontSize: 16 }}>Settings</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <ScrollView contentContainerStyle={ui.scroll} keyboardShouldPersistTaps="handled">
        {created ? (
          <Card title="Your call is ready" subtitle="Anyone with this link can join directly, so share it only with people you invite. People without the link can join with the room name and password.">
            <Text selectable style={[ui.input, { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 12 }]}>
              {url}
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Copy" onPress={() => void Clipboard.setStringAsync(url)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Share" onPress={() => void Share.share({ message: url })} />
              </View>
            </View>
            <Button
              title="Join now"
              primary
              onPress={() => {
                rememberSecret(created.slug, created.secret);
                router.push(`/r/${created.slug}`);
                setCreated(null);
                setPassword("");
              }}
            />
          </Card>
        ) : (
          <Card title="Create a call" subtitle="Pick a room name and password. Anyone with the link joins directly; others can join with the room name and password.">
            <Field label="Room name" value={room} onChangeText={setRoom} placeholder="Weekly sync" autoCapitalize="sentences" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 8 characters" textContentType="newPassword" />
            {password ? <Text style={[ui.muted, { color: strength.ok ? (strength.score >= 3 ? colors.ok : colors.warn) : colors.danger }]}>{strength.hint}</Text> : null}
            <Field label="Your name" value={name} onChangeText={setName} placeholder="Alex" autoCapitalize="words" maxLength={40} />
            <ErrorText>{error}</ErrorText>
            <Button title="Create call" primary busy={busy} disabled={!room.trim() || !strength.ok || !name.trim()} onPress={() => void create()} />
          </Card>
        )}

        <Card title="Join with a link" subtitle="Paste the call link you received, or open it directly on this device.">
          <Field label="Call link" value={link} onChangeText={(t) => { setLink(t); setLinkError(null); }} placeholder="https://…/r/…" keyboardType="url" />
          {linkHost && linkHost !== host ? (
            <Text style={ui.muted}>
              This link is for {linkHost}, but you're using {host}.{" "}
              <Text style={{ color: colors.accent }} onPress={() => void setHost(linkHost)}>
                Switch server
              </Text>
            </Text>
          ) : null}
          <ErrorText>{linkError}</ErrorText>
          <Button title="Continue" onPress={joinLink} disabled={!link.trim()} />
        </Card>

        <JoinByNameCard initialName={displayName} onSaveName={setDisplayName} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Join without a link: the room name + password locate the room on their own. */
function JoinByNameCard({ initialName, onSaveName }: { initialName: string; onSaveName: (name: string) => Promise<void> }) {
  const [room, setRoom] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialName) setName((n) => n || initialName);
  }, [initialName]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const { slug, ...secret } = await openRoom(room, password);
      await onSaveName(name.trim());
      rememberSecret(slug, secret);
      router.push(`/r/${slug}`);
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join the room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Join with room name" subtitle="No link? Enter the room name and password to join the call.">
      <Field label="Room name" value={room} onChangeText={setRoom} autoCapitalize="sentences" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" />
      <Field label="Your name" value={name} onChangeText={setName} placeholder="Alex" autoCapitalize="words" maxLength={40} />
      <ErrorText>{error}</ErrorText>
      <Button title="Join" primary busy={busy} disabled={!room.trim() || !password || !name.trim()} onPress={() => void join()} />
    </Card>
  );
}
