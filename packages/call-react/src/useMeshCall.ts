import { fetchIceConfig, MeshCall, type RemotePeer, type RoomSecret, type SignalingStatus } from "@open2talk/core";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseMeshCallOptions {
  host: string;
  secret: RoomSecret;
  displayName: string;
  /** Desktop hook (e.g. show a source picker first). Resolve `false` to cancel. */
  beforeScreenShare?: () => Promise<boolean>;
}

async function getCameraAndMic(): Promise<{ stream: MediaStream | null; warning: string | null }> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return { stream: null, warning: "Camera and microphone need https (or localhost)." };
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  try {
    return { stream: await md.getUserMedia({ audio, video }), warning: null };
  } catch {
    try {
      return { stream: await md.getUserMedia({ audio }), warning: "Camera unavailable — joined with audio only." };
    } catch {
      return { stream: null, warning: "Camera and microphone are blocked — you can still watch and listen." };
    }
  }
}

async function getScreen(): Promise<MediaStream> {
  // `systemAudio`/`suppressLocalAudioPlayback` are Chromium hints for capturing tab/system audio.
  const options = {
    video: { frameRate: { ideal: 30 } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
  } as DisplayMediaStreamOptions;
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  // Some platforms hand back a system-audio track that is already dead (e.g. missing OS permission).
  stream.getAudioTracks().filter((t) => t.readyState === "ended").forEach((t) => stream.removeTrack(t));
  stream.getVideoTracks().forEach((t) => ("contentHint" in t ? (t.contentHint = "detail") : undefined));
  stream.getAudioTracks().forEach((t) => ("contentHint" in t ? (t.contentHint = "music") : undefined));
  return stream;
}

export function useMeshCall({ host, secret, displayName, beforeScreenShare }: UseMeshCallOptions) {
  const callRef = useRef<MeshCall | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [status, setStatus] = useState<SignalingStatus>("connecting");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [mediaPending, setMediaPending] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let call: MeshCall | null = null;
    (async () => {
      const [ice, media] = await Promise.all([fetchIceConfig(host), getCameraAndMic()]);
      if (cancelled) {
        media.stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      call = new MeshCall({ host, secret, displayName, ice });
      callRef.current = call;
      call.on("peers", setPeers);
      call.on("status", setStatus);
      call.on("fatal", (f) => setFatal(f.code === "room-full" ? "This call is full." : f.message));
      call.on("screen-ended", () => setScreenStream(null));
      setMediaPending(false);
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

  const toggleScreen = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    if (call.isScreenSharing) {
      call.stopScreenShare();
      setScreenStream(null);
      return;
    }
    try {
      if (beforeScreenShare && !(await beforeScreenShare())) return;
      const stream = await getScreen();
      call.startScreenShare(stream);
      setScreenStream(stream);
      if (!stream.getAudioTracks().length) {
        setWarning(
          "Screen shared without audio. On the web, share a browser tab with “Share audio” on; on macOS, allow open2talk to capture system audio in System Settings → Privacy & Security.",
        );
      }
    } catch (e) {
      if (e instanceof Error && e.name !== "NotAllowedError" && e.name !== "AbortError") setWarning(e.message);
    }
  }, [beforeScreenShare]);

  const leave = useCallback(() => {
    callRef.current?.leave();
  }, []);

  return {
    peers,
    status,
    localStream,
    screenStream,
    micOn,
    camOn,
    warning,
    mediaPending,
    fatal,
    dismissWarning: () => setWarning(null),
    toggleMic,
    toggleCam,
    toggleScreen,
    leave,
  };
}
