import { randomBytes } from "node:crypto";
import { MAX_PEERS_PER_ROOM, type Envelope, type ServerEvent, type SignalRequest } from "@open2talk/core";

/**
 * In-memory room registry. This is the only server state: who is connected to which room id.
 * It holds no names, passwords or keys, and everything disappears when the last peer leaves.
 */

export interface PeerSink {
  send(event: ServerEvent): void;
  close(): void;
}

interface Peer {
  id: string;
  token: string;
  sink: PeerSink;
}

type Room = Map<string, Peer>;

interface Registry {
  rooms: Map<string, Room>;
  tokens: Map<string, { roomId: string; peerId: string }>;
}

// Survive Next.js dev hot reloads.
const g = globalThis as typeof globalThis & { __open2talkRooms?: Registry };
const registry: Registry = (g.__open2talkRooms ??= { rooms: new Map(), tokens: new Map() });

const maxPeers = Number(process.env.MAX_PEERS_PER_ROOM) || MAX_PEERS_PER_ROOM;

export type JoinResult = { ok: true; token: string } | { ok: false; reason: "room-full" };

export function joinRoom(roomId: string, peerId: string, sink: PeerSink): JoinResult {
  let room = registry.rooms.get(roomId);
  const existing = room?.get(peerId);

  if (!existing && room && room.size >= maxPeers) return { ok: false, reason: "room-full" };
  if (!room) {
    room = new Map();
    registry.rooms.set(roomId, room);
  }

  // Same peer reconnecting: replace the old stream silently.
  if (existing) {
    registry.tokens.delete(existing.token);
    existing.sink.close();
  }

  const token = randomBytes(24).toString("base64url");
  const peers = [...room.keys()].filter((id) => id !== peerId);
  room.set(peerId, { id: peerId, token, sink });
  registry.tokens.set(token, { roomId, peerId });

  sink.send({ type: "welcome", token, peers });
  if (!existing) broadcast(room, { type: "peer-joined", id: peerId }, peerId);
  return { ok: true, token };
}

/** Called when an SSE stream closes. The token guards against a stale stream evicting a reconnect. */
export function leaveRoom(roomId: string, peerId: string, token: string): void {
  const room = registry.rooms.get(roomId);
  const peer = room?.get(peerId);
  if (!room || !peer || peer.token !== token) return;
  room.delete(peerId);
  registry.tokens.delete(token);
  if (room.size === 0) registry.rooms.delete(roomId);
  else broadcast(room, { type: "peer-left", id: peerId });
}

export type RelayResult = "ok" | "unauthorized" | "not-found";

export function relay(roomId: string, token: string, req: SignalRequest): RelayResult {
  const who = registry.tokens.get(token);
  if (!who || who.roomId !== roomId) return "unauthorized";
  const room = registry.rooms.get(roomId);
  if (!room) return "unauthorized";

  const envelope: Envelope = { from: who.peerId, to: req.to, iv: req.iv, ct: req.ct };
  if (req.to) {
    const target = room.get(req.to);
    if (!target) return "not-found";
    target.sink.send({ type: "signal", envelope });
  } else {
    broadcast(room, { type: "signal", envelope }, who.peerId);
  }
  return "ok";
}

function broadcast(room: Room, event: ServerEvent, except?: string): void {
  for (const peer of room.values()) if (peer.id !== except) peer.sink.send(event);
}

export function stats(): { rooms: number; peers: number } {
  let peers = 0;
  for (const room of registry.rooms.values()) peers += room.size;
  return { rooms: registry.rooms.size, peers };
}
