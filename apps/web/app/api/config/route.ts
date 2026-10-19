import { createHmac } from "node:crypto";
import type { IceConfig } from "@open2talk/core";
import { json, preflight } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * ICE servers for clients. TURN credentials are short-lived and derived with the coturn REST
 * scheme (`use-auth-secret`), so no user database is needed.
 */
export function GET() {
  const stun = list(process.env.STUN_URLS);
  const config: IceConfig = {
    iceServers: [{ urls: stun.length ? stun : ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
  };

  const turn = list(process.env.TURN_URLS);
  const secret = process.env.TURN_SECRET;
  if (turn.length && secret) {
    const ttl = Number(process.env.TURN_TTL_SECONDS) || 3600;
    const username = `${Math.floor(Date.now() / 1000) + ttl}:open2talk`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    config.iceServers.push({ urls: turn, username, credential });
  }

  return json(config);
}
