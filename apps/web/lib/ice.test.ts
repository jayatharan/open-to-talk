import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudflareServers, iceConfig, resetIceCache } from "./ice";

const cf = { CLOUDFLARE_TURN_KEY_ID: "key123", CLOUDFLARE_TURN_API_TOKEN: "token456" };

function cloudflareReply() {
  return vi.fn(async () =>
    Response.json({
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
        {
          urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
          username: "u",
          credential: "c",
        },
      ],
    }),
  );
}

afterEach(() => {
  resetIceCache();
  vi.restoreAllMocks();
});

describe("ICE config", () => {
  it("serves STUN only when no TURN is configured", async () => {
    const fetchImpl = vi.fn();
    const config = await iceConfig({}, fetchImpl);
    expect(config.iceServers).toHaveLength(1);
    expect(config.iceServers[0]!.username).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("adds Cloudflare TURN credentials, without the port 53 URLs browsers block", async () => {
    const fetchImpl = cloudflareReply();
    const config = await iceConfig(cf, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bearer token456" }) }),
    );
    const turn = config.iceServers.find((s) => s.username === "u")!;
    expect(turn.urls).toEqual(["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"]);
    expect(JSON.stringify(config)).not.toContain(":53");
  });

  it("reuses credentials instead of calling Cloudflare on every join", async () => {
    const fetchImpl = cloudflareReply();
    const now = Date.now();
    await cloudflareServers(cf, fetchImpl, now);
    await cloudflareServers(cf, fetchImpl, now + 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await cloudflareServers(cf, fetchImpl, now + 13 * 3600_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to STUN when Cloudflare fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const config = await iceConfig(cf, fetchImpl);
    expect(config.iceServers).toHaveLength(1);
  });

  it("can combine Cloudflare with self-hosted coturn", async () => {
    const config = await iceConfig({ ...cf, TURN_URLS: "turn:turn.example.com:3478", TURN_SECRET: "s" }, cloudflareReply());
    expect(config.iceServers.map((s) => s.urls)).toContainEqual(["turn:turn.example.com:3478"]);
  });
});
