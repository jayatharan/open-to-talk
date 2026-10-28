import { ipcMain, screen, shell, type BrowserWindow, type Rectangle } from "electron";

/**
 * The picture-in-picture pop-out: the renderer opens a same-origin `about:blank` popup named
 * `o2t-pip` and renders a call tile into it. Here it becomes a small frameless window that floats
 * above every app (including full-screen ones) and remembers where it was left.
 */

export const POP_OUT_FRAME = "o2t-pip";

const DEFAULT_SIZE = { width: 360, height: 220 };
const MARGIN = 24;

export interface PopOutStore {
  getBounds(): Rectangle | undefined;
  setBounds(bounds: Rectangle): void;
}

/** Saved bounds, if they still sit mostly on a connected display. */
function restoredBounds(saved: Rectangle | undefined): Rectangle | null {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return null;
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x);
    const h = Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y);
    return w >= saved.width / 2 && h >= saved.height / 2;
  });
  return visible ? saved : null;
}

/** Bottom-right corner of the display the main window is on. */
function defaultBounds(main: BrowserWindow): Rectangle {
  const { workArea: a } = screen.getDisplayMatching(main.getBounds());
  return {
    ...DEFAULT_SIZE,
    x: a.x + a.width - DEFAULT_SIZE.width - MARGIN,
    y: a.y + a.height - DEFAULT_SIZE.height - MARGIN,
  };
}

export function setupPopOut(main: BrowserWindow, store: PopOutStore): void {
  main.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === POP_OUT_FRAME && url === "about:blank") {
      const bounds = restoredBounds(store.getBounds()) ?? defaultBounds(main);
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          ...bounds,
          minWidth: 200,
          minHeight: 120,
          frame: false,
          resizable: true,
          fullscreenable: false,
          minimizable: false,
          skipTaskbar: true,
          hasShadow: true,
          backgroundColor: "#050816",
          title: "open2talk",
          // An NSPanel floats over full-screen apps without taking focus away from them.
          ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
        },
      };
    }
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  main.webContents.on("did-create-window", (win, { frameName }) => {
    if (frameName !== POP_OUT_FRAME) return;
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setMenu(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!win.isDestroyed()) store.setBounds(win.getBounds());
      }, 300);
    };
    win.on("moved", save);
    win.on("resized", save);
    win.on("close", () => {
      clearTimeout(timer);
      store.setBounds(win.getBounds());
    });
  });
}

/** "Back to call" from the pop-out: `window.focus()` in the popup can't raise the main window. */
export function setupFocusMain(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("app:focus-main", () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}
