import { fetchIceConfig, MeshCall, type RemotePeer, type RoomSecret, type SignalingStatus } from "@open2talk/core";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { mediaDevices } from "react-native-webrtc";
import { eventSource, rtc } from "./setup";

type Stream = MediaStream;

async function getCameraAndMic(facing: "user" | "environment"): Promise<{ stream: Stream | null; warning: string | null }> {
  const video = { facingMode: facing, width: 1280, height: 720, frameRate: 30 };
  try {
    return { stream: (await mediaDevices.getUserMedia({ audio: true, video })) as unknown as Stream, warning: null };
  } catch {
    try {
      return { stream: (await mediaDevices.getUserMedia({ audio: true })) as unknown as Stream, warning: "Camera unavailable — joined with audio only." };
    } catch {
      return { stream: null, warning: "Camera and microphone are blocked — enable them in Settings to talk." };
    }
  }
}

export function useCall({ host, secret, displayName }: { host: string; secret: RoomSecret; displayName: string }) {
  const callRef = useRef<MeshCall | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [status, setStatus] = useState<SignalingStatus>("connecting");
  const [localStream, setLocalStream] = useState<Stream | null>(null);
  const [sharing, setSharing] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [localVersion, setLocalVersion] = useState(0);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [warning, setWarning] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let call: MeshCall | null = null;
    void activateKeepAwakeAsync("call");
    (async () => {
      const [ice, media] = await Promise.all([fetchIceConfig(host), getCameraAndMic("user")]);
      if (cancelled) {
        media.stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      call = new MeshCall({ host, secret, displayName, ice, rtc, eventSource });
      callRef.current = call;
      call.on("peers", setPeers);
      call.on("status", setStatus);
      call.on("fatal", (f) => setFatal(f.code === "room-full" ? "This call is full." : f.message));
      call.on("screen-ended", () => setSharing(false));
      setLocalStream(media.stream);
      setWarning(media.warning);
      setMicOn(!!media.stream?.getAudioTracks().length);
      setCamOn(!!media.stream?.getVideoTracks().length);
      call.join(media.stream);
    })().catch((e) => setFatal(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      call?.leave();
      callRef.current = null;
      deactivateKeepAwake("call");
    };
  }, [host, secret, displayName]);

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      callRef.current?.setMicEnabled(!on);
      return !on;
    });
  }, []);

  const toggleCam = useCallback(() => {
    setCamOn((on) => {
      callRef.current?.setCameraEnabled(!on);
      return !on;
    });
  }, []);

  const flipCamera = useCallback(async () => {
    const next = facing === "user" ? "environment" : "user";
    try {
      const s = (await mediaDevices.getUserMedia({ video: { facingMode: next } })) as unknown as Stream;
      const track = s.getVideoTracks()[0];
      if (!track || !callRef.current) return;
      localStream?.getVideoTracks()[0]?.stop();
      await callRef.current.replaceCameraTrack(track);
      setFacing(next);
      // The stream object is unchanged but its video track is new; bump a key so RTCView remounts.
      setLocalVersion((v) => v + 1);
    } catch (e) {
      setWarning(e instanceof Error ? e.message : "Could not switch camera");
    }
  }, [facing, localStream]);

  const toggleScreen = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    if (call.isScreenSharing) {
      call.stopScreenShare();
      setSharing(false);
      return;
    }
    try {
      const stream = (await mediaDevices.getDisplayMedia({})) as unknown as Stream;
      call.startScreenShare(stream);
      setSharing(true);
      if (!stream.getAudioTracks().length) {
        setWarning(
          Platform.OS === "ios"
            ? "Screen sharing on iOS needs the open2talk broadcast extension (see README)."
            : "Sharing your screen without device audio.",
        );
      }
    } catch (e) {
      const name = e instanceof Error ? e.message : String(e);
      if (!/NotAllowed|AbortError/.test(name)) setWarning(name);
    }
  }, []);

  const leave = useCallback(() => callRef.current?.leave(), []);

  return {
    peers,
    status,
    localStream,
    localVersion,
    sharing,
    micOn,
    camOn,
    facing,
    warning,
    fatal,
    dismissWarning: () => setWarning(null),
    toggleMic,
    toggleCam,
    flipCamera,
    toggleScreen,
    leave,
  };
}
