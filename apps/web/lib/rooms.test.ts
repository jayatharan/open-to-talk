import type { ServerEvent } from "@open2talk/core";
import { describe, expect, it } from "vitest";
import { joinRoom, leaveRoom, relay } from "./rooms";

function sink() {
  const events: ServerEvent[] = [];
  let closed = false;
  return { events, get closed() { return closed; }, send: (e: ServerEvent) => events.push(e), close: () => { closed = true; } };
}

let n = 0;
const roomId = () => `room${String(n++).padStart(18, "0")}`;

describe("room registry", () => {
  it("welcomes peers, announces joins and relays envelopes", () => {
    const r = roomId();
    const a = sink();
    const b = sink();
    const ja = joinRoom(r, "peerAAAAAAAA", a);
    const jb = joinRoom(r, "peerBBBBBBBB", b);
    expect(ja.ok && jb.ok).toBe(true);
    expect(b.events[0]).toMatchObject({ type: "welcome", peers: ["peerAAAAAAAA"] });
    expect(a.events[1]).toEqual({ type: "peer-joined", id: "peerBBBBBBBB" });

    if (!jb.ok) throw new Error();
    expect(relay(r, jb.token, { iv: "aa", ct: "bb" })).toBe("ok");
    expect(a.events.at(-1)).toEqual({ type: "signal", envelope: { from: "peerBBBBBBBB", to: undefined, iv: "aa", ct: "bb" } });
    expect(b.events.some((e) => e.type === "signal")).toBe(false);
  });

  it("rejects unknown tokens and tokens from another room", () => {
    const r1 = roomId();
    const r2 = roomId();
    const j = joinRoom(r1, "peerAAAAAAAA", sink());
    joinRoom(r2, "peerBBBBBBBB", sink());
    if (!j.ok) throw new Error();
    expect(relay(r1, "nope", { iv: "aa", ct: "bb" })).toBe("unauthorized");
    expect(relay(r2, j.token, { iv: "aa", ct: "bb" })).toBe("unauthorized");
    expect(relay(r1, j.token, { to: "peerZZZZZZZZ", iv: "aa", ct: "bb" })).toBe("not-found");
  });

  it("caps room size", () => {
    const r = roomId();
    for (let i = 0; i < 8; i++) expect(joinRoom(r, `peer${i}xxxxxxx`, sink()).ok).toBe(true);
    expect(joinRoom(r, "peerOverflow1", sink())).toEqual({ ok: false, reason: "room-full" });
  });

  it("lets a peer reconnect without a stale stream evicting it", () => {
    const r = roomId();
    const watcher = sink();
    joinRoom(r, "peerWATCHERR", watcher);
    const first = sink();
    const j1 = joinRoom(r, "peerAAAAAAAA", first);
    const j2 = joinRoom(r, "peerAAAAAAAA", sink());
    if (!j1.ok || !j2.ok) throw new Error();
    expect(first.closed).toBe(true);
    leaveRoom(r, "peerAAAAAAAA", j1.token); // old stream closing late
    expect(relay(r, j2.token, { iv: "aa", ct: "bb" })).toBe("ok");
    leaveRoom(r, "peerAAAAAAAA", j2.token);
    expect(watcher.events.at(-1)).toEqual({ type: "peer-left", id: "peerAAAAAAAA" });
  });
});
