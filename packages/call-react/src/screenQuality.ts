import { DEFAULT_SCREEN_QUALITY, screenQualityPreset, type ScreenQuality } from "@open2talk/core";

const KEY = "open2talk.screenQuality";

/** The last screen-share quality this browser picked (kept per device, not per call). */
export function loadScreenQuality(): ScreenQuality {
  try {
    return screenQualityPreset(localStorage.getItem(KEY)).id;
  } catch {
    return DEFAULT_SCREEN_QUALITY;
  }
}

export function saveScreenQuality(quality: ScreenQuality): void {
  try {
    localStorage.setItem(KEY, quality);
  } catch {
    // private mode or blocked storage: the choice just isn't remembered
  }
}
