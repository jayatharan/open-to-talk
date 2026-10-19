import { fetchIceConfig, MeshCall, type RemotePeer, type RoomSecret, type ScreenQuality, type SignalingStatus } from "@open2talk/core";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { findNodeHandle, NativeModules, Platform } from "react-native";
import { mediaDevices } from "react-native-webrtc";
import { addBroadcastFinishedListener, addBroadcastStartedListener } from "../../modules/broadcast-status";
import { isDeviceAudioAvailable, setDeviceAudioMicMuted, startDeviceAudio, stopDeviceAudio } from "../../modules/screen-audio";
import { eventSource, rtc } from "./setup";

type Stream = MediaStream;

// How long the iOS system broadcast picker may stay open before the pending screen track is dropped.
const BROADCAST_START_TIMEOUT_MS = 60_000;
// How long a re-share waits for the previous broadcast extension to report it finished, and how long
// it then lets ReplayKit settle before opening the picker again.
const BROADCAST_FINISH_TIMEOUT_MS = 4_000;
const BROADCAST_FINISH_SETTLE_MS = 300;

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

export function useCall({
  host,
  secret,
  displayName,
  screenQuality,
}: {
  host: string;
  secret: RoomSecret;
  displayName: string;
  /** Applied to the next share, and live to the current one when it changes. */
  screenQuality: ScreenQuality;
}) {
  const callRef = useRef<MeshCall | null>(null);
  const screenQualityRef = useRef(screenQuality);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [status, setStatus] = useState<SignalingStatus>("connecting");
  const [localStream, setLocalStream] = useState<Stream | null>(null);
  const [sharing, setSharing] = useState(false);
  // iOS: waiting for the previous broadcast to end before the picker can open again.
  const [finishingShare, setFinishingShare] = useState(false);
  const finishingShareRef = useRef(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [localVersion, setLocalVersion] = useState(0);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [warning, setWarning] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  // Peer ids (and LOCAL_SPEAKER for this phone) whose mic currently picks up speech.
  const [speaking, setSpeaking] = useState<string[]>([]);
  const streamRef = useRef<Stream | null>(null);
  const micOnRef = useRef(true);
  // Android device audio is mixed into the mic track, so while it runs the mic is muted in the
  // mixer and the track keeps sending (MeshCall's keepSending).
  const deviceAudioRef = useRef(false);
  // iOS: drops the screen capture that is waiting for the broadcast extension to start.
  const cancelBroadcastRef = useRef<(() => void) | null>(null);
  // iOS: true from the extension's "started" report until its "finished" one. Only ever set when the
  // broadcast-status module is present, so builds without it never wait.
  const broadcastRunningRef = useRef(false);
  const broadcastFinishedWaitersRef = useRef<(() => void)[]>([]);

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
      call.on("speaking", setSpeaking);
      call.on("fatal", (f) => setFatal(f.code === "room-full" ? "This call is full." : f.message));
      call.on("screen-ended", () => {
        endDeviceAudio();
        setSharing(false);
      });
      call.on("screen-error", (e) => {
        endDeviceAudio();
        setSharing(false);
        setWarning(e.code === "screen-limit" ? "Too many screens are already being shared in this call." : e.message);
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
      cancelBroadcastRef.current?.();
      endDeviceAudio();
      call?.leave();
      callRef.current = null;
      deactivateKeepAwake("call");
    };
  }, [host, secret, displayName, endDeviceAudio]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const subscription = addBroadcastFinishedListener(() => {
      broadcastRunningRef.current = false;
      const waiters = broadcastFinishedWaitersRef.current;
      broadcastFinishedWaitersRef.current = [];
      waiters.forEach((w) => w());
    });
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    screenQualityRef.current = screenQuality;
    callRef.current?.setScreenQuality(screenQuality);
  }, [screenQuality]);

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      micOnRef.current = !on;
      if (deviceAudioRef.current) {
        callRef.current?.setMicEnabled(!on, { keepSending: true });
        setDeviceAudioMicMuted(on);
      } else {
        callRef.current?.setMicEnabled(!on);
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
    // Keep sending the mic track (now carrying device audio) even if the user is muted.
    callRef.current?.setMicEnabled(micOnRef.current, { keepSending: true });
  }, []);

  // iOS: getDisplayMedia() resolves at once with a track the broadcast extension feeds, but the user
  // may dismiss the system picker. Resolve with the stream only once the extension reports it
  // started; on timeout, a second tap or unmount, stop it and resolve with null.
  // iOS: an in-app stop closes the socket and the extension only ends once it notices. Opening the
  // picker before then shows the old broadcast still running and no new "started" report comes, so
  // wait (bounded) for the old one to finish first.
  const waitForBroadcastFinished = useCallback(async () => {
    if (!broadcastRunningRef.current) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        broadcastFinishedWaitersRef.current = broadcastFinishedWaitersRef.current.filter((w) => w !== done);
        broadcastRunningRef.current = false;
        resolve();
      }, BROADCAST_FINISH_TIMEOUT_MS);
      broadcastFinishedWaitersRef.current.push(done);
    });
    await new Promise((resolve) => setTimeout(resolve, BROADCAST_FINISH_SETTLE_MS));
  }, []);

  const startBroadcast = useCallback(async (pickerTag: number): Promise<Stream | null> => {
    cancelBroadcastRef.current?.();
    let cancel = () => {};
    const started = new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        subscription?.remove();
        clearTimeout(timer);
        if (cancelBroadcastRef.current === cancel) cancelBroadcastRef.current = null;
        resolve(ok);
      };
      // Subscribe before the picker opens so a quick tap on "Start Broadcast" isn't missed.
      const subscription = addBroadcastStartedListener(() => {
        broadcastRunningRef.current = true;
        finish(true);
      });
      const timer = setTimeout(() => finish(false), BROADCAST_START_TIMEOUT_MS);
      cancel = () => finish(false);
      // Builds without the broadcast-status module can't tell; publish right away as before.
      if (!subscription) finish(true);
    });
    cancelBroadcastRef.current = cancel;
    // The picker opens asynchronously; getDisplayMedia() then starts the socket server the
    // broadcast extension connects to once the user taps "Start Broadcast".
    NativeModules.ScreenCapturePickerViewManager.show(pickerTag);
    let stream: Stream;
    try {
      stream = (await mediaDevices.getDisplayMedia({})) as unknown as Stream;
    } catch (e) {
      cancel();
      throw e;
    }
    if (await started) return stream;
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }, []);

  // On iOS, `picker` is the call screen's hidden <ScreenCapturePickerView>; showing it opens the
  // system broadcast picker for the open2talk ReplayKit extension.
  const toggleScreen = useCallback(async (picker?: Parameters<typeof findNodeHandle>[0]) => {
    const call = callRef.current;
    if (!call || finishingShareRef.current) return;
    if (call.isScreenSharing) {
      endDeviceAudio();
      call.stopScreenShare();
      setSharing(false);
      return;
    }
    try {
      let stream: Stream | null;
      if (Platform.OS === "ios") {
        const tag = picker ? findNodeHandle(picker) : null;
        if (tag == null) return;
        if (broadcastRunningRef.current) {
          finishingShareRef.current = true;
          setFinishingShare(true);
          try {
            await waitForBroadcastFinished();
          } finally {
            finishingShareRef.current = false;
            setFinishingShare(false);
          }
        }
        if (callRef.current !== call || call.isScreenSharing) return;
        stream = await startBroadcast(tag);
        if (!stream) return;
        if (callRef.current !== call || call.isScreenSharing) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
      } else {
        stream = (await mediaDevices.getDisplayMedia({})) as unknown as Stream;
      }
      // The screen is its own participant; Android's device audio still rides on the mic track below,
      // since react-native-webrtc has a single audio device module to mix it into.
      call.startScreenShare(stream, { quality: screenQualityRef.current });
      setSharing(true);
      if (Platform.OS === "android") {
        await shareDeviceAudio(stream);
      } else if (!stream.getAudioTracks().length) {
        setWarning("Sharing your screen without device audio.");
      }
    } catch (e) {
      const name = e instanceof Error ? e.message : String(e);
      if (!/NotAllowed|AbortError/.test(name)) setWarning(name);
    }
  }, [endDeviceAudio, shareDeviceAudio, startBroadcast, waitForBroadcastFinished]);

  const leave = useCallback(() => callRef.current?.leave(), []);

  return {
    peers,
    speaking,
    status,
    localStream,
    localVersion,
    sharing,
    finishingShare,
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
