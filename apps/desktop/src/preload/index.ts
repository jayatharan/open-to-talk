import { contextBridge, ipcRenderer } from "electron";

export interface DesktopSettings {
  host: string;
}

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  kind: "screen" | "window";
}

const api = {
  platform: process.platform,
  getSettings: (): Promise<DesktopSettings> => ipcRenderer.invoke("settings:get"),
  setSettings: (s: DesktopSettings): Promise<DesktopSettings> => ipcRenderer.invoke("settings:set", s),
  getScreenSources: (): Promise<{ audioSupported: boolean; sources: DesktopSource[] }> =>
    ipcRenderer.invoke("screen:sources"),
  selectScreenSource: (id: string | null): Promise<void> => ipcRenderer.invoke("screen:select", id),
  consumeDeepLink: (): Promise<string | null> => ipcRenderer.invoke("app:consume-deeplink"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("app:open-external", url),
  /** Remote control of this computer's shared screen (macOS and Windows). */
  remoteControl: {
    supported: process.platform === "darwin" || process.platform === "win32",
    stopShortcut: process.platform === "darwin" ? "⌘⇧Esc" : "Ctrl+Alt+Shift+Esc",
    canControlShare: (): Promise<boolean> => ipcRenderer.invoke("rc:can-control"),
    /** Resolves null when ready, or why control can't be given (e.g. missing permission). */
    begin: (): Promise<string | null> => ipcRenderer.invoke("rc:begin"),
    input: (e: unknown): void => ipcRenderer.send("rc:input", e),
    end: (): Promise<void> => ipcRenderer.invoke("rc:end"),
    onStop: (fn: () => void): (() => void) => {
      const listener = () => fn();
      ipcRenderer.on("rc:stop", listener);
      return () => ipcRenderer.removeListener("rc:stop", listener);
    },
  },
  onDeepLink: (fn: (url: string) => void): (() => void) => {
    const listener = (_e: unknown, url: string) => fn(url);
    ipcRenderer.on("deeplink", listener);
    return () => ipcRenderer.removeListener("deeplink", listener);
  },
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld("open2talk", api);
