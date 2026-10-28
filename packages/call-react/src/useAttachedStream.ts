import { useEffect, useState, type RefObject } from "react";

/**
 * Plays `stream` in the video element and reports whether it actually has a picture.
 *
 * A camera can be "on" before any frame arrives (or while a peer's track is stalled); callers show
 * the avatar until the video element has frames, instead of a black rectangle.
 */
export function useAttachedStream(ref: RefObject<HTMLVideoElement | null>, stream: MediaStream | null): boolean {
  const [hasFrames, setHasFrames] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => undefined);
    // The stream object can stay the same while its video track is added or replaced later.
    let track: MediaStreamTrack | undefined;
    const trackEvents = ["mute", "unmute", "ended"] as const;
    const update = () => {
      const next = stream?.getVideoTracks()[0];
      if (next !== track) {
        for (const e of trackEvents) track?.removeEventListener(e, update);
        track = next;
        for (const e of trackEvents) track?.addEventListener(e, update);
      }
      setHasFrames(el.videoWidth > 0 && !!track && !track.muted && track.readyState === "live");
    };
    update();
    const videoEvents = ["loadeddata", "resize", "playing", "emptied"] as const;
    for (const e of videoEvents) el.addEventListener(e, update);
    stream?.addEventListener("addtrack", update);
    stream?.addEventListener("removetrack", update);
    return () => {
      for (const e of videoEvents) el.removeEventListener(e, update);
      for (const e of trackEvents) track?.removeEventListener(e, update);
      stream?.removeEventListener("addtrack", update);
      stream?.removeEventListener("removetrack", update);
    };
  }, [ref, stream]);

  return hasFrames;
}
