import { PEER_TOKEN_HEADER } from "@open2talk/core";

/**
 * The API is public by design (desktop and mobile apps point at any self-hosted instance), and it
 * uses no cookies, so a wildcard origin is safe.
 */
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": `content-type, ${PEER_TOKEN_HEADER}`,
  "Access-Control-Max-Age": "86400",
};

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...corsHeaders, "cache-control": "no-store", ...extra } });
}

export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Fixed-window in-memory rate limiter. Good enough for a single-instance server. */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  let lastSweep = Date.now();
  return (key: string): boolean => {
    const now = Date.now();
    if (now - lastSweep > windowMs * 4) {
      for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      lastSweep = now;
    }
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= limit;
  };
}
