import { isRoomId, peerIdSchema, type ServerEvent } from "@open2talk/core";
import { clientIp, corsHeaders, json, preflight, rateLimiter } from "@/lib/http";
import { joinRoom, leaveRoom } from "@/lib/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const connectLimit = rateLimiter(30, 60_000);

export function OPTIONS() {
  return preflight();
}

/** Server-Sent Events stream: one per participant. Delivers presence and sealed signaling envelopes. */
export async function GET(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const peerId = params.get("peer") ?? "";
  const role = params.get("role") === "screen" ? "screen" : "person";
  const nameTag = params.get("name") ?? undefined;
  if (!isRoomId(roomId) || !peerIdSchema.safeParse(peerId).success || (nameTag && !isRoomId(nameTag))) {
    return json({ error: "bad-request" }, 400);
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const sink = {
        send: (event: ServerEvent) => write(`data: ${JSON.stringify(event)}\n\n`),
        close: () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // already closed
          }
        },
      };
      // Tell EventSource to wait a bit before its own auto-retry; the client also manages backoff.
      write("retry: 3000\n\n");
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);

      if (!connectLimit(clientIp(req))) {
        sink.send({ type: "error", code: "rate-limited", message: "Too many connection attempts, try again shortly." });
        sink.close();
        return;
      }

      const result = joinRoom(roomId, peerId, sink, role, nameTag);
      if (!result.ok) {
        sink.send(
          result.reason === "screen-limit"
            ? { type: "error", code: "screen-limit", message: "Too many screens are already being shared in this call." }
            : { type: "error", code: "room-full", message: "This call is full." },
        );
        sink.close();
        return;
      }
      cleanup = () => {
        sink.close();
        leaveRoom(roomId, peerId, result.token);
      };
      req.signal.addEventListener("abort", () => cleanup(), { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
