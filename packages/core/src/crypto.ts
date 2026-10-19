import { bytesEqual, fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from "./encoding";

/**
 * Minimal WebCrypto surface open2talk needs. Browsers, Node >= 20 and Electron expose it on
 * `globalThis.crypto`; React Native passes `react-native-quick-crypto` via `setCryptoProvider`.
 */
export interface CryptoProvider {
  subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

let provider: CryptoProvider | undefined;

export function setCryptoProvider(p: CryptoProvider): void {
  provider = p;
}

function getCrypto(): CryptoProvider {
  const p = provider ?? (globalThis.crypto as CryptoProvider | undefined);
  if (!p?.subtle) {
    throw new Error("WebCrypto is unavailable. Call setCryptoProvider() or use a secure context (https/localhost).");
  }
  return p;
}

export const PBKDF2_ITERATIONS = 310_000;
export const SALT_BYTES = 16;
export const ROOM_ID_BYTES = 16;
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface RoomSecret {
  /** Public routing identifier (base64url). Safe to send to the server. */
  roomId: string;
  /** AES-GCM key used to seal every signaling message. Never leaves the device. */
  key: CryptoKey;
}

export function randomBytes(n: number): Uint8Array {
  return getCrypto().getRandomValues(new Uint8Array(n));
}

export function randomId(bytes = 12): string {
  return toBase64Url(randomBytes(bytes));
}

/** Room names are case-insensitive and whitespace-trimmed; passwords are exact. */
export function normalizeRoomName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}

/**
 * Stretch (room name, password, salt) into an AES key and a public room id.
 * Same inputs always produce the same output, which is how a joiner proves they know the secret.
 */
export async function deriveRoom(
  name: string,
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<RoomSecret> {
  const { subtle } = getCrypto();
  const material = utf8Encode(`${normalizeRoomName(name)}\u0000${password.normalize("NFKC")}`);
  const baseKey = await subtle.importKey("raw", material as BufferSource, "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = new Uint8Array(
    await subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
      baseKey,
      (KEY_BYTES + ROOM_ID_BYTES) * 8,
    ),
  );
  const key = await subtle.importKey(
    "raw",
    bits.slice(0, KEY_BYTES) as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return { key, roomId: toBase64Url(bits.slice(KEY_BYTES)) };
}

export interface Sealed {
  iv: string;
  ct: string;
}

/** Encrypt a JSON value. `aad` binds the ciphertext to a context (we use the room id). */
export async function seal(key: CryptoKey, value: unknown, aad: string): Promise<Sealed> {
  const { subtle } = getCrypto();
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: utf8Encode(aad) as BufferSource },
    key,
    utf8Encode(JSON.stringify(value)) as BufferSource,
  );
  return { iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) };
}

/** Decrypt a sealed JSON value. Throws if the key is wrong or the data was tampered with. */
export async function open<T = unknown>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  const { subtle } = getCrypto();
  const plain = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(sealed.iv) as BufferSource,
      additionalData: utf8Encode(aad) as BufferSource,
    },
    key,
    fromBase64Url(sealed.ct) as BufferSource,
  );
  return JSON.parse(utf8Decode(new Uint8Array(plain))) as T;
}

export function roomIdsEqual(a: string, b: string): boolean {
  try {
    return bytesEqual(fromBase64Url(a), fromBase64Url(b));
  } catch {
    return false;
  }
}
