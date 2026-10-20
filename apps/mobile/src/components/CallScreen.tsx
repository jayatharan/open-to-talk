import { LOCAL_SPEAKER, roomUrl, type RemotePeer, type RoomSecret } from "@open2talk/core";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Modal, Platform, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { RTCView, ScreenCapturePickerView } from "react-native-webrtc";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSettings } from "@/lib/settings";
import { useCall } from "@/lib/useCall";
import { ScreenQualityPicker } from "./ScreenQualityPicker";
import { colors, ui } from "@/lib/theme";
import { Button } from "./form";

type Icon = SymbolViewProps["name"];
const icons = {
  mic: { ios: "mic.fill", android: "mic" },
  micOff: { ios: "mic.slash.fill", android: "mic_off" },
  cam: { ios: "video.fill", android: "videocam" },
  camOff: { ios: "video.slash.fill", android: "videocam_off" },
  flip: { ios: "arrow.triangle.2.circlepath.camera", android: "cameraswitch" },
  screen: { ios: "rectangle.on.rectangle", android: "screen_share" },
  screenStop: { ios: "rectangle.on.rectangle.slash", android: "stop_screen_share" },
  share: { ios: "square.and.arrow.up", android: "share" },
  leave: { ios: "phone.down.fill", android: "call_end" },
  expand: { ios: "arrow.up.left.and.arrow.down.right", android: "open_in_full" },
  collapse: { ios: "arrow.down.right.and.arrow.up.left", android: "close_fullscreen" },
} satisfies Record<string, Icon>;

function Tile({
  stream,
  name,
  showVideo,
  micOn,
  mirror,
  connecting,
  contain,
  style,
  zOrder,
  onPress,
  fullscreen,
  speaking,
}: {
  stream: MediaStream | null;
  name: string;
  showVideo: boolean;
  micOn?: boolean;
  mirror?: boolean;
  connecting?: boolean;
  contain?: boolean;
  style?: object;
  zOrder?: number;
  /** Tapping a tile toggles it full screen. */
  onPress?: () => void;
  fullscreen?: boolean;
  /** Green border while this person's microphone picks up speech. */
  speaking?: boolean;
}) {
  const url = (stream as unknown as { toURL?: () => string } | null)?.toURL?.();
  const hasVideo = showVideo && !!url && !!stream?.getVideoTracks().length;
  return (
    <Pressable
      style={[styles.tile, fullscreen && styles.tileFullscreen, style]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={fullscreen ? `Exit full screen: ${name}` : `View ${name} full screen`}
    >
      {/* Remote audio plays through the native audio session regardless of RTCView. */}
      {hasVideo ? (
        <RTCView streamURL={url} style={StyleSheet.absoluteFill} objectFit={contain ? "contain" : "cover"} mirror={mirror} zOrder={zOrder} />
      ) : (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase() || "?"}</Text>
        </View>
      )}
      {/* Drawn on top as an inset border so the tile's size never changes. */}
      {speaking && <View style={styles.speaking} pointerEvents="none" />}
      {onPress && (
        <View style={styles.expand} pointerEvents="none">
          <SymbolView name={fullscreen ? icons.collapse : icons.expand} size={14} tintColor="#fff" />
        </View>
      )}
      <View style={styles.label}>
        {micOn === false && <SymbolView name={icons.micOff} size={12} tintColor={colors.danger} />}
        <Text style={styles.labelText} numberOfLines={1}>
          {name}
          {connecting ? " · connecting…" : ""}
        </Text>
      </View>
    </Pressable>
  );
}

/** Which tile is shown full screen: a camera (by peer id, "me" for yourself) or a peer's screen. */
type Focus = { kind: "camera"; id: string } | { kind: "screen"; id: string } | null;

function Control({
  icon,
  onPress,
  onLongPress,
  hint,
  disabled,
  busy,
  off,
  active,
  danger,
  label,
}: {
  icon: Icon;
  onPress: () => void;
  onLongPress?: () => void;
  hint?: string;
  disabled?: boolean;
  /** Shows a spinner instead of the icon (implies disabled). */
  busy?: boolean;
  off?: boolean;
  active?: boolean;
  danger?: boolean;
  label: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || busy}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [
        styles.control,
        off && { backgroundColor: "#3a1f22" },
        active && { backgroundColor: colors.accent },
        danger && { backgroundColor: colors.danger },
        pressed && { opacity: 0.7 },
        (disabled || busy) && { opacity: 0.5 },
      ]}
    >
      {busy ? <ActivityIndicator color={colors.text} /> : <SymbolView name={icon} size={22} tintColor={off ? "#ff8b8f" : colors.text} />}
    </Pressable>
  );
}

export function CallScreen({
  host,
  slug,
  secret,
  displayName,
  onLeave,
}: {
  host: string;
  slug: string;
  secret: RoomSecret;
  displayName: string;
  onLeave: () => void;
}) {
  const { screenQuality, setScreenQuality } = useSettings();
  const call = useCall({ host, secret, displayName, screenQuality });
  const [qualitySheet, setQualitySheet] = useState(false);
  const screenPicker = useRef(null);
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [focus, setFocus] = useState<Focus>(null);
  const toggleFocus = (next: NonNullable<Focus>) =>
    setFocus((f) => (f && f.kind === next.kind && f.id === next.id ? null : next));

  // Android's back button leaves full screen instead of the call.
  useEffect(() => {
    if (!focus) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setFocus(null);
      return true;
    });
    return () => sub.remove();
  }, [focus]);

  if (call.fatal) {
    return (
      <SafeAreaView style={[ui.screen, { padding: 16, justifyContent: "center", gap: 16 }]}>
        <Text style={ui.title}>Can’t join</Text>
        <Text style={ui.error}>{call.fatal}</Text>
        <Button title="Back" primary onPress={onLeave} />
      </SafeAreaView>
    );
  }

  const screenPeer = call.peers.find((p) => p.screen);
  const tiles: { key: string; render: (style: object) => React.ReactNode }[] = [
    {
      key: "me",
      render: (style) => (
        <Tile
          key={`me-${call.localVersion}`}
          stream={call.localStream}
          name={`${displayName} (you)`}
          showVideo={call.camOn}
          micOn={call.micOn}
          mirror={call.facing === "user"}
          style={style}
          zOrder={1}
          speaking={call.speaking.includes(LOCAL_SPEAKER)}
          onPress={() => toggleFocus({ kind: "camera", id: "me" })}
        />
      ),
    },
    ...call.peers.map((p: RemotePeer) => ({
      key: p.id,
      render: (style: object) => (
        <Tile
          key={p.id}
          stream={p.camera}
          name={p.state.name}
          showVideo={p.state.camOn}
          micOn={p.state.micOn}
          connecting={p.connection !== "connected"}
          speaking={call.speaking.includes(p.id)}
          style={style}
          onPress={() => toggleFocus({ kind: "camera", id: p.id })}
        />
      ),
    })),
  ];

  const cols = tiles.length <= 1 ? 1 : landscape ? Math.min(tiles.length, 3) : tiles.length <= 4 ? (tiles.length === 2 ? 1 : 2) : 2;
  const rows = Math.ceil(tiles.length / cols);
  const gridTile = { width: `${100 / cols}%`, height: `${100 / rows}%`, padding: 4 } as const;

  // Full screen: render only the focused stream (one video surface, no controls). Remote
  // audio keeps playing because it doesn't depend on any RTCView being mounted.
  const focusedPeer = focus && focus.id !== "me" ? call.peers.find((p) => p.id === focus.id) : null;
  const focused =
    focus?.kind === "camera" && focus.id === "me"
      ? { stream: call.localStream, name: `${displayName} (you)`, showVideo: call.camOn, micOn: call.micOn, mirror: call.facing === "user" }
      : focus?.kind === "camera" && focusedPeer
        ? { stream: focusedPeer.camera, name: focusedPeer.state.name, showVideo: focusedPeer.state.camOn, micOn: focusedPeer.state.micOn, mirror: false }
        : focus?.kind === "screen" && focusedPeer?.screen
          ? { stream: focusedPeer.screen, name: `${focusedPeer.state.name}'s screen`, showVideo: true, micOn: undefined, mirror: false }
          : null;

  if (focused) {
    return (
      <View style={styles.fullscreen}>
        <StatusBar hidden />
        <Tile
          key={focus?.id === "me" ? `fs-me-${call.localVersion}` : `fs-${focus?.kind}-${focus?.id}`}
          stream={focused.stream}
          name={focused.name}
          showVideo={focused.showVideo}
          micOn={focused.micOn}
          mirror={focused.mirror}
          contain
          fullscreen
          onPress={() => setFocus(null)}
        />
      </View>
    );
  }

  return (
    <SafeAreaView style={ui.screen} edges={["top", "bottom", "left", "right"]}>
      {call.status !== "open" && (
        <Text style={styles.banner}>{call.status === "reconnecting" ? "Reconnecting…" : "Connecting…"}</Text>
      )}
      {call.finishingShare && <Text style={styles.banner}>Finishing previous share…</Text>}
      {call.warning && (
        <Pressable onPress={call.dismissWarning}>
          <Text style={[styles.banner, { color: colors.warn, borderColor: colors.warn }]}>{call.warning}</Text>
        </Pressable>
      )}

      {screenPeer ? (
        <View style={{ flex: 1, flexDirection: landscape ? "row" : "column" }}>
          <View style={{ flex: 1, padding: 4 }}>
            <Tile
              stream={screenPeer.screen}
              name={`${screenPeer.state.name}'s screen`}
              showVideo
              contain
              onPress={() => toggleFocus({ kind: "screen", id: screenPeer.id })}
            />
          </View>
          <View style={landscape ? { width: 200 } : { height: 130, flexDirection: "row" }}>
            {tiles.map((t) => (
              <View key={t.key} style={landscape ? { height: 130, padding: 4 } : { width: 130, padding: 4 }}>
                {t.render({ flex: 1 })}
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.grid}>
          {tiles.map((t) => (
            <View key={t.key} style={gridTile}>
              {t.render({ flex: 1 })}
            </View>
          ))}
        </View>
      )}

      {call.peers.length === 0 && call.status === "open" && (
        <Text style={[ui.muted, { textAlign: "center", paddingHorizontal: 16 }]}>
          Waiting for others. Share the link, or the room name and password.
        </Text>
      )}

      {Platform.OS === "ios" && (
        <View style={styles.picker} pointerEvents="none">
          <ScreenCapturePickerView ref={screenPicker} />
        </View>
      )}

      <Modal visible={qualitySheet} transparent animationType="fade" onRequestClose={() => setQualitySheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setQualitySheet(false)}>
          <Pressable style={[ui.card, styles.sheet]} onPress={() => undefined}>
            <Text style={ui.title}>Screen share quality</Text>
            <Text style={ui.muted}>{call.sharing ? "Changes your current share right away." : "Used the next time you share."}</Text>
            <ScreenQualityPicker
              value={screenQuality}
              onChange={(q) => {
                void setScreenQuality(q);
                setQualitySheet(false);
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.controls}>
        <Control label={call.micOn ? "Mute" : "Unmute"} icon={call.micOn ? icons.mic : icons.micOff} off={!call.micOn} onPress={call.toggleMic} />
        <Control label={call.camOn ? "Camera off" : "Camera on"} icon={call.camOn ? icons.cam : icons.camOff} off={!call.camOn} onPress={call.toggleCam} />
        <Control label="Switch camera" icon={icons.flip} onPress={() => void call.flipCamera()} />
        <Control
          label={call.sharing ? "Stop sharing" : "Share screen"}
          hint="Long-press to choose the screen share quality"
          icon={call.sharing ? icons.screenStop : icons.screen}
          active={call.sharing}
          busy={call.finishingShare}
          onPress={() => void call.toggleScreen(screenPicker.current)}
          onLongPress={() => setQualitySheet(true)}
        />
        <Control label="Share invite link" icon={icons.share} onPress={() => void Share.share({ message: roomUrl(host, slug, secret.linkKey) })} />
        <Control
          label="Leave call"
          icon={icons.leave}
          danger
          onPress={() => {
            call.leave();
            onLeave();
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Must stay mounted (display: "none" views are never created), just invisible.
  picker: { position: "absolute", width: 1, height: 1, opacity: 0 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", padding: 16 },
  sheet: { gap: 12 },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", padding: 4 },
  fullscreen: { flex: 1, backgroundColor: "#000" },
  speaking: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, borderWidth: 3, borderColor: colors.ok },
  tileFullscreen: { borderRadius: 0, borderWidth: 0, backgroundColor: "#000" },
  expand: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    overflow: "hidden",
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    alignItems: "center",
  },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.text, fontSize: 26, fontWeight: "600" },
  label: {
    position: "absolute",
    left: 8,
    bottom: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
  },
  labelText: {
    color: colors.text,
    fontSize: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
  banner: {
    alignSelf: "center",
    color: colors.text,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginVertical: 6,
    marginHorizontal: 16,
    fontSize: 13,
    textAlign: "center",
    overflow: "hidden",
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  control: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
});
