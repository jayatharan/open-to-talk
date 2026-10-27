import { describe, expect, it } from "vitest";
import type { RoomSecret } from "./crypto";
import { MeshCall } from "./mesh";
import type { Payload, PeerState } from "./protocol";
import { parseControlInput, videoPointToNormalized, type ControlInput } from "./remoteControl";

describe("videoPointToNormalized", () => {
  const rect = { left: 10, top: 20, width: 400, height: 300 };

  it("maps the picture edges to 0..1 when the video fills the box", () => {
    expect(videoPointToNormalized(10, 20, rect, 800, 600)).toEqual({ x: 0, y: 0 });
    expect(videoPointToNormalized(410, 320, rect, 800, 600)).toEqual({ x: 1, y: 1 });
    expect(videoPointToNormalized(210, 170, rect, 800, 600)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("skips letterbox bars above and below a wide video", () => {
    // 1600x600 in 400x300 → picture is 400x150, starting 75px down.
    expect(videoPointToNormalized(210, 50, rect, 1600, 600)).toBeNull();
    expect(videoPointToNormalized(10, 95, rect, 1600, 600)).toEqual({ x: 0, y: 0 });
    expect(videoPointToNormalized(410, 245, rect, 1600, 600)).toEqual({ x: 1, y: 1 });
  });

  it("skips pillarbox bars beside a tall video", () => {
    // 300x600 in 400x300 → picture is 150x300, starting 125px in.
    expect(videoPointToNormalized(50, 170, rect, 300, 600)).toBeNull();
    expect(videoPointToNormalized(135, 20, rect, 300, 600)).toEqual({ x: 0, y: 0 });
    expect(videoPointToNormalized(210, 170, rect, 300, 600)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps to the nearest edge when asked", () => {
    expect(videoPointToNormalized(0, 400, rect, 800, 600, true)).toEqual({ x: 0, y: 1 });
  });

  it("returns null before the video has a size", () => {
    expect(videoPointToNormalized(100, 100, rect, 0, 0)).toBeNull();
  });
});

describe("parseControlInput", () => {
  it("accepts well-formed input", () => {
    expect(parseControlInput({ k: "move", x: 0.2, y: 1 })).toEqual({ k: "move", x: 0.2, y: 1 });
    expect(parseControlInput({ k: "down", b: 2, x: 0, y: 0.5 })).toEqual({ k: "down", b: 2, x: 0, y: 0.5 });
    expect(parseControlInput({ k: "wheel", dx: 0, dy: -120 })).toEqual({ k: "wheel", dx: 0, dy: -120 });
    expect(parseControlInput({ k: "key", code: "KeyA", down: true, extra: 1 })).toEqual({ k: "key", code: "KeyA", down: true });
  });

  it("rejects out-of-range or malformed input", () => {
    expect(parseControlInput({ k: "move", x: 1.5, y: 0 })).toBeNull();
    expect(parseControlInput({ k: "move", x: Number.NaN, y: 0 })).toBeNull();
    expect(parseControlInput({ k: "down", b: 3, x: 0, y: 0 })).toBeNull();
    expect(parseControlInput({ k: "wheel", dx: 1e9, dy: 0 })).toBeNull();
    expect(parseControlInput({ k: "key", code: "Key A; rm", down: true })).toBeNull();
    expect(parseControlInput({ k: "exec" })).toBeNull();
    expect(parseControlInput(null)).toBeNull();
  });
});

class FakeChannel extends EventTarget {
  readonly label = "o2t";
  readyState = "open";
  bufferedAmount = 0;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
}

class FakePeerConnection extends EventTarget {
  connectionState = "new";
  createDataChannel() {
    return new FakeChannel();
  }
  close() {
    this.connectionState = "closed";
  }
}

const person = (rc?: boolean): PeerState => ({ name: "P", micOn: true, camOn: true, screenOn: !!rc, streams: {}, ...(rc ? { rc } : {}) });

/** A MeshCall without signaling: control messages it would send are collected instead. */
function harness() {
  const call = new MeshCall({
    host: "http://localhost",
    secret: { roomId: "r", salt: "s", key: {} as CryptoKey } as RoomSecret,
    displayName: "Me",
    ice: { iceServers: [] },
    rtc: { RTCPeerConnection: FakePeerConnection as unknown as typeof RTCPeerConnection },
  });
  const internals = call as unknown as {
    send(p: Payload): Promise<void>;
    ensureLink(id: string, initiator?: boolean): { state: PeerState; channel: FakeChannel | null };
    onControl(from: string, action: string): void;
    onChannelMessage(from: string, data: unknown): void;
    closeLink(id: string): void;
    screenCall: unknown;
  };
  const sent: { to?: string; action?: string }[] = [];
  internals.send = async (p) => {
    if (p.t === "rc") sent.push({ to: p.to, action: p.action });
  };
  const inputs: ControlInput[] = [];
  call.on("control-input", (e) => inputs.push(e));
  const link = (id: string, state: PeerState) => {
    const l = internals.ensureLink(id, true);
    l.state = state;
    return l;
  };
  return { call, internals, sent, inputs, link };
}

describe("remote control in MeshCall", () => {
  it("lets a sharer allow one person, and only accepts that person's input", () => {
    const { call, internals, sent, inputs, link } = harness();
    internals.screenCall = {}; // sharing
    call.setControllable(true);
    link("alice", person());
    link("bob", person());

    internals.onControl("alice", "request");
    internals.onControl("bob", "request");
    expect(call.remoteControl.requests).toEqual(["alice", "bob"]);

    call.respondControl("alice", true);
    call.respondControl("bob", false);
    expect(call.remoteControl).toEqual({ outgoing: null, controlledBy: "alice", requests: [] });
    expect(sent).toEqual([
      { to: "alice", action: "grant" },
      { to: "bob", action: "deny" },
    ]);

    const move = JSON.stringify({ t: "rc", e: { k: "move", x: 0.5, y: 0.5 } });
    internals.onChannelMessage("bob", move);
    internals.onChannelMessage("alice", move);
    internals.onChannelMessage("alice", JSON.stringify({ t: "rc", e: { k: "move", x: 7, y: 0 } }));
    expect(inputs).toEqual([{ k: "move", x: 0.5, y: 0.5 }]);

    internals.onControl("alice", "revoke");
    internals.onChannelMessage("alice", move);
    expect(inputs).toHaveLength(1);
    expect(call.remoteControl.controlledBy).toBeNull();
  });

  it("denies requests while the screen is not controllable", () => {
    const { call, internals, sent, link } = harness();
    link("alice", person());
    internals.onControl("alice", "request");
    expect(call.remoteControl.requests).toEqual([]);
    expect(sent).toEqual([{ to: "alice", action: "deny" }]);
  });

  it("ends control when the share stops or the controller leaves", () => {
    const { call, internals, sent, link } = harness();
    internals.screenCall = { leave() {} };
    call.setControllable(true);
    link("alice", person());
    link("bob", person());
    internals.onControl("alice", "request");
    call.respondControl("alice", true);
    internals.onControl("bob", "request");

    internals.closeLink("alice");
    expect(call.remoteControl.controlledBy).toBeNull();

    call.stopScreenShare();
    expect(call.remoteControl.requests).toEqual([]);
    expect(sent.at(-1)).toEqual({ to: "bob", action: "deny" });
  });

  it("controls a sharer once granted, and sends input over the data channel", () => {
    const { call, internals, sent, link } = harness();
    const alice = link("alice", person(true));

    call.sendControlInput({ k: "move", x: 0, y: 0 }); // not granted yet: dropped
    call.requestControl("alice");
    expect(call.remoteControl.outgoing).toEqual({ peer: "alice", status: "pending" });
    internals.onControl("alice", "grant");
    expect(call.remoteControl.outgoing).toEqual({ peer: "alice", status: "active" });

    call.sendControlInput({ k: "key", code: "KeyA", down: true });
    expect(alice.channel!.sent.map((d) => JSON.parse(d))).toEqual([{ t: "rc", e: { k: "key", code: "KeyA", down: true } }]);

    call.stopControlling();
    expect(call.remoteControl.outgoing).toBeNull();
    expect(sent).toEqual([
      { to: "alice", action: "request" },
      { to: "alice", action: "revoke" },
    ]);
  });

  it("does not ask people who don't offer control, and reports a denial", () => {
    const { call, internals, sent, link } = harness();
    link("bob", person());
    call.requestControl("bob");
    expect(sent).toEqual([]);

    link("alice", person(true));
    const denied: string[] = [];
    call.on("control-denied", (id) => denied.push(id));
    call.requestControl("alice");
    internals.onControl("alice", "deny");
    expect(denied).toEqual(["alice"]);
    expect(call.remoteControl.outgoing).toBeNull();
  });
});
