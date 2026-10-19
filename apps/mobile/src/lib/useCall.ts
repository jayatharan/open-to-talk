import { fetchIceConfig, MeshCall, type RemotePeer, type RoomSecret, type SignalingStatus } from "@open2talk/core";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { mediaDevices } from "react-native-webrtc";
import { isDeviceAudioAvailable, setDeviceAudioMicMuted, startDeviceAudio, stopDeviceAudio } from "../../modules/screen-audio";
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
  const streamRef = useRef<Stream | null>(null);
  const micOnRef = useRef(true);
  // Android device audio is mixed into the mic track, so while it runs the mic is muted in the
  // mixer and the track stays enabled.
  const deviceAudioRef = useRef(false);

  const endDeviceAudio = useCallback(() => {
    if (!deviceAudioRef.current) return;
    deviceAudioRef.current = false;
    stopDeviceAudio();
    callRef.current?.setMicEnabled(micOnRef.current);
  }, []);

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
      call.on("screen-ended", () => {
        endDeviceAudio();
        setSharing(false);
      });
      streamRef.current = media.stream;
      micOnRef.current = !!media.stream?.getAudioTracks().length;
      setLocalStream(media.stream);
      setWarning(media.warning);
      setMicOn(!!media.stream?.getAudioTracks().length);
      setCamOn(!!media.stream?.getVideoTracks().length);
      call.join(media.stream);
    })().catch((e) => setFatal(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      endDeviceAudio();
      call?.leave();
      callRef.current = null;
      deactivateKeepAwake("call");
    };
  }, [host, secret, displayName, endDeviceAudio]);

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      callRef.current?.setMicEnabled(!on);
      micOnRef.current = !on;
      if (deviceAudioRef.current) {
        setDeviceAudioMicMuted(on);
        streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = true));
      }
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

  // getDisplayMedia on Android returns video only; the screen-audio module captures other apps'
  // media/game playback through the same MediaProjection and mixes it into the mic track.
  const shareDeviceAudio = useCallback(async (screen: Stream) => {
    const screenTrack = screen.getVideoTracks()[0];
    const micTrack = streamRef.current?.getAudioTracks()[0];
    if (!screenTrack || !micTrack || !isDeviceAudioAvailable()) {
      setWarning(
        micTrack
          ? "Sharing your screen without device audio (needs Android 10 or newer)."
          : "Sharing your screen without device audio (it is sent over the microphone, which is unavailable).",
      );
      return;
    }
    try {
      await startDeviceAudio(screenTrack.id);
    } catch (e) {
      setWarning(`Sharing your screen without device audio: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!callRef.current?.isScreenSharing) {
      stopDeviceAudio();
      return;
    }
    deviceAudioRef.current = true;
    setDeviceAudioMicMuted(!micOnRef.current);
    micTrack.enabled = true;
  }, []);

  const toggleScreen = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    if (call.isScreenSharing) {
      endDeviceAudio();
      call.stopScreenShare();
      setSharing(false);
      return;
    }
    try {
      const stream = (await mediaDevices.getDisplayMedia({})) as unknown as Stream;
      call.startScreenShare(stream);
      setSharing(true);
      if (Platform.OS === "android") {
        await shareDeviceAudio(stream);
      } else if (!stream.getAudioTracks().length) {
        setWarning("Screen sharing on iOS needs the open2talk broadcast extension (see README).");
      }
    } catch (e) {
      const name = e instanceof Error ? e.message : String(e);
      if (!/NotAllowed|AbortError/.test(name)) setWarning(name);
    }
  }, [endDeviceAudio, shareDeviceAudio]);

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
