import {
  SCREEN_QUALITIES,
  screenQualityPreset,
  videoPointToNormalized,
  type ControlInput,
  type MouseButton,
  type RemotePeer,
  type RoomSecret,
} from "@open2talk/core";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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
import { RemoteControlPrompt } from "./RemoteControlPrompt";
import { useMeshCall, type RemoteControlHost } from "./useMeshCall";

const MAX_WHEEL = 2000;
const clampWheel = (v: number) => Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, v));

/**
 * While `send` is set, pointer, wheel and keyboard input on the tile goes to the remote screen
 * instead of the page. Anything still held down is released when control ends or focus leaves.
 */
function useControlInput(
  tileRef: RefObject<HTMLDivElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  send: ((e: ControlInput) => void) | undefined,
) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const active = !!send;

  useEffect(() => {
    const tile = tileRef.current;
    const video = videoRef.current;
    if (!active || !tile || !video) return;
    const emit = (e: ControlInput) => sendRef.current?.(e);
    const keys = new Set<string>();
    const buttons = new Set<MouseButton>();
    let frame = 0;
    let move: { x: number; y: number } | null = null;
    let last = { x: 0.5, y: 0.5 };
    let wheel = { dx: 0, dy: 0 };

    const at = (e: MouseEvent, clamp = false) =>
      videoPointToNormalized(e.clientX, e.clientY, video.getBoundingClientRect(), video.videoWidth, video.videoHeight, clamp);
    // The tile's own buttons (e.g. Stop) stay usable.
    const onUi = (e: Event) => !!(e.target as Element | null)?.closest?.(".o2t-tile-overlay");
    const buttonOf = (e: MouseEvent): MouseButton | null => (e.button === 0 || e.button === 1 || e.button === 2 ? e.button : null);

    // Moves and wheel deltas are coalesced to one message per frame.
    const flush = () => {
      frame = 0;
      if (move) emit({ k: "move", ...move });
      if (wheel.dx || wheel.dy) emit({ k: "wheel", dx: clampWheel(wheel.dx), dy: clampWheel(wheel.dy) });
      move = null;
      wheel = { dx: 0, dy: 0 };
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const releaseKey = (code: string) => {
      if (keys.delete(code)) emit({ k: "key", code, down: false });
    };
    const releaseAll = () => {
      for (const code of [...keys]) releaseKey(code);
      for (const b of buttons) emit({ k: "up", b, ...last });
      buttons.clear();
    };

    const onMove = (e: PointerEvent) => {
      if (onUi(e)) return;
      const p = at(e, buttons.size > 0);
      if (!p) return;
      move = last = p;
      schedule();
    };
    const onDown = (e: PointerEvent) => {
      const b = buttonOf(e);
      const p = at(e);
      if (onUi(e) || b === null || !p) return;
      e.preventDefault();
      tile.focus();
      tile.setPointerCapture?.(e.pointerId);
      flush();
      buttons.add(b);
      last = p;
      emit({ k: "down", b, ...p });
    };
    const onUp = (e: PointerEvent) => {
      const b = buttonOf(e);
      if (b === null || !buttons.delete(b)) return;
      const p = at(e, true) ?? last;
      flush();
      emit({ k: "up", b, ...p });
    };
    const onWheel = (e: WheelEvent) => {
      if (onUi(e)) return;
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      wheel = { dx: wheel.dx + e.deltaX * scale, dy: wheel.dy + e.deltaY * scale };
      schedule();
    };
    const onKey = (e: KeyboardEvent) => {
      if (onUi(e) || !e.code) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "keyup") {
        // macOS browsers swallow key-ups while ⌘ is held, so release those keys with ⌘.
        if (e.code.startsWith("Meta")) for (const code of [...keys]) if (code !== e.code) releaseKey(code);
        releaseKey(e.code);
        return;
      }
      keys.add(e.code);
      emit({ k: "key", code: e.code, down: true });
    };
    const noMenu = (e: Event) => {
      if (!onUi(e)) e.preventDefault();
    };

    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerdown", onDown);
    tile.addEventListener("pointerup", onUp);
    tile.addEventListener("pointercancel", releaseAll);
    tile.addEventListener("wheel", onWheel, { passive: false });
    tile.addEventListener("keydown", onKey);
    tile.addEventListener("keyup", onKey);
    tile.addEventListener("contextmenu", noMenu);
    tile.addEventListener("blur", releaseAll);
    tile.focus();
    return () => {
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerdown", onDown);
      tile.removeEventListener("pointerup", onUp);
      tile.removeEventListener("pointercancel", releaseAll);
      tile.removeEventListener("wheel", onWheel);
      tile.removeEventListener("keydown", onKey);
      tile.removeEventListener("keyup", onKey);
      tile.removeEventListener("contextmenu", noMenu);
      tile.removeEventListener("blur", releaseAll);
      if (frame) cancelAnimationFrame(frame);
      releaseAll();
    };
  }, [active, tileRef, videoRef]);
}

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
  onControlInput,
  overlay,
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
  /** Sends input on the tile to the remote screen it shows (while controlling it). */
  onControlInput?: (e: ControlInput) => void;
  /** Buttons over the tile; clicks on them don't toggle full screen or reach the remote screen. */
  overlay?: (tile: { large: boolean; toggleFullscreen: () => void }) => ReactNode;
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
  const controlling = !!onControlInput;
  useControlInput(tileRef, ref, onControlInput);

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
    // While controlling, Esc belongs to the remote screen.
    if ((!expanded && !isFullscreen) || controlling) return;
    // Browsers exit fullscreen on Esc themselves; Electron doesn't, so handle both here.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.fullscreenElement === tileRef.current) void document.exitFullscreen().catch(() => undefined);
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, isFullscreen, controlling]);

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
      className={`o2t-tile o2t-tile-${kind}${expanded ? " o2t-tile-expanded" : ""}${speaking ? " o2t-tile-speaking" : ""}${controlling ? " o2t-tile-control" : ""}`}
      role={controlling ? "application" : "button"}
      tabIndex={0}
      aria-label={controlling ? `Controlling ${name}` : large ? `Exit full screen: ${name}` : `View ${name} full screen`}
      title={controlling ? undefined : large ? "Click or press Esc to exit full screen" : "Click to view full screen"}
      onClick={controlling ? undefined : toggleFullscreen}
      onKeyDown={(e) => {
        if (!controlling && (e.key === "Enter" || e.key === " ")) {
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
      {!controlling && (
        <span className="o2t-tile-expand" aria-hidden="true">
          {large ? <CollapseIcon /> : <ExpandIcon />}
        </span>
      )}
      {overlay && (
        <div className="o2t-tile-overlay" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {overlay({ large, toggleFullscreen })}
        </div>
      )}
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
  /** Lets others control this device's shared screen (desktop only). Anyone can control others. */
  remoteControl?: RemoteControlHost;
  /** Label of the host's shortcut that takes control back, e.g. "⌘⇧Esc". */
  stopControlShortcut?: string;
}

/** Request/stop control of the screen on stage. */
function ControlBar({
  peer,
  status,
  tile,
  onRequest,
  onStop,
}: {
  peer: RemotePeer;
  status: "pending" | "active" | null;
  tile: { large: boolean; toggleFullscreen: () => void };
  onRequest: () => void;
  onStop: () => void;
}) {
  if (status === "active") {
    return (
      <div className="o2t-rc-bar o2t-rc-bar-active">
        <span>Controlling {peer.state.name}’s screen</span>
        <button className="o2t-rc-icon" onClick={tile.toggleFullscreen} title={tile.large ? "Exit full screen" : "Full screen"}>
          {tile.large ? <CollapseIcon /> : <ExpandIcon />}
        </button>
        <button className="o2t-rc-btn o2t-rc-stop" onClick={onStop}>
          Stop
        </button>
      </div>
    );
  }
  if (status === "pending") {
    return (
      <div className="o2t-rc-bar">
        <span>Waiting for {peer.state.name} to allow control…</span>
        <button className="o2t-rc-btn" onClick={onStop}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="o2t-rc-bar o2t-rc-bar-idle">
      <button className="o2t-rc-btn" onClick={onRequest} title={`Ask ${peer.state.name} to let you control their screen`}>
        Request control
      </button>
    </div>
  );
}

export function CallView({
  host,
  secret,
  displayName,
  shareUrl,
  onLeave,
  beforeScreenShare,
  canShareScreen = true,
  remoteControl,
  stopControlShortcut,
}: CallViewProps) {
  const call = useMeshCall({ host, secret, displayName, beforeScreenShare, remoteControl });
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
  const outgoing = call.control.outgoing;
  // The screen being controlled (or asked for) stays on stage.
  const stagePeer = call.screenStream ? undefined : (remoteScreens.find((p) => p.id === outgoing?.peer) ?? remoteScreens[0]);
  const stage = call.screenStream
    ? { stream: call.screenStream, name: `Your screen · ${screenQualityPreset(call.screenQuality).label}`, local: true }
    : stagePeer
      ? { stream: stagePeer.screen, name: `${stagePeer.state.name}'s screen`, local: false }
      : null;
  const stageControl = stagePeer && outgoing?.peer === stagePeer.id ? outgoing.status : null;
  const nameOf = (id: string) => call.peers.find((p) => p.id === id)?.state.name ?? "Someone";
  const controlRequest = call.control.requests[0];

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
      {remoteScreens.filter((p) => p !== stagePeer).map((p) => (
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
      {call.control.controlledBy && (
        <div className="o2t-banner o2t-banner-control" role="status">
          <span>
            {nameOf(call.control.controlledBy)} is controlling your screen
            {stopControlShortcut && <span className="o2t-muted"> · {stopControlShortcut} to stop</span>}
          </span>
          <button className="o2t-rc-btn o2t-rc-stop" onClick={call.revokeControl}>
            Stop
          </button>
        </div>
      )}
      {call.warning && (
        <div className="o2t-banner o2t-banner-warn" onClick={call.dismissWarning}>
          {call.warning}
        </div>
      )}

      {stage ? (
        <div className="o2t-stage-layout">
          <div className="o2t-stage">
            <VideoTile
              stream={stage.stream}
              name={stage.name}
              muted={stage.local}
              showVideo
              kind="screen"
              onControlInput={stageControl === "active" ? call.sendControlInput : undefined}
              overlay={
                stagePeer && (stagePeer.state.rc || stageControl)
                  ? (tile) => (
                      <ControlBar
                        peer={stagePeer}
                        status={stageControl}
                        tile={tile}
                        onRequest={() => call.requestControl(stagePeer.id)}
                        onStop={call.stopControlling}
                      />
                    )
                  : undefined
              }
            />
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

      {controlRequest && (
        <RemoteControlPrompt
          name={nameOf(controlRequest)}
          onAllow={() => void call.allowControl(controlRequest)}
          onDeny={() => call.denyControl(controlRequest)}
        />
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
