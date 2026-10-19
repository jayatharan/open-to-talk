import { describe, expect, it } from "vitest";
import { linkPlan } from "./mesh";
import { SCREEN_QUALITIES, scaleDownFor, screenQualityPreset } from "./screenQuality";

const person = (id: string) => ({ id, state: {} });
const screenOf = (id: string, owner: string) => ({ id, state: { role: "screen" as const, owner } });

describe("linkPlan", () => {
  it("keeps the existing rule between people: the listener of a broadcast hello offers", () => {
    expect(linkPlan({ id: "a" }, person("b"), false)).toBe("offer");
    expect(linkPlan({ id: "a" }, person("b"), true)).toBe("answer");
  });

  it("has a screen share offer to every other person, and those people answer", () => {
    const self = { id: "s", role: "screen" as const, owner: "a" };
    expect(linkPlan(self, person("b"), false)).toBe("offer");
    expect(linkPlan(self, person("b"), true)).toBe("offer");
    expect(linkPlan({ id: "b" }, screenOf("s", "a"), false)).toBe("answer");
    expect(linkPlan({ id: "b" }, screenOf("s", "a"), true)).toBe("answer");
  });

  it("never links a screen share to its owner or to another screen share", () => {
    const self = { id: "s", role: "screen" as const, owner: "a" };
    expect(linkPlan(self, person("a"), false)).toBe("skip");
    expect(linkPlan({ id: "a" }, screenOf("s", "a"), false)).toBe("skip");
    expect(linkPlan(self, screenOf("t", "b"), false)).toBe("skip");
  });
});

describe("screen quality", () => {
  it("scales down only frames taller than the preset", () => {
    expect(scaleDownFor(screenQualityPreset("720p"), 1440)).toBe(2);
    expect(scaleDownFor(screenQualityPreset("1080p"), 720)).toBe(1);
    expect(scaleDownFor(screenQualityPreset("source"), 2160)).toBe(1);
    expect(scaleDownFor(screenQualityPreset("1080p"), undefined)).toBe(1);
  });

  it("falls back to the default preset for unknown ids", () => {
    expect(screenQualityPreset("8k").id).toBe("1080p");
    expect(SCREEN_QUALITIES.map((q) => q.id)).toEqual(["720p", "1080p", "1440p", "source"]);
  });
});
