import type { DesktopApi } from "../../preload";

declare global {
  interface Window {
    open2talk: DesktopApi;
  }
}

export {};
