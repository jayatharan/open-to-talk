import { deriveRoom, importLinkKey, roomIdsEqual, roomSalt, ROOM_ID_BYTES, SALT_BYTES, type RoomSecret } from "./crypto";
import { fromBase64Url, toBase64Url } from "./encoding";

/**
 * A room slug is `<salt>.<roomId>` (both base64url). It locates the room but doesn't let you in:
 * that takes either the name + password, or the key in a direct link's `#k=` fragment.
 */
export interface ParsedSlug {
  salt: Uint8Array;
  roomId: string;
}

const SLUG_RE = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/;

export function parseSlug(slug: string): ParsedSlug | null {
  const m = SLUG_RE.exec(slug.trim());
  if (!m) return null;
  try {
    const salt = fromBase64Url(m[1]!);
    const id = fromBase64Url(m[2]!);
    if (salt.length !== SALT_BYTES || id.length !== ROOM_ID_BYTES) return null;
    return { salt, roomId: m[2]! };
  } catch {
    return null;
  }
}

export function isRoomId(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}

export interface CreatedRoom extends RoomSecret {
  slug: string;
}

/**
 * Open the room for a name + password. The salt comes from the name, so the same name + password
 * always gives the same room: creating a call and joining one without the link are the same thing.
 */
export async function openRoom(name: string, password: string): Promise<CreatedRoom> {
  const salt = await roomSalt(name);
  const secret = await deriveRoom(name, password, salt);
  return { ...secret, slug: `${toBase64Url(salt)}.${secret.roomId}` };
}

export const createRoom = openRoom;

/** Join straight from a direct link's key. `null` if the slug or key is malformed. */
export async function joinFromLink(slug: string, linkKey: string): Promise<RoomSecret | null> {
  const parsed = parseSlug(slug);
  return parsed ? importLinkKey(parsed.roomId, toBase64Url(parsed.salt), linkKey) : null;
}

/**
 * Re-derive a room's secret from a slug (links without a key, including older random-salt links). Returns `null` when the name or password is wrong;
 * this check happens entirely on the device, before any network traffic.
 */
export async function unlockRoom(
  slug: string,
  name: string,
  password: string,
): Promise<RoomSecret | null> {
  const parsed = parseSlug(slug);
  if (!parsed) return null;
  const secret = await deriveRoom(name, password, parsed.salt);
  return roomIdsEqual(secret.roomId, parsed.roomId) ? secret : null;
}

export interface RoomLink {
  slug: string;
  /** Present for direct-join links; `null` means the joiner needs the name + password. */
  linkKey: string | null;
}

const LINK_KEY_RE = /[#?&]k=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;

/**
 * Accepts a bare slug, `https://host/r/<slug>` or `open2talk://r/<slug>`, optionally followed by
 * `#k=<key>` (or `?k=<key>`, used by the mobile app's internal routes).
 */
export function parseRoomLink(input: string): RoomLink | null {
  const text = input.trim();
  const m = /(?:^|\/r\/)([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/.exec(text);
  if (!m || !parseSlug(m[1]!)) return null;
  const k = LINK_KEY_RE.exec(text.slice(m.index + m[0].length));
  return { slug: m[1]!, linkKey: k ? k[1]! : null };
}

export function extractSlug(input: string): string | null {
  return parseRoomLink(input)?.slug ?? null;
}

/** Accepts a full link and returns its origin, so a native app can offer to use that host. */
export function extractHost(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** With `linkKey`, anyone who has the link can join directly. The fragment never reaches the server. */
export function roomUrl(host: string, slug: string, linkKey?: string): string {
  return `${host.replace(/\/+$/, "")}/r/${slug}${linkKey ? `#k=${linkKey}` : ""}`;
}

export function deepLink(slug: string, linkKey?: string): string {
  return `open2talk://r/${slug}${linkKey ? `#k=${linkKey}` : ""}`;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  ok: boolean;
  hint: string;
}

/**
 * Cheap heuristic. Anyone who sees a room id (the server, or someone with a key-less link) can try
 * to brute-force the password offline, so we nudge users toward long passwords.
 */
export function passwordStrength(password: string): PasswordStrength {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const len = password.length;
  let score = 0;
  if (len >= 8) score++;
  if (len >= 12) score++;
  if (len >= 16) score++;
  if (classes >= 3) score++;
  const s = Math.min(score, 4) as PasswordStrength["score"];
  const hint =
    len < 8
      ? "Use at least 8 characters"
      : s < 3
        ? "Longer passphrases are much harder to guess"
        : "Strong password";
  return { score: s, ok: len >= 8, hint };
}
