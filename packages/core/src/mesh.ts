import { open, randomId, seal, type RoomSecret } from "./crypto";
import { Emitter } from "./emitter";
import type { ControlAction, Envelope, IceCandidate, IceConfig, Payload, PeerRole, PeerState, StreamKind } from "./protocol";
import { NO_REMOTE_CONTROL, parseControlInput, type ChannelMessage, type ControlInput, type RemoteControlState } from "./remoteControl";
import { DEFAULT_SCREEN_QUALITY, scaleDownFor, screenQualityPreset, type ScreenQuality } from "./screenQuality";
import { SignalingClient, type EventSourceFactory, type SignalingStatus } from "./signaling";

/**
 * WebRTC constructors are injected so the same engine runs in browsers/Electron (globals) and in
 * React Native (`react-native-webrtc`).
 */
export interface RtcImpl {
  RTCPeerConnection: new (config: RTCConfiguration) => RTCPeerConnection;
  MediaStream?: new (tracks?: MediaStreamTrack[]) => MediaStream;
}

export interface RemotePeer {
  id: string;
  state: PeerState;
  connection: RTCPeerConnectionState;
  camera: MediaStream | null;
  screen: MediaStream | null;
}

export type MeshCallEvents = {
  peers: RemotePeer[];
  status: SignalingStatus;
  /** Unrecoverable problem such as the room being full. The call is closed afterwards. */
  fatal: { code: string; message: string };
  /** The local screen share ended (e.g. the OS "Stop sharing" button was used). */
  "screen-ended": undefined;
  /** The local screen share could not join the room (e.g. too many shares) and was stopped. */
  "screen-error": { code: string; message: string };
  /**
   * Who is talking right now: peer ids, plus `LOCAL_SPEAKER` for this device. Emitted only when
   * the set changes. Based on WebRTC audio-level stats, so the local level needs a connected peer.
   */
  speaking: string[];
  /** Remote control changed: a request arrived, was answered or ended. */
  control: RemoteControlState;
  /** The sharer this device asked to control said no. */
  "control-denied": string;
  /** Input from the person currently allowed to control this device's shared screen. */
  "control-input": ControlInput;
};

/** Id used in the `speaking` event for this device's own microphone. */
export const LOCAL_SPEAKER = "local";

/**
 * Speaking needs a WebRTC audio level (0..1) of at least this, and several times the person's own
 * background noise: some decoders (e.g. Android) report comfort noise of up to ~0.08 for a silent
 * mic, while speech is typically 0.1–0.5.
 */
const MIN_SPEAKING_LEVEL = 0.05;
const NOISE_MULTIPLIER = 3;
/** Keep the indicator on briefly after speech stops so it doesn't flicker between words. */
const SPEAKING_HOLD_MS = 700;
const LEVEL_POLL_MS = 250;
/** Data channel messages are tiny; anything larger is not ours. */
const MAX_CHANNEL_MESSAGE = 512;
/** Skip pointer moves while this much is still queued, so control never lags behind. */
const MAX_BUFFERED_MOVES = 16 * 1024;

export interface MeshCallOptions {
  host: string;
  secret: RoomSecret;
  displayName: string;
  ice: IceConfig;
  rtc?: RtcImpl;
  eventSource?: EventSourceFactory;
  fetch?: typeof fetch;
  /**
   * "screen" runs this call as a screen-share participant for `owner` (internal: created by
   * `startScreenShare`). It only sends its stream, and only to other people.
   */
  role?: PeerRole;
  owner?: string;
}

/**
 * Who connects to whom when `self` hears a hello from `remote`, and who makes the first offer.
 * People connect to each other (the listener of a broadcast hello offers). A screen-share
 * participant connects to every person except its owner and always offers, since only it sends.
 */
export function linkPlan(
  self: { id: string; role?: PeerRole; owner?: string },
  remote: { id: string; state: Pick<PeerState, "role" | "owner"> },
  reply: boolean,
): "skip" | "offer" | "answer" {
  const selfScreen = self.role === "screen";
  const remoteScreen = remote.state.role === "screen";
  if (selfScreen && remoteScreen) return "skip";
  if (selfScreen) return remote.id === self.owner ? "skip" : "offer";
  if (remoteScreen) return remote.state.owner === self.id ? "skip" : "answer";
  return reply ? "answer" : "offer";
}

class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly polite: boolean;
  makingOffer = false;
  ignoreOffer = false;
  pendingCandidates: IceCandidate[] = [];
  /** Local tracks are attached up front by the initiator, or after the first remote offer otherwise. */
  tracksAttached = false;
  senders = new Map<string, RTCRtpSender>();
  remoteStreams = new Map<string, MediaStream>();
  /** The person-to-person data channel ("o2t"), used for remote-control input. */
  channel: RTCDataChannel | null = null;
  state: PeerState = { name: "Guest", micOn: true, camOn: true, screenOn: false, streams: {} };

  constructor(
    readonly id: string,
    selfId: string,
    rtc: RtcImpl,
    ice: IceConfig,
  ) {
    this.pc = new rtc.RTCPeerConnection({ iceServers: ice.iceServers });
    // Perfect negotiation: exactly one side is "polite" and yields on offer collisions.
    this.polite = selfId < id;
  }
}

export class MeshCall extends Emitter<MeshCallEvents> {
  readonly peerId = randomId(12);
  private readonly signaling: SignalingClient;
  private readonly rtc: RtcImpl;
  private readonly links = new Map<string, PeerLink>();
  private queue: Promise<void> = Promise.resolve();
  /** Mic/camera for a person; the shared screen for a screen-share participant. */
  private localCamera: MediaStream | null = null;
  /** The screen-share participant this person runs while sharing. */
  private screenCall: MeshCall | null = null;
  private screenQualityId: ScreenQuality = DEFAULT_SCREEN_QUALITY;
  private micOn = true;
  private camOn = true;
  private left = false;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeard = new Map<string, number>();
  /** Slow-moving estimate of each speaker's background level (only updated while quiet). */
  private noiseFloor = new Map<string, number>();
  private speaking: string[] = [];
  /** Whether viewers may ask to control this device's shared screen (desktop, whole screen only). */
  private controllable = false;
  private control: RemoteControlState = NO_REMOTE_CONTROL;

  constructor(private readonly opts: MeshCallOptions) {
    super();
    this.rtc = opts.rtc ?? {
      RTCPeerConnection: globalThis.RTCPeerConnection,
      MediaStream: globalThis.MediaStream,
    };
    this.signaling = new SignalingClient({
      host: opts.host,
      roomId: opts.secret.roomId,
      peerId: this.peerId,
      role: opts.role,
      nameTag: opts.secret.salt,
      eventSource: opts.eventSource,
      fetch: opts.fetch,
    });
    this.signaling.on("status", (s) => this.emit("status", s));
    this.signaling.on("fatal", (f) => {
      this.emit("fatal", f);
      this.leave();
    });
    this.signaling.on("welcome", ({ peers }) => {
      // After a reconnect, drop links to peers that are gone.
      for (const id of this.links.keys()) if (!peers.includes(id)) this.closeLink(id);
      void this.send({ t: "hello", from: this.peerId, reply: false, state: this.localState() });
    });
    this.signaling.on("peer-left", (id) => this.closeLink(id));
    this.signaling.on("signal", (env) => {
      this.queue = this.queue.then(() => this.onEnvelope(env)).catch((e) => console.warn("[open2talk]", e));
    });
  }

  // ---------------------------------------------------------------- public API

  /** Join the room. `camera` may hold the mic and/or camera tracks (or be null for listen-only). */
  join(camera: MediaStream | null): void {
    this.localCamera = camera;
    this.micOn = camera?.getAudioTracks()[0]?.enabled ?? false;
    this.camOn = camera?.getVideoTracks()[0]?.enabled ?? false;
    this.signaling.connect();
    if (!this.isScreenRole) this.levelTimer = setInterval(() => void this.pollLevels(), LEVEL_POLL_MS);
  }

  /** The people in the call; each one's screen share (a separate participant) is in `screen`. */
  get peers(): RemotePeer[] {
    return [...this.links.values()].filter((l) => l.state.role !== "screen").map((l) => this.snapshot(l));
  }

  get isScreenSharing(): boolean {
    return this.screenCall !== null;
  }

  get screenQuality(): ScreenQuality {
    return this.screenQualityId;
  }

  /**
   * Mute or unmute by disabling the mic track: the connection keeps sending silent packets, so the
   * receiver's playout stays in sync and audio returns as soon as the mic is unmuted.
   *
   * `keepSending` keeps the track enabled while reporting the mic as muted; Android uses it because
   * shared device audio is mixed into the mic track (and muted in its mixer instead).
   */
  setMicEnabled(on: boolean, opts: { keepSending?: boolean } = {}): void {
    this.micOn = on;
    const send = on || !!opts.keepSending;
    this.localCamera?.getAudioTracks().forEach((t) => (t.enabled = send));
    this.broadcastState();
  }

  setCameraEnabled(on: boolean): void {
    this.camOn = on;
    this.localCamera?.getVideoTracks().forEach((t) => (t.enabled = on));
    this.broadcastState();
  }

  /** Swap the camera track (e.g. front/back camera on mobile) without renegotiation. */
  async replaceCameraTrack(track: MediaStreamTrack): Promise<void> {
    const old = this.localCamera?.getVideoTracks()[0];
    for (const link of this.links.values()) {
      const sender = old ? link.senders.get(old.id) : undefined;
      if (sender) {
        await sender.replaceTrack(track);
        link.senders.delete(old!.id);
        link.senders.set(track.id, sender);
      }
    }
    if (this.localCamera) {
      if (old) this.localCamera.removeTrack(old);
      this.localCamera.addTrack(track);
    }
    track.enabled = this.camOn;
  }

  /**
   * Share a screen stream. It joins the room as its own participant with its own connections, so
   * starting and stopping never renegotiates the call. Any audio track on it (tab/system audio) is
   * sent alongside the video.
   */
  startScreenShare(stream: MediaStream, opts: { quality?: ScreenQuality } = {}): void {
    if (this.screenCall) this.stopScreenShare();
    if (opts.quality) this.screenQualityId = opts.quality;
    const screen = new MeshCall({ ...this.opts, role: "screen", owner: this.peerId });
    screen.screenQualityId = this.screenQualityId;
    this.screenCall = screen;
    screen.on("fatal", (f) => {
      if (this.screenCall !== screen) return;
      this.stopScreenShare();
      this.emit("screen-error", f);
    });
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (this.screenCall === screen) {
        this.stopScreenShare();
        this.emit("screen-ended", undefined);
      }
    });
    screen.join(stream);
    this.broadcastState();
  }

  /** Change the screen-share resolution cap and bitrate, also while sharing (no renegotiation). */
  setScreenQuality(quality: ScreenQuality): void {
    this.screenQualityId = quality;
    if (this.screenCall) {
      this.screenCall.screenQualityId = quality;
      for (const link of this.screenCall.links.values()) void this.screenCall.applyScreenQuality(link);
    }
  }

  stopScreenShare(): void {
    const screen = this.screenCall;
    if (!screen) return;
    this.screenCall = null;
    screen.leave(); // says bye, disconnects and stops the screen tracks
    this.controllable = false;
    this.endIncomingControl();
    this.broadcastState();
  }

  get remoteControl(): RemoteControlState {
    return this.control;
  }

  /**
   * Let viewers ask to control the screen this device shares. Only for a whole-screen share in an
   * app that can inject input (desktop); turned off again when the share stops.
   */
  setControllable(on: boolean): void {
    on &&= this.screenCall !== null;
    if (this.controllable === on) return;
    this.controllable = on;
    if (!on) this.endIncomingControl();
    this.broadcastState();
  }

  /** Ask a person who shares a controllable screen for control of it. */
  requestControl(peerId: string): void {
    if (!this.links.get(peerId)?.state.rc) return;
    const prev = this.control.outgoing;
    if (prev?.peer === peerId) return;
    if (prev) void this.sendControl(prev.peer, "revoke");
    this.setControl({ ...this.control, outgoing: { peer: peerId, status: "pending" } });
    void this.sendControl(peerId, "request");
  }

  /** Allow or deny a pending request to control this device's shared screen. */
  respondControl(peerId: string, allow: boolean): void {
    if (!this.control.requests.includes(peerId)) return;
    const requests = this.control.requests.filter((id) => id !== peerId);
    if (allow && this.controllable && this.links.has(peerId)) {
      const prev = this.control.controlledBy;
      if (prev && prev !== peerId) void this.sendControl(prev, "revoke");
      this.setControl({ ...this.control, controlledBy: peerId, requests });
      void this.sendControl(peerId, "grant");
    } else {
      this.setControl({ ...this.control, requests });
      void this.sendControl(peerId, "deny");
    }
  }

  /** Stop controlling (or cancel the request to control) another person's screen. */
  stopControlling(): void {
    const out = this.control.outgoing;
    if (!out) return;
    this.setControl({ ...this.control, outgoing: null });
    void this.sendControl(out.peer, "revoke");
  }

  /** Take control of this device back from whoever has it. */
  revokeControl(): void {
    const by = this.control.controlledBy;
    if (!by) return;
    this.setControl({ ...this.control, controlledBy: null });
    void this.sendControl(by, "revoke");
  }

  /** Send pointer/keyboard input to the screen this device is allowed to control. */
  sendControlInput(e: ControlInput): void {
    const out = this.control.outgoing;
    if (out?.status !== "active") return;
    const ch = this.links.get(out.peer)?.channel;
    if (ch?.readyState !== "open") return;
    if (e.k === "move" && ch.bufferedAmount > MAX_BUFFERED_MOVES) return;
    const msg: ChannelMessage = { t: "rc", e };
    try {
      ch.send(JSON.stringify(msg));
    } catch {
      // the channel closed in between; the link is going away
    }
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    void this.send({ t: "bye", from: this.peerId }).finally(() => this.signaling.close());
    for (const id of [...this.links.keys()]) this.closeLink(id, false);
    this.screenCall?.leave();
    this.screenCall = null;
    this.localCamera?.getTracks().forEach((t) => t.stop());
    this.controllable = false;
    this.setControl(NO_REMOTE_CONTROL);
    this.emitPeers();
  }

  // ---------------------------------------------------------------- internals

  private get isScreenRole(): boolean {
    return this.opts.role === "screen";
  }

  private localState(): PeerState {
    const streams: Record<string, StreamKind> = {};
    if (this.isScreenRole) {
      if (this.localCamera) streams[this.localCamera.id] = "screen";
      return { name: this.opts.displayName, micOn: false, camOn: false, screenOn: true, streams, role: "screen", owner: this.opts.owner };
    }
    if (this.localCamera) streams[this.localCamera.id] = "camera";
    return {
      name: this.opts.displayName,
      micOn: this.micOn,
      camOn: this.camOn,
      screenOn: this.screenCall !== null,
      streams,
      ...(this.controllable && this.screenCall ? { rc: true } : {}),
    };
  }

  private broadcastState(): void {
    void this.send({ t: "state", from: this.peerId, state: this.localState() });
  }

  private async send(payload: Payload): Promise<void> {
    if (this.left && payload.t !== "bye") return;
    try {
      const sealed = await seal(this.opts.secret.key, payload, this.opts.secret.roomId);
      await this.signaling.send({ to: payload.to, ...sealed });
    } catch (e) {
      console.warn("[open2talk] send failed", e);
    }
  }

  private async onEnvelope(env: Envelope): Promise<void> {
    if (this.left || (env.to && env.to !== this.peerId)) return;
    let p: Payload;
    try {
      p = await open<Payload>(this.opts.secret.key, env, this.opts.secret.roomId);
    } catch {
      return; // not sealed with our room key: someone has the link but not the password
    }
    // The sealed sender/recipient must match the routing header, otherwise it's a replay.
    if (p.from !== env.from || p.to !== env.to || p.from === this.peerId) return;

    switch (p.t) {
      case "hello": {
        // A single initial offerer avoids glare on every join (see `linkPlan`).
        const plan = this.planFor(p.from, p.state, p.reply);
        if (plan === "skip") break;
        const existing = this.links.get(p.from);
        const reply = !p.reply || !existing;
        // A screen share offers right away: get our hello (and so our role) to them before the offer.
        if (reply && this.isScreenRole) {
          await this.send({ t: "hello", from: this.peerId, to: p.from, reply: true, state: this.localState() });
        }
        const link = this.ensureLink(p.from, plan === "offer");
        link.state = p.state;
        this.checkOutgoingControl(p.from, p.state);
        if (reply && !this.isScreenRole) {
          await this.send({ t: "hello", from: this.peerId, to: p.from, reply: true, state: this.localState() });
        }
        this.emitPeers();
        break;
      }
      case "state": {
        if (this.ignoresUnknown(p.from)) break;
        if (!this.links.has(p.from) && this.planFor(p.from, p.state, true) === "skip") break;
        this.ensureLink(p.from).state = p.state;
        this.checkOutgoingControl(p.from, p.state);
        this.emitPeers();
        break;
      }
      case "sdp":
        if (this.ignoresUnknown(p.from)) break;
        await this.onDescription(this.ensureLink(p.from), p.description);
        break;
      case "ice":
        if (this.ignoresUnknown(p.from)) break;
        await this.onCandidate(this.ensureLink(p.from), p.candidate);
        break;
      case "bye":
        this.closeLink(p.from);
        break;
      case "rc":
        // Only between people who are already connected; never with a screen-share participant.
        if (this.isScreenRole || !this.links.has(p.from) || this.links.get(p.from)!.state.role === "screen") break;
        this.onControl(p.from, p.action);
        break;
    }
  }

  private planFor(id: string, state: PeerState, reply: boolean): ReturnType<typeof linkPlan> {
    return linkPlan({ id: this.peerId, role: this.opts.role, owner: this.opts.owner }, { id, state }, reply);
  }

  /** A screen share only connects after a hello, so it never answers unknown or skipped peers. */
  private ignoresUnknown(id: string): boolean {
    return this.isScreenRole && !this.links.has(id);
  }

  private ensureLink(id: string, initiator = false): PeerLink {
    const existing = this.links.get(id);
    if (existing && existing.pc.connectionState !== "closed") return existing;

    const link = new PeerLink(id, this.peerId, this.rtc, this.opts.ice);
    const { pc } = link;
    this.links.set(id, link);

    pc.addEventListener("negotiationneeded", async () => {
      try {
        link.makingOffer = true;
        await this.setLocal(pc);
        const desc = pc.localDescription;
        if (desc) {
          await this.send({ t: "sdp", from: this.peerId, to: id, description: { type: desc.type, sdp: desc.sdp } });
        }
      } catch (e) {
        console.warn("[open2talk] negotiation failed", e);
      } finally {
        link.makingOffer = false;
      }
    });

    pc.addEventListener("icecandidate", (ev: RTCPeerConnectionIceEvent) => {
      const c = ev.candidate;
      void this.send({
        t: "ice",
        from: this.peerId,
        to: id,
        candidate: c
          ? { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment }
          : null,
      });
    });

    pc.addEventListener("track", (ev: RTCTrackEvent) => {
      let stream = ev.streams?.[0];
      if (!stream && this.rtc.MediaStream) stream = new this.rtc.MediaStream([ev.track]);
      if (!stream) return;
      link.remoteStreams.set(stream.id, stream);
      const s = stream;
      s.addEventListener?.("removetrack", () => {
        if (s.getTracks().length === 0) link.remoteStreams.delete(s.id);
        this.emitPeers();
      });
      ev.track.addEventListener?.("ended", () => this.emitPeers());
      this.emitPeers();
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") pc.restartIce?.();
      if (pc.connectionState === "connected" && this.isScreenRole) void this.applyScreenQuality(link);
      this.emitPeers();
    });

    pc.addEventListener("datachannel", (ev: RTCDataChannelEvent) => {
      if (ev.channel.label === "o2t") this.attachChannel(link, ev.channel);
    });

    if (initiator) {
      // The data channel guarantees there is something to negotiate (and a "connected" state)
      // even when nobody has a camera or mic; it also carries remote-control input.
      this.attachChannel(link, pc.createDataChannel("o2t"));
      this.attachLocal(link);
    }
    return link;
  }

  private attachChannel(link: PeerLink, channel: RTCDataChannel): void {
    link.channel = channel;
    channel.addEventListener("message", (ev: MessageEvent) => this.onChannelMessage(link.id, ev.data));
  }

  private onChannelMessage(from: string, data: unknown): void {
    // Input is only accepted from the one person this device has allowed to control it.
    if (this.control.controlledBy !== from || typeof data !== "string" || data.length > MAX_CHANNEL_MESSAGE) return;
    let msg: Partial<ChannelMessage>;
    try {
      msg = JSON.parse(data) as Partial<ChannelMessage>;
    } catch {
      return;
    }
    if (msg?.t !== "rc") return;
    const input = parseControlInput(msg.e);
    if (input) this.emit("control-input", input);
  }

  private sendControl(to: string, action: ControlAction): Promise<void> {
    return this.send({ t: "rc", from: this.peerId, to, action });
  }

  private onControl(from: string, action: ControlAction): void {
    const c = this.control;
    switch (action) {
      case "request":
        if (!this.controllable) void this.sendControl(from, "deny");
        else if (c.controlledBy === from) void this.sendControl(from, "grant");
        else if (!c.requests.includes(from)) this.setControl({ ...c, requests: [...c.requests, from] });
        break;
      case "grant":
        if (c.outgoing?.peer === from) this.setControl({ ...c, outgoing: { peer: from, status: "active" } });
        break;
      case "deny":
        if (c.outgoing?.peer === from) {
          this.setControl({ ...c, outgoing: null });
          this.emit("control-denied", from);
        }
        break;
      case "revoke":
        this.forgetControl(from);
        break;
    }
  }

  /** Drop the request to control a sharer once they stop offering control. */
  private checkOutgoingControl(id: string, state: PeerState): void {
    if (this.control.outgoing?.peer === id && !state.rc) this.setControl({ ...this.control, outgoing: null });
  }

  /** Deny everyone waiting and take control back (the share stopped or control was turned off). */
  private endIncomingControl(): void {
    const { requests, controlledBy } = this.control;
    for (const id of requests) void this.sendControl(id, "deny");
    if (controlledBy) void this.sendControl(controlledBy, "revoke");
    if (requests.length || controlledBy) this.setControl({ ...this.control, requests: [], controlledBy: null });
  }

  /** Forget any remote-control relationship with a peer (they revoked it or left). */
  private forgetControl(id: string): void {
    const c = this.control;
    if (c.outgoing?.peer !== id && c.controlledBy !== id && !c.requests.includes(id)) return;
    this.setControl({
      outgoing: c.outgoing?.peer === id ? null : c.outgoing,
      controlledBy: c.controlledBy === id ? null : c.controlledBy,
      requests: c.requests.filter((r) => r !== id),
    });
  }

  private setControl(next: RemoteControlState): void {
    this.control = next;
    this.emit("control", next);
  }

  private attachLocal(link: PeerLink): void {
    link.tracksAttached = true;
    // A screen share only sends, so never send our camera/mic to one.
    if (link.state.role === "screen") return;
    if (this.localCamera) this.addStream(link, this.localCamera);
  }

  /** Prefer the atomic parameterless form; fall back for older WebRTC stacks. */
  private async setLocal(pc: RTCPeerConnection): Promise<void> {
    try {
      await pc.setLocalDescription();
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      const desc = pc.signalingState === "have-remote-offer" ? await pc.createAnswer() : await pc.createOffer();
      await pc.setLocalDescription(desc);
    }
  }

  private addStream(link: PeerLink, stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      if (link.senders.has(track.id)) continue;
      link.senders.set(track.id, link.pc.addTrack(track, stream));
    }
    if (this.isScreenRole) void this.applyScreenQuality(link);
  }

  /** Cap the screen video sent on this link to the chosen quality (resolution, bitrate, frame rate). */
  private async applyScreenQuality(link: PeerLink): Promise<void> {
    const preset = screenQualityPreset(this.screenQualityId);
    for (const sender of link.senders.values()) {
      const track = sender.track;
      if (!track || track.kind !== "video") continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings?.length) continue; // not negotiated yet; retried once connected
        const height = track.getSettings?.().height;
        for (const enc of params.encodings) {
          enc.scaleResolutionDownBy = scaleDownFor(preset, height);
          enc.maxBitrate = preset.maxBitrate;
          enc.maxFramerate = preset.maxFramerate;
        }
        await sender.setParameters(params);
      } catch (e) {
        console.warn("[open2talk] could not set screen quality", e);
      }
    }
  }

  private async onDescription(link: PeerLink, description: RTCSessionDescriptionInit): Promise<void> {
    const { pc } = link;
    const offerCollision = description.type === "offer" && (link.makingOffer || pc.signalingState !== "stable");
    link.ignoreOffer = !link.polite && offerCollision;
    if (link.ignoreOffer) return;

    if (offerCollision) await pc.setLocalDescription({ type: "rollback" });
    await pc.setRemoteDescription(description);
    for (const c of link.pendingCandidates.splice(0)) await this.addCandidate(link, c);

    if (description.type === "offer") {
      // Attaching now lets our tracks reuse the offered transceivers instead of forcing a re-offer.
      if (!link.tracksAttached) this.attachLocal(link);
      await this.setLocal(pc);
      const desc = pc.localDescription;
      if (desc) {
        await this.send({ t: "sdp", from: this.peerId, to: link.id, description: { type: desc.type, sdp: desc.sdp } });
      }
    }
  }

  private async onCandidate(link: PeerLink, candidate: IceCandidate | null): Promise<void> {
    if (!candidate) return;
    if (!link.pc.remoteDescription) {
      link.pendingCandidates.push(candidate);
      return;
    }
    await this.addCandidate(link, candidate);
  }

  private async addCandidate(link: PeerLink, candidate: IceCandidate): Promise<void> {
    try {
      await link.pc.addIceCandidate(candidate);
    } catch (e) {
      if (!link.ignoreOffer) console.warn("[open2talk] addIceCandidate failed", e);
    }
  }

  /** Compare a level with this speaker's adaptive threshold, learning their noise floor while quiet. */
  private isSpeech(id: string, level: number): boolean {
    const floor = this.noiseFloor.get(id) ?? 0;
    const threshold = Math.max(MIN_SPEAKING_LEVEL, floor * NOISE_MULTIPLIER);
    if (level >= threshold) return true;
    this.noiseFloor.set(id, floor * 0.9 + level * 0.1);
    return false;
  }

  /** Read audio levels from each connection's stats and emit `speaking` when the set changes. */
  private async pollLevels(): Promise<void> {
    if (this.left) return;
    const now = Date.now();
    let localLevel = 0;
    for (const link of this.links.values()) {
      if (link.pc.connectionState === "closed" || link.state.role === "screen") continue;
      let report: RTCStatsReport;
      try {
        report = await link.pc.getStats();
      } catch {
        continue;
      }
      // Only the peer's microphone counts, not the audio of a screen they share.
      const cameraId = Object.entries(link.state.streams).find(([, kind]) => kind === "camera")?.[0];
      const micTrackIds = new Set(
        [...link.remoteStreams.values()]
          .filter((s) => !cameraId || s.id === cameraId)
          .flatMap((s) => s.getAudioTracks().map((t) => t.id)),
      );
      let peerLevel = 0;
      report.forEach((stat: Record<string, unknown>) => {
        if (stat.kind !== "audio" || typeof stat.audioLevel !== "number") return;
        if (stat.type === "inbound-rtp") {
          const track = stat.trackIdentifier as string | undefined;
          if (!track || micTrackIds.size === 0 || micTrackIds.has(track)) peerLevel = Math.max(peerLevel, stat.audioLevel);
        } else if (stat.type === "media-source") {
          const track = stat.trackIdentifier as string | undefined;
          const mic = this.localCamera?.getAudioTracks()[0];
          if (!mic || !track || track === mic.id) localLevel = Math.max(localLevel, stat.audioLevel);
        }
      });
      if (link.state.micOn && this.isSpeech(link.id, peerLevel)) this.lastHeard.set(link.id, now);
    }
    if (this.micOn && this.isSpeech(LOCAL_SPEAKER, localLevel)) this.lastHeard.set(LOCAL_SPEAKER, now);

    const next = [...this.lastHeard]
      .filter(([id, at]) => now - at < SPEAKING_HOLD_MS && (id === LOCAL_SPEAKER ? this.micOn : this.links.get(id)?.state.micOn))
      .map(([id]) => id)
      .sort();
    for (const [id, at] of this.lastHeard) if (now - at >= SPEAKING_HOLD_MS) this.lastHeard.delete(id);
    if (next.join() !== this.speaking.join()) {
      this.speaking = next;
      this.emit("speaking", next);
    }
  }

  private closeLink(id: string, emit = true): void {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    this.noiseFloor.delete(id);
    this.lastHeard.delete(id);
    this.forgetControl(id);
    try {
      link.pc.close();
    } catch {
      // ignore
    }
    if (emit) this.emitPeers();
  }

  private snapshot(link: PeerLink): RemotePeer {
    const live = (s: MediaStream) => s.getVideoTracks().some((t) => t.readyState !== "ended");
    let camera: MediaStream | null = null;
    let screen: MediaStream | null = null;
    for (const [streamId, stream] of link.remoteStreams) {
      const kind = link.state.streams[streamId];
      if (kind === "screen") {
        // Older clients send their screen inside the person's own connection.
        if (link.state.screenOn && live(stream)) screen = stream;
      } else if (kind === "camera" || !camera) {
        camera = stream;
      }
    }
    // Newer clients share their screen as a separate participant owned by this person.
    for (const other of this.links.values()) {
      if (other.state.role !== "screen" || other.state.owner !== link.id) continue;
      for (const stream of other.remoteStreams.values()) if (live(stream)) screen = stream;
    }
    return { id: link.id, state: link.state, connection: link.pc.connectionState, camera, screen };
  }

  private emitPeers(): void {
    this.emit("peers", this.peers);
  }
}
