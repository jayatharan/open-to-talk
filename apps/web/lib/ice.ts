import { createHmac } from "node:crypto";
import type { IceConfig } from "@open2talk/core";

type IceServer = IceConfig["iceServers"][number];
type Env = Record<string, string | undefined>;

const CLOUDFLARE_API = "https://rtc.live.cloudflare.com/v1/turn/keys";
/** Cloudflare credentials are minted for a day and reused until half of that is left. */
const CLOUDFLARE_TTL_SECONDS = 86_400;
const CLOUDFLARE_TIMEOUT_MS = 3_000;

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function stunServers(env: Env = process.env): IceServer[] {
  const stun = list(env.STUN_URLS);
  return [{ urls: stun.length ? stun : ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
}

/** Self-hosted coturn with `use-auth-secret`: short-lived credentials, no user database. */
export function coturnServer(env: Env = process.env, now = Date.now()): IceServer | null {
  const turn = list(env.TURN_URLS);
  const secret = env.TURN_SECRET;
  if (!turn.length || !secret) return null;
  const ttl = Number(env.TURN_TTL_SECONDS) || 3600;
  const username = `${Math.floor(now / 1000) + ttl}:open2talk`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { urls: turn, username, credential };
}

/** Browsers block port 53, so Cloudflare's `:53` URLs would only make ICE wait for a timeout. */
function dropPort53(server: IceServer): IceServer | null {
  const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((u) => !/:53(\?|$)/.test(u));
  return urls.length ? { ...server, urls } : null;
}

let cached: { servers: IceServer[]; expiresAt: number } | null = null;

/** Clears the cached Cloudflare credentials (for tests). */
export function resetIceCache(): void {
  cached = null;
}

/**
 * Cloudflare Realtime TURN: the key id and API token stay on the server, and clients only get
 * short-lived credentials. Returns null when unconfigured or when Cloudflare can't be reached.
 */
export async function cloudflareServers(
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<IceServer[] | null> {
  const keyId = env.CLOUDFLARE_TURN_KEY_ID;
  const token = env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return null;
  if (cached && cached.expiresAt - now > (CLOUDFLARE_TTL_SECONDS * 1000) / 2) return cached.servers;

  try {
    const res = await fetchImpl(`${CLOUDFLARE_API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: CLOUDFLARE_TTL_SECONDS }),
      signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Cloudflare TURN responded with ${res.status}`);
    const body = (await res.json()) as { iceServers?: IceServer[] };
    const servers = (body.iceServers ?? []).map(dropPort53).filter((s): s is IceServer => s !== null);
    if (!servers.length) throw new Error("Cloudflare TURN returned no ICE servers");
    cached = { servers, expiresAt: now + CLOUDFLARE_TTL_SECONDS * 1000 };
    return servers;
  } catch (e) {
    console.warn("[open2talk] Cloudflare TURN unavailable, falling back to STUN", e);
    // Still-valid credentials beat none.
    return cached && cached.expiresAt > now ? cached.servers : null;
  }
}

/** ICE servers for clients: STUN, plus Cloudflare TURN and/or self-hosted coturn when configured. */
export async function iceConfig(env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<IceConfig> {
  const iceServers = stunServers(env);
  const cloudflare = await cloudflareServers(env, fetchImpl);
  if (cloudflare) iceServers.push(...cloudflare);
  const coturn = coturnServer(env);
  if (coturn) iceServers.push(coturn);
  return { iceServers };
}
