import { deriveRoom, randomBytes, roomIdsEqual, ROOM_ID_BYTES, SALT_BYTES, type RoomSecret } from "./crypto";
import { fromBase64Url, toBase64Url } from "./encoding";

/**
 * A room slug is `<salt>.<roomId>` (both base64url). It carries everything needed to find the
 * room, but nothing that lets you into it: the AES key is only derivable with the name + password.
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

/** Create a brand-new room from a name + password. */
export async function createRoom(name: string, password: string): Promise<CreatedRoom> {
  const salt = randomBytes(SALT_BYTES);
  const secret = await deriveRoom(name, password, salt);
  return { ...secret, slug: `${toBase64Url(salt)}.${secret.roomId}` };
}

/**
 * Re-derive a room's secret from a slug. Returns `null` when the name or password is wrong;
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

/** Accepts a bare slug, `https://host/r/<slug>` or `open2talk://r/<slug>` and returns the slug. */
export function extractSlug(input: string): string | null {
  const text = input.trim();
  if (parseSlug(text)) return text;
  const m = /\/r\/([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22})/.exec(text);
  return m && parseSlug(m[1]!) ? m[1]! : null;
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

export function roomUrl(host: string, slug: string): string {
  return `${host.replace(/\/+$/, "")}/r/${slug}`;
}

export function deepLink(slug: string): string {
  return `open2talk://r/${slug}`;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  ok: boolean;
  hint: string;
}

/** Cheap heuristic; the slug can be brute-forced offline so we nudge users toward long passwords. */
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
