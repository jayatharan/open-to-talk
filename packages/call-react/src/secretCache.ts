import type { RoomSecret } from "@open2talk/core";

/**
 * In-memory hand-off so the creator of a room can jump straight into it without retyping the
 * password. Lives only for the current page session and is never persisted.
 */
const cache = new Map<string, RoomSecret>();

export function rememberSecret(slug: string, secret: RoomSecret): void {
  cache.set(slug, secret);
}

export function takeSecret(slug: string): RoomSecret | undefined {
  const s = cache.get(slug);
  cache.delete(slug);
  return s;
}

const NAME_KEY = "open2talk:displayName";

export function loadDisplayName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveDisplayName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // storage unavailable (private mode); not important
  }
}
