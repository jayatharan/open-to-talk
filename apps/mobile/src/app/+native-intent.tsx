import { parseRoomLink } from "@open2talk/core";

/**
 * Expo Router drops URL fragments, but a direct-join link carries the room key in `#k=`. Move it
 * into a route param before routing; it only travels inside the app, never to the server.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const link = parseRoomLink(path);
  if (!link) return path;
  return `/r/${link.slug}${link.linkKey ? `?k=${link.linkKey}` : ""}`;
}
