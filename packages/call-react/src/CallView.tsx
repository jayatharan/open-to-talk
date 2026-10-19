import type { RoomSecret } from "@open2talk/core";
import { useEffect, useRef, useState } from "react";
import { CamIcon, CamOffIcon, LeaveIcon, LinkIcon, MicIcon, MicOffIcon, ScreenIcon } from "./icons";
import { useMeshCall } from "./useMeshCall";

function VideoTile({
  stream,
  name,
  muted,
  mirrored,
  showVideo,
  micOn,
  connecting,
  kind = "camera",
}: {
  stream: MediaStream | null;
  name: string;
  muted?: boolean;
  mirrored?: boolean;
  showVideo: boolean;
  micOn?: boolean;
  connecting?: boolean;
  kind?: "camera" | "screen";
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => undefined);
  }, [stream]);

  const hasVideo = showVideo && !!stream?.getVideoTracks().length;
  return (
    <div className={`o2t-tile o2t-tile-${kind}`}>
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

  const remoteScreens = call.peers.filter((p) => p.screen);
  const stage = call.screenStream
    ? { stream: call.screenStream, name: "Your screen", local: true }
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
        stream={call.localStream}
        name={`${displayName} (you)`}
        muted
        mirrored
        showVideo={call.camOn}
        micOn={call.micOn}
      />
      {call.peers.map((p) => (
        <VideoTile
          key={p.id}
          stream={p.camera}
          name={p.state.name}
          showVideo={p.state.camOn}
          micOn={p.state.micOn}
          connecting={p.connection !== "connected"}
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
        <div className="o2t-waiting">Waiting for others to join. Share the link, room name and password.</div>
      )}

      <div className="o2t-controls">
        <button className="o2t-round" data-off={!call.micOn} onClick={call.toggleMic} title={call.micOn ? "Mute" : "Unmute"} disabled={!call.localStream?.getAudioTracks().length}>
          {call.micOn ? <MicIcon /> : <MicOffIcon />}
        </button>
        <button className="o2t-round" data-off={!call.camOn} onClick={call.toggleCam} title={call.camOn ? "Turn camera off" : "Turn camera on"} disabled={!call.localStream?.getVideoTracks().length}>
          {call.camOn ? <CamIcon /> : <CamOffIcon />}
        </button>
        {screenSupported && (
          <button className="o2t-round" data-active={!!call.screenStream} onClick={() => void call.toggleScreen()} title={call.screenStream ? "Stop sharing" : "Share screen"}>
            <ScreenIcon />
          </button>
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
