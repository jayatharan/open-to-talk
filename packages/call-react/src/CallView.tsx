import { SCREEN_QUALITIES, screenQualityPreset, type RoomSecret } from "@open2talk/core";
import { useEffect, useRef, useState } from "react";
import {
  CamIcon,
  CamOffIcon,
  ChevronUpIcon,
  CollapseIcon,
  ExpandIcon,
  LeaveIcon,
  LinkIcon,
  MicIcon,
  MicOffIcon,
  ScreenIcon,
  SwitchCameraIcon,
} from "./icons";
import { useMeshCall } from "./useMeshCall";

function VideoTile({
  stream,
  name,
  muted,
  mirrored,
  showVideo,
  micOn,
  connecting,
  speaking,
  kind = "camera",
}: {
  stream: MediaStream | null;
  name: string;
  muted?: boolean;
  mirrored?: boolean;
  showVideo: boolean;
  micOn?: boolean;
  connecting?: boolean;
  /** Highlights the tile while this person's microphone picks up speech. */
  speaking?: boolean;
  kind?: "camera" | "screen";
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  // Clicking always fills the window ("expanded"); real fullscreen is layered on top when the
  // browser grants it, so the feature still works where element fullscreen is unavailable
  // (e.g. iPhone Safari) or a request is never answered.
  const [expanded, setExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // A camera can be "on" before any frame arrives (or while a peer's track is stalled); show the
  // avatar until the video element actually has a picture, instead of a black rectangle.
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
  }, [stream]);

  useEffect(() => {
    let wasFullscreen = false;
    const onChange = () => {
      const fs = document.fullscreenElement === tileRef.current;
      // Leaving fullscreen with the browser's own Esc/gesture also collapses the tile.
      if (wasFullscreen && !fs) setExpanded(false);
      wasFullscreen = fs;
      setIsFullscreen(fs);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!expanded && !isFullscreen) return;
    // Browsers exit fullscreen on Esc themselves; Electron doesn't, so handle both here.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.fullscreenElement === tileRef.current) void document.exitFullscreen().catch(() => undefined);
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, isFullscreen]);

  function toggleFullscreen() {
    const tile = tileRef.current;
    if (!tile) return;
    if (expanded || isFullscreen) {
      if (document.fullscreenElement === tile) void document.exitFullscreen().catch(() => undefined);
      setExpanded(false);
      return;
    }
    setExpanded(true);
    tile.requestFullscreen?.().catch(() => undefined);
  }

  const hasVideo = showVideo && !!stream?.getVideoTracks().length && hasFrames;
  const large = isFullscreen || expanded;
  return (
    <div
      ref={tileRef}
      className={`o2t-tile o2t-tile-${kind}${expanded ? " o2t-tile-expanded" : ""}${speaking ? " o2t-tile-speaking" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={large ? `Exit full screen: ${name}` : `View ${name} full screen`}
      title={large ? "Click or press Esc to exit full screen" : "Click to view full screen"}
      onClick={toggleFullscreen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleFullscreen();
        }
      }}
    >
      {/* The <video> stays mounted even when hidden so remote audio keeps playing. */}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={mirrored ? "o2t-mirror" : undefined}
        style={{ opacity: hasVideo ? 1 : 0 }}
      />
      {!hasVideo && <div className="o2t-avatar">{name.slice(0, 1).toUpperCase() || "?"}</div>}
      <span className="o2t-tile-expand" aria-hidden="true">
        {large ? <CollapseIcon /> : <ExpandIcon />}
      </span>
      <div className="o2t-tile-label">
        {micOn === false && (
          <span className="o2t-badge" title="Muted">
            <MicOffIcon />
          </span>
        )}
        {name}
        {connecting && <span className="o2t-muted"> · connecting…</span>}
      </div>
    </div>
  );
}

export interface CallViewProps {
  host: string;
  secret: RoomSecret;
  displayName: string;
  shareUrl: string;
  onLeave: () => void;
  beforeScreenShare?: () => Promise<boolean>;
  /** Hide the screen-share button on platforms that cannot capture the screen. */
  canShareScreen?: boolean;
}

export function CallView({ host, secret, displayName, shareUrl, onLeave, beforeScreenShare, canShareScreen = true }: CallViewProps) {
  const call = useMeshCall({ host, secret, displayName, beforeScreenShare });
  // Mobile browsers (e.g. iOS Safari) have no getDisplayMedia.
  const screenSupported = canShareScreen && !!navigator.mediaDevices?.getDisplayMedia;
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<"camera" | "quality" | null>(null);
  const cameraMenu = menu === "camera";
  const qualityMenu = menu === "quality";

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest?.(".o2t-menu-anchor")) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const remoteScreens = call.peers.filter((p) => p.screen);
  const stage = call.screenStream
    ? { stream: call.screenStream, name: `Your screen · ${screenQualityPreset(call.screenQuality).label}`, local: true }
    : remoteScreens[0]
      ? { stream: remoteScreens[0].screen, name: `${remoteScreens[0].state.name}'s screen`, local: false }
      : null;

  function leave() {
    call.leave();
    onLeave();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  if (call.fatal) {
    return (
      <div className="o2t-center">
        <div className="o2t-card o2t-form">
          <h2>Can’t join</h2>
          <p className="o2t-error">{call.fatal}</p>
          <button className="o2t-btn o2t-primary" onClick={onLeave}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const tiles = (
    <>
      <VideoTile
        key={`local-${call.localVersion}`}
        stream={call.localStream}
        name={`${displayName} (you)`}
        muted
        mirrored
        showVideo={call.camOn}
        micOn={call.micOn}
        speaking={call.localSpeaking}
      />
      {call.peers.map((p) => (
        <VideoTile
          key={p.id}
          stream={p.camera}
          name={p.state.name}
          showVideo={p.state.camOn}
          micOn={p.state.micOn}
          connecting={p.connection !== "connected"}
          speaking={call.isSpeaking(p.id)}
        />
      ))}
      {/* Extra remote screen shares (beyond the one on stage) still need to be heard. */}
      {remoteScreens.slice(stage && !stage.local ? 1 : 0).map((p) => (
        <VideoTile key={`${p.id}-screen`} stream={p.screen} name={`${p.state.name}'s screen`} showVideo kind="screen" />
      ))}
    </>
  );

  return (
    <div className="o2t-call">
      {call.mediaPending ? (
        <div className="o2t-banner">Allow camera and microphone access to join…</div>
      ) : (
        call.status !== "open" && (
          <div className="o2t-banner">{call.status === "reconnecting" ? "Reconnecting…" : "Connecting…"}</div>
        )
      )}
      {call.warning && (
        <div className="o2t-banner o2t-banner-warn" onClick={call.dismissWarning}>
          {call.warning}
        </div>
      )}

      {stage ? (
        <div className="o2t-stage-layout">
          <div className="o2t-stage">
            <VideoTile stream={stage.stream} name={stage.name} muted={stage.local} showVideo kind="screen" />
          </div>
          <div className="o2t-strip">{tiles}</div>
        </div>
      ) : (
        <div className="o2t-grid" data-count={call.peers.length + 1}>
          {tiles}
        </div>
      )}

      {call.peers.length === 0 && call.status === "open" && (
        <div className="o2t-waiting">Waiting for others to join. Share the link, or the room name and password.</div>
      )}

      <div className="o2t-controls">
        <button className="o2t-round" data-off={!call.micOn} onClick={call.toggleMic} title={call.micOn ? "Mute" : "Unmute"} disabled={!call.localStream?.getAudioTracks().length}>
          {call.micOn ? <MicIcon /> : <MicOffIcon />}
        </button>
        <button className="o2t-round" data-off={!call.camOn} onClick={call.toggleCam} title={call.camOn ? "Turn camera off" : "Turn camera on"} disabled={!call.localStream?.getVideoTracks().length}>
          {call.camOn ? <CamIcon /> : <CamOffIcon />}
        </button>
        {call.cameras.length > 1 && (
          <div className="o2t-menu-anchor">
            <button
              className="o2t-round"
              onClick={() => (call.cameras.length === 2 ? void call.switchCamera() : setMenu((m) => (m === "camera" ? null : "camera")))}
              title="Switch camera"
              aria-haspopup={call.cameras.length > 2 ? "menu" : undefined}
              aria-expanded={call.cameras.length > 2 ? cameraMenu : undefined}
            >
              <SwitchCameraIcon />
            </button>
            {cameraMenu && (
              <div className="o2t-menu" role="menu">
                {call.cameras.map((c, i) => (
                  <button
                    key={c.deviceId}
                    role="menuitemradio"
                    aria-checked={c.deviceId === call.cameraId}
                    className="o2t-menu-item"
                    onClick={() => {
                      setMenu(null);
                      void call.switchCamera(c.deviceId);
                    }}
                  >
                    {c.label || `Camera ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {screenSupported && (
          <div className="o2t-menu-anchor">
            <button className="o2t-round" data-active={!!call.screenStream} onClick={() => void call.toggleScreen()} title={call.screenStream ? "Stop sharing" : "Share screen"}>
              <ScreenIcon />
            </button>
            <button
              className="o2t-round-badge"
              onClick={() => setMenu((m) => (m === "quality" ? null : "quality"))}
              title={`Screen share quality: ${screenQualityPreset(call.screenQuality).label}`}
              aria-label="Screen share quality"
              aria-haspopup="menu"
              aria-expanded={qualityMenu}
            >
              <ChevronUpIcon />
            </button>
            {qualityMenu && (
              <div className="o2t-menu" role="menu" aria-label="Screen share quality">
                <div className="o2t-menu-label">{call.screenStream ? "Quality (changes live)" : "Screen share quality"}</div>
                {SCREEN_QUALITIES.map((q) => (
                  <button
                    key={q.id}
                    role="menuitemradio"
                    aria-checked={q.id === call.screenQuality}
                    className="o2t-menu-item"
                    onClick={() => {
                      setMenu(null);
                      call.setScreenQuality(q.id);
                    }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button className="o2t-round" onClick={copyLink} title="Copy invite link">
          <LinkIcon />
          {copied && <span className="o2t-tooltip">Copied</span>}
        </button>
        <button className="o2t-round o2t-danger" onClick={leave} title="Leave call">
          <LeaveIcon />
        </button>
      </div>
    </div>
  );
}
