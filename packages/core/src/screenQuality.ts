/** Screen-share quality presets: a cap on the sent resolution plus a matching bitrate. */
export type ScreenQuality = "720p" | "1080p" | "1440p" | "source";

export interface ScreenQualityPreset {
  id: ScreenQuality;
  label: string;
  /** Largest frame height sent; null sends the captured size unscaled. */
  maxHeight: number | null;
  maxBitrate: number;
  maxFramerate: number;
}

export const SCREEN_QUALITIES: readonly ScreenQualityPreset[] = [
  { id: "720p", label: "720p", maxHeight: 720, maxBitrate: 1_500_000, maxFramerate: 30 },
  { id: "1080p", label: "1080p", maxHeight: 1080, maxBitrate: 3_000_000, maxFramerate: 30 },
  { id: "1440p", label: "1440p", maxHeight: 1440, maxBitrate: 5_000_000, maxFramerate: 30 },
  { id: "source", label: "Source", maxHeight: null, maxBitrate: 8_000_000, maxFramerate: 30 },
];

export const DEFAULT_SCREEN_QUALITY: ScreenQuality = "1080p";

export function screenQualityPreset(id: string | null | undefined): ScreenQualityPreset {
  return SCREEN_QUALITIES.find((q) => q.id === id) ?? SCREEN_QUALITIES.find((q) => q.id === DEFAULT_SCREEN_QUALITY)!;
}

/** How much to scale a frame of `height` down so it fits the preset (always >= 1). */
export function scaleDownFor(preset: ScreenQualityPreset, height: number | undefined): number {
  if (!preset.maxHeight || !height || height <= preset.maxHeight) return 1;
  return height / preset.maxHeight;
}
