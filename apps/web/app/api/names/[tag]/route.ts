import { isRoomId } from "@open2talk/core";
import { clientIp, json, preflight, rateLimiter } from "@/lib/http";
import { nameInUse } from "@/lib/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const lookupLimit = rateLimiter(30, 60_000);

export function OPTIONS() {
  return preflight();
}

/** Lets "Create call" refuse a room name that already has a call running. */
export async function GET(req: Request, ctx: { params: Promise<{ tag: string }> }) {
  const { tag } = await ctx.params;
  if (!isRoomId(tag)) return json({ error: "bad-request" }, 400);
  if (!lookupLimit(clientIp(req))) return json({ error: "rate-limited" }, 429);
  return json({ inUse: nameInUse(tag) });
}
