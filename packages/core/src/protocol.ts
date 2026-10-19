import { z } from "zod";

export const MAX_PEERS_PER_ROOM = 8;
export const MAX_ENVELOPE_BYTES = 64 * 1024;

const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const peerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);

/**
 * What travels through the server. `iv` + `ct` are AES-GCM sealed `Payload`s; the server
 * can route by `from`/`to` but never read the contents.
 */
export const envelopeSchema = z.object({
  from: peerIdSchema,
  to: peerIdSchema.optional(),
  iv: b64url.max(32),
  ct: b64url.max(MAX_ENVELOPE_BYTES),
});
export type Envelope = z.infer<typeof envelopeSchema>;

/** Body of `POST /api/rooms/:roomId/signal`. `from` is filled in by the server from the token. */
export const signalRequestSchema = envelopeSchema.omit({ from: true });
export type SignalRequest = z.infer<typeof signalRequestSchema>;

export type StreamKind = "camera" | "screen";

export interface PeerState {
  name: string;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  /** Maps local MediaStream ids to what they carry so receivers can label tiles. */
  streams: Record<string, StreamKind>;
}

/** Decrypted payloads. `from`/`to` are repeated inside so a captured ciphertext cannot be replayed by another peer. */
export type Payload =
  | { t: "hello"; from: string; to?: string; reply: boolean; state: PeerState }
  | { t: "state"; from: string; to?: string; state: PeerState }
  | { t: "sdp"; from: string; to: string; description: { type: "offer" | "answer" | "pranswer" | "rollback"; sdp?: string } }
  | { t: "ice"; from: string; to: string; candidate: IceCandidate | null }
  | { t: "bye"; from: string; to?: string };

export interface IceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** Server-sent events emitted by `GET /api/rooms/:roomId/events`. */
export type ServerEvent =
  | { type: "welcome"; token: string; peers: string[] }
  | { type: "peer-joined"; id: string }
  | { type: "peer-left"; id: string }
  | { type: "signal"; envelope: Envelope }
  | { type: "error"; code: "room-full" | "bad-request" | "rate-limited"; message: string };

export interface IceConfig {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}

export const PEER_TOKEN_HEADER = "x-peer-token";
