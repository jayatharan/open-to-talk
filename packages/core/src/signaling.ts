import { Emitter } from "./emitter";
import { PEER_TOKEN_HEADER, type Envelope, type IceConfig, type ServerEvent, type SignalRequest } from "./protocol";

/** The subset of `EventSource` we use; satisfied by the browser global and by `react-native-sse`. */
export interface EventSourceLike {
  addEventListener(type: "message" | "open" | "error", listener: (ev: { data?: string | null }) => void): void;
  close(): void;
}
export type EventSourceFactory = (url: string) => EventSourceLike;

export type SignalingStatus = "connecting" | "open" | "reconnecting" | "closed";

export type SignalingEvents = {
  status: SignalingStatus;
  welcome: { peers: string[] };
  "peer-joined": string;
  "peer-left": string;
  signal: Envelope;
  fatal: { code: string; message: string };
};

export interface SignalingOptions {
  /** Server origin, e.g. `https://talk.example.com`. Empty string means same origin (web). */
  host: string;
  roomId: string;
  peerId: string;
  eventSource?: EventSourceFactory;
  fetch?: typeof fetch;
}

export function normalizeHost(host: string): string {
  const h = host.trim().replace(/\/+$/, "");
  if (!h) return "";
  if (/^https?:\/\//i.test(h)) return h;
  // Bare local/LAN addresses are almost always plain-http dev servers.
  const hostname = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(/[/:]/)[0]!;
  const local =
    /^(localhost|\[::1\]|.+\.local)$/i.test(hostname) ||
    /^(127|10)\.\d+\.\d+\.\d+$|^192\.168\.\d+\.\d+$|^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname);
  return `${local ? "http" : "https"}://${h}`;
}

export async function fetchIceConfig(host: string, fetchImpl: typeof fetch = fetch): Promise<IceConfig> {
  try {
    const res = await fetchImpl(`${normalizeHost(host)}/api/config`);
    if (res.ok) return (await res.json()) as IceConfig;
  } catch {
    // fall through to the public default
  }
  return { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
}

/** Returns null when the host looks like a working open2talk server, or an error string. */
export async function checkHost(host: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${normalizeHost(host)}/api/health`);
    if (!res.ok) return `Server responded with ${res.status}`;
    const body = (await res.json()) as { app?: string };
    return body.app === "open2talk" ? null : "This server is not an open2talk host";
  } catch (e) {
    return e instanceof Error ? e.message : "Could not reach server";
  }
}

/**
 * SSE (server → client) + POST (client → server) signaling channel. It only moves opaque
 * envelopes; encryption is handled by `MeshCall`.
 */
export class SignalingClient extends Emitter<SignalingEvents> {
  private es: EventSourceLike | null = null;
  private token: string | null = null;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly host: string;
  private readonly makeEventSource: EventSourceFactory;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: SignalingOptions) {
    super();
    this.host = normalizeHost(opts.host);
    this.makeEventSource =
      opts.eventSource ??
      ((url) => {
        if (typeof EventSource === "undefined") throw new Error("EventSource is unavailable; pass `eventSource`.");
        return new EventSource(url) as unknown as EventSourceLike;
      });
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
  }

  private base(): string {
    return `${this.host}/api/rooms/${encodeURIComponent(this.opts.roomId)}`;
  }

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    this.emit("status", this.retry === 0 ? "connecting" : "reconnecting");
    const es = this.makeEventSource(`${this.base()}/events?peer=${encodeURIComponent(this.opts.peerId)}`);
    this.es = es;
    es.addEventListener("message", (ev) => {
      if (!ev.data) return;
      let msg: ServerEvent;
      try {
        msg = JSON.parse(ev.data) as ServerEvent;
      } catch {
        return;
      }
      this.handle(msg);
    });
    es.addEventListener("error", () => {
      if (this.es !== es || this.closed) return;
      es.close();
      this.es = null;
      this.token = null;
      this.scheduleReconnect();
    });
  }

  private handle(msg: ServerEvent): void {
    switch (msg.type) {
      case "welcome":
        this.token = msg.token;
        this.retry = 0;
        this.emit("status", "open");
        this.emit("welcome", { peers: msg.peers });
        break;
      case "peer-joined":
        this.emit("peer-joined", msg.id);
        break;
      case "peer-left":
        this.emit("peer-left", msg.id);
        break;
      case "signal":
        this.emit("signal", msg.envelope);
        break;
      case "error":
        this.emit("fatal", { code: msg.code, message: msg.message });
        this.close();
        break;
    }
  }

  private scheduleReconnect(): void {
    this.emit("status", "reconnecting");
    const delay = Math.min(1000 * 2 ** this.retry, 15000);
    this.retry++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.closed) this.open();
    }, delay);
  }

  async send(req: SignalRequest): Promise<void> {
    if (!this.token) return;
    const res = await this.fetchImpl(`${this.base()}/signal`, {
      method: "POST",
      headers: { "content-type": "application/json", [PEER_TOKEN_HEADER]: this.token },
      body: JSON.stringify(req),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Signal failed: ${res.status}`);
    }
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.es?.close();
    this.es = null;
    this.token = null;
    this.emit("status", "closed");
  }
}
