import { createRoom, extractHost, extractSlug, passwordStrength, roomUrl } from "@open2talk/core";
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
      await setDisplayName(name.trim());
      setCreated({ slug, secret });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the room");
    } finally {
      setBusy(false);
    }
  }

  function joinLink() {
    const slug = extractSlug(link);
    if (!slug) {
      setLinkError("That doesn't look like an open2talk call link.");
      return;
    }
    router.push(`/r/${slug}`);
  }

  const linkHost = extractHost(link);
  const url = created ? roomUrl(host, created.slug) : "";

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
          <Card title="Your call is ready" subtitle="Send the link along with the room name and password (ideally through a different channel).">
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
          <Card title="Create a call" subtitle="Pick a room name and password. People join only if they know both.">
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
