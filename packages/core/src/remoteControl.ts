/**
 * Remote control of a shared screen: a viewer asks the sharer for control, the sharer approves,
 * and the viewer's pointer and keyboard events are sent over the data channel between the two
 * people. The sharer's app (desktop only) injects them into its OS.
 *
 * Coordinates are normalized to 0..1 on the shared screen, since the video a viewer sees is scaled.
 */

export type MouseButton = 0 | 1 | 2;

export type ControlInput =
  | { k: "move"; x: number; y: number }
  | { k: "down" | "up"; b: MouseButton; x: number; y: number }
  | { k: "wheel"; dx: number; dy: number }
  | { k: "key"; code: string; down: boolean };

/** What a person sees of remote control in a call. */
export interface RemoteControlState {
  /** The sharer this device asked to control, and whether they have allowed it yet. */
  outgoing: { peer: string; status: "pending" | "active" } | null;
  /** The person controlling this device's shared screen. */
  controlledBy: string | null;
  /** People waiting for this device to allow or deny control, oldest first. */
  requests: string[];
}

export const NO_REMOTE_CONTROL: RemoteControlState = { outgoing: null, controlledBy: null, requests: [] };

/** Message sent on the person-to-person data channel. Other `t` values are reserved (e.g. chat). */
export interface ChannelMessage {
  t: "rc";
  e: ControlInput;
}

const MAX_WHEEL = 2000;
const unit = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const wheel = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_WHEEL;

/** Validates input received from another peer; anything malformed is dropped. */
export function parseControlInput(raw: unknown): ControlInput | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  switch (e.k) {
    case "move":
      return unit(e.x) && unit(e.y) ? { k: "move", x: e.x, y: e.y } : null;
    case "down":
    case "up":
      return unit(e.x) && unit(e.y) && (e.b === 0 || e.b === 1 || e.b === 2) ? { k: e.k, b: e.b, x: e.x, y: e.y } : null;
    case "wheel":
      return wheel(e.dx) && wheel(e.dy) ? { k: "wheel", dx: e.dx, dy: e.dy } : null;
    case "key":
      return typeof e.code === "string" && /^[A-Za-z0-9]{1,24}$/.test(e.code) && typeof e.down === "boolean"
        ? { k: "key", code: e.code, down: e.down }
        : null;
    default:
      return null;
  }
}

/**
 * Maps a pointer position to 0..1 coordinates on the picture of a video shown with
 * `object-fit: contain`, skipping the black bars. Returns null outside the picture, or the nearest
 * edge point with `clamp` (e.g. a button released after dragging out of the picture).
 */
export function videoPointToNormalized(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  videoWidth: number,
  videoHeight: number,
  clamp = false,
): { x: number; y: number } | null {
  if (!videoWidth || !videoHeight || !rect.width || !rect.height) return null;
  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const w = videoWidth * scale;
  const h = videoHeight * scale;
  const x = (clientX - rect.left - (rect.width - w) / 2) / w;
  const y = (clientY - rect.top - (rect.height - h) / 2) / h;
  if (clamp) return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}
