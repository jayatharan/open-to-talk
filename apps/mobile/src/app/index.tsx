import { createRoom, extractHost, openRoom, parseRoomLink, passwordStrength, roomNameInUse, roomUrl } from "@open2talk/core";
import * as Clipboard from "expo-clipboard";
import { Link, Redirect, router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Button, Card, ErrorText, Field, Tabs } from "@/components/form";
import { rememberSecret, useSettings } from "@/lib/settings";
import { colors, motion, ui } from "@/lib/theme";
import type { RoomSecret } from "@open2talk/core";

const TABS = [
  { id: "create", label: "New call" },
  { id: "join", label: "Join" },
] as const;

export default function HomeScreen() {
  const { loaded, host, displayName, setDisplayName, setHost } = useSettings();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("create");
  const [room, setRoom] = useState("");
  const [password, setPassword] = useState("");
  const [link, setLink] = useState("");
  const [name, setName] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; secret: RoomSecret } | null>(null);
  const strength = passwordStrength(password);
  const usingLink = tab === "join" && link.trim().length > 0;

  useEffect(() => {
    if (displayName) setName((n) => n || displayName);
  }, [displayName]);

  if (!loaded) return null;
  if (!host) return <Redirect href="/settings" />;

  function selectTab(id: typeof tab) {
    setTab(id);
    setError(null);
  }

  async function submit() {
    setError(null);
    if (usingLink) {
      const parsed = parseRoomLink(link);
      if (!parsed) {
        setError("That doesn't look like an open2talk call link.");
        return;
      }
      if (name.trim()) await setDisplayName(name.trim());
      // Expo Router has no fragments, so the key travels as a route param inside the app.
      router.push(`/r/${parsed.slug}${parsed.linkKey ? `?k=${parsed.linkKey}` : ""}`);
      return;
    }
    setBusy(true);
    try {
      const { slug, ...secret } = await (tab === "create" ? createRoom : openRoom)(room, password);
      if (tab === "create" && (await roomNameInUse(host, secret.salt))) {
        setError(`A call named “${room.trim()}” is already in progress. Pick another name, or join it with its password.`);
        return;
      }
      await setDisplayName(name.trim());
      if (tab === "create") {
        setCreated({ slug, secret });
      } else {
        rememberSecret(slug, secret);
        router.push(`/r/${slug}`);
        setPassword("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const linkHost = extractHost(link);
  const url = created ? roomUrl(host, created.slug, created.secret.linkKey) : "";
  const canSubmit = usingLink || (!!room.trim() && !!password && !!name.trim() && (tab === "join" || strength.ok));

  return (
    <View style={ui.screen}>
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
      <ScrollView
        contentContainerStyle={ui.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // Keeps the focused field above the keyboard on iOS.
        automaticallyAdjustKeyboardInsets
      >
        {created ? (
          <Card
            key="share"
            title="Your call is ready"
            subtitle="Anyone with this link can join directly, so share it only with people you invite. People without the link can join with the room name and password."
          >
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
          <Card key="home">
            <Tabs options={TABS} value={tab} onChange={selectTab} />
            <Animated.View key={tab} entering={FadeIn.duration(motion.ui)} style={{ gap: 14 }}>
              {tab === "create" ? (
                <Text style={ui.muted}>
                  Pick a room name and password. Anyone with the link joins directly; others can join with the name and password.
                </Text>
              ) : (
                <>
                  <Field
                    label="Call link"
                    value={link}
                    onChangeText={(t) => {
                      setLink(t);
                      setError(null);
                    }}
                    placeholder="https://…/r/…"
                    keyboardType="url"
                  />
                  {linkHost && linkHost !== host ? (
                    <Text style={ui.muted}>
                      This link is for {linkHost}, but you’re using {host}.{" "}
                      <Text style={{ color: colors.accent, fontWeight: "600" }} onPress={() => void setHost(linkHost)}>
                        Switch server
                      </Text>
                    </Text>
                  ) : null}
                  <OrDivider />
                </>
              )}
              <Field
                label="Room name"
                value={room}
                onChangeText={setRoom}
                placeholder={tab === "create" ? "Weekly sync" : undefined}
                autoCapitalize="sentences"
                editable={!usingLink}
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder={tab === "create" ? "At least 8 characters" : undefined}
                textContentType={tab === "create" ? "newPassword" : "password"}
                editable={!usingLink}
              />
              {tab === "create" && password ? (
                <Text style={[ui.muted, { color: strength.ok ? (strength.score >= 3 ? colors.ok : colors.warn) : colors.danger }]}>
                  {strength.hint}
                </Text>
              ) : null}
              <Field label="Your name" value={name} onChangeText={setName} placeholder="Alex" autoCapitalize="words" maxLength={40} />
            </Animated.View>
            <ErrorText>{error}</ErrorText>
            <Button
              title={tab === "create" ? "Create call" : "Join call"}
              primary
              busy={busy}
              disabled={!canSubmit}
              onPress={() => void submit()}
            />
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function OrDivider() {
  const line = { flex: 1, height: 1, backgroundColor: colors.border };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={line} />
      <Text style={{ color: colors.muted, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" }}>or room name and password</Text>
      <View style={line} />
    </View>
  );
}
