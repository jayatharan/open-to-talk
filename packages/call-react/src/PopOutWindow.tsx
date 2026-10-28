import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CamIcon, CamOffIcon, CloseIcon, MicIcon, MicOffIcon, ReturnIcon } from "./icons";
import { useAttachedStream } from "./useAttachedStream";

/** Window name the desktop app recognizes and turns into a floating always-on-top window. */
export const POP_OUT_WINDOW_NAME = "o2t-pip";

/**
 * Renders `children` into a same-origin popup window. The popup shares this page's JavaScript, so
 * the same MediaStreams and call state are used directly. Closing it (or unmounting) ends it.
 */
export function PopOutWindow({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const popup = window.open("about:blank", POP_OUT_WINDOW_NAME, "width=360,height=220");
    if (!popup) {
      onCloseRef.current();
      return;
    }
    popupRef.current = popup;
    const doc = popup.document;
    // Same styles and theme as the call.
    for (const node of document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')) {
      const copy = node.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
      // Absolute, so it loads the same file whatever the popup's base URL.
      if (node instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = node.href;
      doc.head.appendChild(copy);
    }
    doc.body.className = "o2t-pip-body";
    const root = doc.createElement("div");
    root.className = "o2t-pip-root";
    doc.body.appendChild(root);
    setContainer(root);

    let closing = false;
    const closed = () => {
      if (closing) return;
      closing = true;
      onCloseRef.current();
    };
    popup.addEventListener("pagehide", closed);
    // Fallback for window managers that close it without unloading the page first.
    const timer = setInterval(() => popup.closed && closed(), 500);
    return () => {
      closing = true;
      clearInterval(timer);
      popup.removeEventListener("pagehide", closed);
      setContainer(null);
      popupRef.current = null;
      popup.close();
    };
  }, []);

  useEffect(() => {
    if (popupRef.current) popupRef.current.document.title = title;
  }, [title, container]);

  return container ? createPortal(children, container) : null;
}

export interface PopOutTileProps {
  stream: MediaStream | null;
  name: string;
  kind: "camera" | "screen";
  mirrored?: boolean;
  showVideo: boolean;
  /** The tile's own mic state, shown as a badge. */
  micOn?: boolean;
  /** This device's mic and camera, controllable from the pop-out. */
  local: { micOn: boolean; camOn: boolean; canMic: boolean; canCam: boolean; toggleMic: () => void; toggleCam: () => void };
  onBackToCall: () => void;
  onClose: () => void;
}

/** The single tile shown in the pop-out, with quick controls. Drag anywhere to move the window. */
export function PopOutTile({ stream, name, kind, mirrored, showVideo, micOn, local, onBackToCall, onClose }: PopOutTileProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const hasFrames = useAttachedStream(ref, stream);
  const hasVideo = showVideo && !!stream?.getVideoTracks().length && hasFrames;
  return (
    <div className={`o2t-pip o2t-pip-${kind}`}>
      {/* Always muted: the tile in the call window keeps playing the audio. */}
      <video ref={ref} autoPlay playsInline muted className={mirrored ? "o2t-mirror" : undefined} style={{ opacity: hasVideo ? 1 : 0 }} />
      {!hasVideo && <div className="o2t-avatar">{name.slice(0, 1).toUpperCase() || "?"}</div>}
      <div className="o2t-pip-label">
        {micOn === false && (
          <span className="o2t-badge" title="Muted">
            <MicOffIcon />
          </span>
        )}
        {name}
      </div>
      <div className="o2t-pip-controls">
        <button className="o2t-pip-btn" data-off={!local.micOn} onClick={local.toggleMic} disabled={!local.canMic} title={local.micOn ? "Mute" : "Unmute"}>
          {local.micOn ? <MicIcon /> : <MicOffIcon />}
        </button>
        <button className="o2t-pip-btn" data-off={!local.camOn} onClick={local.toggleCam} disabled={!local.canCam} title={local.camOn ? "Turn camera off" : "Turn camera on"}>
          {local.camOn ? <CamIcon /> : <CamOffIcon />}
        </button>
        <button className="o2t-pip-btn" onClick={onBackToCall} title="Back to call">
          <ReturnIcon />
        </button>
        <button className="o2t-pip-btn" onClick={onClose} title="Close pop-out">
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
