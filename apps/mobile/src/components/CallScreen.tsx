import { roomUrl, type RemotePeer, type RoomSecret } from "@open2talk/core";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCall } from "@/lib/useCall";
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
}) {
  const url = (stream as unknown as { toURL?: () => string } | null)?.toURL?.();
  const hasVideo = showVideo && !!url && !!stream?.getVideoTracks().length;
  return (
    <View style={[styles.tile, style]}>
      {/* Remote audio plays through the native audio session regardless of RTCView. */}
      {hasVideo ? (
        <RTCView streamURL={url} style={StyleSheet.absoluteFill} objectFit={contain ? "contain" : "cover"} mirror={mirror} zOrder={zOrder} />
      ) : (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase() || "?"}</Text>
        </View>
      )}
      <View style={styles.label}>
        {micOn === false && <SymbolView name={icons.micOff} size={12} tintColor={colors.danger} />}
        <Text style={styles.labelText} numberOfLines={1}>
          {name}
          {connecting ? " · connecting…" : ""}
        </Text>
      </View>
    </View>
  );
}

function Control({ icon, onPress, off, active, danger, label }: { icon: Icon; onPress: () => void; off?: boolean; active?: boolean; danger?: boolean; label: string }) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        off && { backgroundColor: "#3a1f22" },
        active && { backgroundColor: colors.accent },
        danger && { backgroundColor: colors.danger },
        pressed && { opacity: 0.7 },
      ]}
    >
      <SymbolView name={icon} size={22} tintColor={off ? "#ff8b8f" : colors.text} />
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
  const call = useCall({ host, secret, displayName });
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

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
          style={style}
        />
      ),
    })),
  ];

  const cols = tiles.length <= 1 ? 1 : landscape ? Math.min(tiles.length, 3) : tiles.length <= 4 ? (tiles.length === 2 ? 1 : 2) : 2;
  const rows = Math.ceil(tiles.length / cols);
  const gridTile = { width: `${100 / cols}%`, height: `${100 / rows}%`, padding: 4 } as const;

  return (
    <SafeAreaView style={ui.screen} edges={["top", "bottom", "left", "right"]}>
      {call.status !== "open" && (
        <Text style={styles.banner}>{call.status === "reconnecting" ? "Reconnecting…" : "Connecting…"}</Text>
      )}
      {call.warning && (
        <Pressable onPress={call.dismissWarning}>
          <Text style={[styles.banner, { color: colors.warn, borderColor: colors.warn }]}>{call.warning}</Text>
        </Pressable>
      )}

      {screenPeer ? (
        <View style={{ flex: 1, flexDirection: landscape ? "row" : "column" }}>
          <View style={{ flex: 1, padding: 4 }}>
            <Tile stream={screenPeer.screen} name={`${screenPeer.state.name}'s screen`} showVideo contain />
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
          Waiting for others. Share the link, room name and password.
        </Text>
      )}

      <View style={styles.controls}>
        <Control label={call.micOn ? "Mute" : "Unmute"} icon={call.micOn ? icons.mic : icons.micOff} off={!call.micOn} onPress={call.toggleMic} />
        <Control label={call.camOn ? "Camera off" : "Camera on"} icon={call.camOn ? icons.cam : icons.camOff} off={!call.camOn} onPress={call.toggleCam} />
        <Control label="Switch camera" icon={icons.flip} onPress={() => void call.flipCamera()} />
        <Control label={call.sharing ? "Stop sharing" : "Share screen"} icon={call.sharing ? icons.screenStop : icons.screen} active={call.sharing} onPress={() => void call.toggleScreen()} />
        <Control label="Share invite link" icon={icons.share} onPress={() => void Share.share({ message: roomUrl(host, slug) })} />
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
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", padding: 4 },
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
