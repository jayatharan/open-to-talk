import { isRoomId, MAX_ENVELOPE_BYTES, PEER_TOKEN_HEADER, signalRequestSchema } from "@open2talk/core";
import { corsHeaders, json, preflight, rateLimiter } from "@/lib/http";
import { relay } from "@/lib/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A full mesh negotiation bursts dozens of ICE candidates, so allow a generous per-peer rate.
const signalLimit = rateLimiter(300, 10_000);

export function OPTIONS() {
  return preflight();
}

/** Relay one sealed envelope to a single peer (`to`) or everyone else in the room. */
export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const token = req.headers.get(PEER_TOKEN_HEADER) ?? "";
  if (!isRoomId(roomId) || !token) return json({ error: "bad-request" }, 400);
  if (!signalLimit(token)) return json({ error: "rate-limited" }, 429);

  const text = await req.text();
  if (text.length > MAX_ENVELOPE_BYTES * 1.5) return json({ error: "too-large" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const parsed = signalRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad-request" }, 400);

  switch (relay(roomId, token, parsed.data)) {
    case "ok":
      return new Response(null, { status: 204, headers: corsHeaders });
    case "not-found":
      return json({ error: "peer-not-found" }, 404);
    case "unauthorized":
      return json({ error: "unauthorized" }, 401);
  }
}
