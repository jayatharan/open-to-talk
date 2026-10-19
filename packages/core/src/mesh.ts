import { open, randomId, seal, type RoomSecret } from "./crypto";
import { Emitter } from "./emitter";
import type { Envelope, IceCandidate, IceConfig, Payload, PeerState, StreamKind } from "./protocol";
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
};

export interface MeshCallOptions {
  host: string;
  secret: RoomSecret;
  displayName: string;
  ice: IceConfig;
  rtc?: RtcImpl;
  eventSource?: EventSourceFactory;
  fetch?: typeof fetch;
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
  private localCamera: MediaStream | null = null;
  private localScreen: MediaStream | null = null;
  private micOn = true;
  private camOn = true;
  private left = false;

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
  }

  get peers(): RemotePeer[] {
    return [...this.links.values()].map((l) => this.snapshot(l));
  }

  get isScreenSharing(): boolean {
    return this.localScreen !== null;
  }

  setMicEnabled(on: boolean): void {
    this.micOn = on;
    this.localCamera?.getAudioTracks().forEach((t) => (t.enabled = on));
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

  /** Share a screen stream. Any audio track on it (tab/system audio) is sent alongside the video. */
  startScreenShare(stream: MediaStream): void {
    if (this.localScreen) this.stopScreenShare();
    this.localScreen = stream;
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (this.localScreen === stream) {
        this.stopScreenShare();
        this.emit("screen-ended", undefined);
      }
    });
    for (const link of this.links.values()) if (link.tracksAttached) this.addStream(link, stream);
    this.broadcastState();
  }

  stopScreenShare(): void {
    const stream = this.localScreen;
    if (!stream) return;
    this.localScreen = null;
    for (const link of this.links.values()) {
      for (const track of stream.getTracks()) {
        const sender = link.senders.get(track.id);
        if (sender) {
          try {
            link.pc.removeTrack(sender);
          } catch {
            // connection already closed
          }
          link.senders.delete(track.id);
        }
      }
    }
    stream.getTracks().forEach((t) => t.stop());
    this.broadcastState();
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    void this.send({ t: "bye", from: this.peerId }).finally(() => this.signaling.close());
    for (const id of [...this.links.keys()]) this.closeLink(id, false);
    this.localScreen?.getTracks().forEach((t) => t.stop());
    this.localCamera?.getTracks().forEach((t) => t.stop());
    this.localScreen = null;
    this.emitPeers();
  }

  // ---------------------------------------------------------------- internals

  private localState(): PeerState {
    const streams: Record<string, StreamKind> = {};
    if (this.localCamera) streams[this.localCamera.id] = "camera";
    if (this.localScreen) streams[this.localScreen.id] = "screen";
    return {
      name: this.opts.displayName,
      micOn: this.micOn,
      camOn: this.camOn,
      screenOn: this.localScreen !== null,
      streams,
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
        const existing = this.links.get(p.from);
        // Whoever hears the newcomer's broadcast hello makes the first offer; the newcomer waits.
        // A single initial offerer avoids glare on every join.
        const link = this.ensureLink(p.from, !p.reply);
        link.state = p.state;
        if (!p.reply || !existing) {
          await this.send({ t: "hello", from: this.peerId, to: p.from, reply: true, state: this.localState() });
        }
        this.emitPeers();
        break;
      }
      case "state": {
        this.ensureLink(p.from).state = p.state;
        this.emitPeers();
        break;
      }
      case "sdp":
        await this.onDescription(this.ensureLink(p.from), p.description);
        break;
      case "ice":
        await this.onCandidate(this.ensureLink(p.from), p.candidate);
        break;
      case "bye":
        this.closeLink(p.from);
        break;
    }
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
      this.emitPeers();
    });

    if (initiator) {
      // The data channel guarantees there is something to negotiate (and a "connected" state)
      // even when nobody has a camera or mic; it is also the hook for future in-call chat.
      pc.createDataChannel("o2t");
      this.attachLocal(link);
    }
    return link;
  }

  private attachLocal(link: PeerLink): void {
    link.tracksAttached = true;
    if (this.localCamera) this.addStream(link, this.localCamera);
    if (this.localScreen) this.addStream(link, this.localScreen);
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

  private closeLink(id: string, emit = true): void {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    try {
      link.pc.close();
    } catch {
      // ignore
    }
    if (emit) this.emitPeers();
  }

  private snapshot(link: PeerLink): RemotePeer {
    let camera: MediaStream | null = null;
    let screen: MediaStream | null = null;
    for (const [streamId, stream] of link.remoteStreams) {
      const kind = link.state.streams[streamId];
      if (kind === "screen") {
        if (link.state.screenOn && stream.getVideoTracks().some((t) => t.readyState !== "ended")) screen = stream;
      } else if (kind === "camera" || !camera) {
        camera = stream;
      }
    }
    return { id: link.id, state: link.state, connection: link.pc.connectionState, camera, screen };
  }

  private emitPeers(): void {
    this.emit("peers", this.peers);
  }
}
