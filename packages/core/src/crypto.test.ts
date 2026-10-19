import { describe, expect, it } from "vitest";
import { deriveRoom, open, seal } from "./crypto";
import { fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from "./encoding";
import { createRoom, extractSlug, parseSlug, passwordStrength, unlockRoom } from "./slug";

describe("encoding", () => {
  it("round-trips base64url for all lengths", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
      expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
  });

  it("round-trips utf8", () => {
    const s = "héllo 👋 世界";
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });
});

describe("rooms", () => {
  it("creates a slug that the right credentials unlock", async () => {
    const room = await createRoom("Team Standup", "correct horse battery");
    expect(parseSlug(room.slug)).not.toBeNull();
    const unlocked = await unlockRoom(room.slug, "  team standup ", "correct horse battery");
    expect(unlocked?.roomId).toBe(room.roomId);
  });

  it("rejects a wrong password or room name", async () => {
    const room = await createRoom("Team Standup", "correct horse battery");
    expect(await unlockRoom(room.slug, "Team Standup", "wrong")).toBeNull();
    expect(await unlockRoom(room.slug, "Other room", "correct horse battery")).toBeNull();
  });

  it("gives different slugs for the same credentials (random salt)", async () => {
    const a = await createRoom("x", "password1");
    const b = await createRoom("x", "password1");
    expect(a.slug).not.toBe(b.slug);
  });

  it("extracts slugs from links", async () => {
    const { slug } = await createRoom("x", "password1");
    expect(extractSlug(`https://talk.example.com/r/${slug}`)).toBe(slug);
    expect(extractSlug(`open2talk://r/${slug}`)).toBe(slug);
    expect(extractSlug(slug)).toBe(slug);
    expect(extractSlug("https://example.com/r/nope")).toBeNull();
  });

  it("scores passwords", () => {
    expect(passwordStrength("short").ok).toBe(false);
    expect(passwordStrength("a much longer Passphrase 9").score).toBe(4);
  });
});

describe("seal/open", () => {
  const salt = new Uint8Array(16).fill(7);

  it("round-trips and binds to aad", async () => {
    const { key, roomId } = await deriveRoom("r", "p", salt, 1000);
    const sealed = await seal(key, { hello: "world" }, roomId);
    expect(await open(key, sealed, roomId)).toEqual({ hello: "world" });
    await expect(open(key, sealed, "other-room")).rejects.toThrow();
  });

  it("fails with the wrong key", async () => {
    const a = await deriveRoom("r", "p", salt, 1000);
    const b = await deriveRoom("r", "q", salt, 1000);
    const sealed = await seal(a.key, { x: 1 }, a.roomId);
    await expect(open(b.key, sealed, a.roomId)).rejects.toThrow();
  });

  it("detects tampering", async () => {
    const { key, roomId } = await deriveRoom("r", "p", salt, 1000);
    const sealed = await seal(key, { x: 1 }, roomId);
    const ct = fromBase64Url(sealed.ct);
    ct[0] = ct[0]! ^ 1;
    await expect(open(key, { iv: sealed.iv, ct: toBase64Url(ct) }, roomId)).rejects.toThrow();
  });
});

describe("normalizeHost", async () => {
  const { normalizeHost } = await import("./signaling");
  it("adds a sensible scheme", () => {
    expect(normalizeHost("talk.example.com/")).toBe("https://talk.example.com");
    expect(normalizeHost("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeHost("192.168.1.20:3000")).toBe("http://192.168.1.20:3000");
    expect(normalizeHost("https://x.y")).toBe("https://x.y");
    expect(normalizeHost("")).toBe("");
  });
});
