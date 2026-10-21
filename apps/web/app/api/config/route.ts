import { json, preflight } from "@/lib/http";
import { iceConfig } from "@/lib/ice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * ICE servers for clients. TURN credentials are short-lived: minted by Cloudflare Realtime, or
 * derived with the coturn REST scheme (`use-auth-secret`), so no user database is needed.
 */
export async function GET() {
  return json(await iceConfig());
}
