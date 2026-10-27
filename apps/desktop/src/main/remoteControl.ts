import { globalShortcut, ipcMain, screen, systemPreferences, type BrowserWindow, type DesktopCapturerSource } from "electron";

/**
 * Injects another person's pointer and keyboard input into this computer while they control the
 * screen being shared. The renderer decides who may control it; this side only acts between
 * `rc:begin` and `rc:end`, only for a whole-screen share, and validates every event again.
 */

/** The subset of libnut (prebuilt N-API binaries from nut.js) used here. */
interface Libnut {
  moveMouse(x: number, y: number): void;
  dragMouse(x: number, y: number): void;
  mouseToggle(down: "down" | "up", button: "left" | "middle" | "right"): void;
  mouseClick(button: "left" | "middle" | "right", double: boolean): void;
  scrollMouse(x: number, y: number): void;
  keyToggle(key: string, down: "down" | "up"): void;
  setMouseDelay(ms: number): void;
  setKeyboardDelay(ms: number): void;
}

type Input =
  | { k: "move"; x: number; y: number }
  | { k: "down" | "up"; b: 0 | 1 | 2; x: number; y: number }
  | { k: "wheel"; dx: number; dy: number }
  | { k: "key"; code: string; down: boolean };

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";

/** Remote control works on macOS and Windows. */
export const remoteControlSupported = isMac || isWin;

/** Takes control back from whoever has it, from anywhere. */
const STOP_SHORTCUT = isMac ? "Command+Shift+Escape" : "Control+Alt+Shift+Escape";

const BUTTONS = ["left", "middle", "right"] as const;
const MAX_WHEEL = 2000;
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_SLOP = 5;

/** KeyboardEvent.code (physical key, US layout) → libnut key name. Anything else is dropped. */
const KEYS: Record<string, string> = {
  Backspace: "backspace",
  Delete: "delete",
  Enter: "enter",
  NumpadEnter: "enter",
  Tab: "tab",
  Escape: "escape",
  Space: "space",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  Insert: "insert",
  CapsLock: "caps_lock",
  ShiftLeft: "shift",
  ShiftRight: "right_shift",
  ControlLeft: "control",
  ControlRight: "right_control",
  AltLeft: "alt",
  AltRight: "right_alt",
  MetaLeft: isMac ? "cmd" : "win",
  MetaRight: isMac ? "right_cmd" : "right_win",
  ContextMenu: "menu",
  PrintScreen: "printscreen",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  NumpadDecimal: "numpad_decimal",
  NumpadAdd: "add",
  NumpadSubtract: "subtract",
  NumpadMultiply: "multiply",
  NumpadDivide: "divide",
};
for (let i = 0; i < 26; i++) {
  const c = String.fromCharCode(97 + i);
  KEYS[`Key${c.toUpperCase()}`] = c;
}
for (let i = 0; i <= 9; i++) {
  KEYS[`Digit${i}`] = String(i);
  KEYS[`Numpad${i}`] = `numpad_${i}`;
}
for (let i = 1; i <= 24; i++) KEYS[`F${i}`] = `f${i}`;

let libnut: Libnut | null | undefined;

function loadLibnut(): Libnut | null {
  if (libnut !== undefined) return libnut;
  try {
    // Loaded at runtime from node_modules (kept out of the bundle, unpacked from the asar).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    libnut = require(isWin ? "@nut-tree-fork/libnut-win32" : "@nut-tree-fork/libnut-darwin") as Libnut;
    libnut.setMouseDelay(0);
    libnut.setKeyboardDelay(0);
  } catch (e) {
    console.error("[open2talk] remote control unavailable:", e);
    libnut = null;
  }
  return libnut;
}

/** The display being shared; null for a window share (which can't be controlled). */
let sharedDisplayId: string | null = null;
let active = false;
const heldKeys = new Set<string>();
const heldButtons = new Set<(typeof BUTTONS)[number]>();
let lastDown: { at: number; x: number; y: number; button: string } | null = null;
let swallowUp: string | null = null;

/** Called with each source handed to getDisplayMedia. */
export function noteSharedSource(source: DesktopCapturerSource): void {
  sharedDisplayId = source.id.startsWith("screen:") ? source.display_id || "primary" : null;
}

function targetDisplay(): Electron.Display {
  return screen.getAllDisplays().find((d) => String(d.id) === sharedDisplayId) ?? screen.getPrimaryDisplay();
}

/** 0..1 on the shared display → global coordinates for libnut (points on macOS, pixels on Windows). */
function toScreen(x: number, y: number): { x: number; y: number } {
  const { bounds } = targetDisplay();
  const p = {
    x: Math.round(bounds.x + Math.min(Math.max(x, 0), 1) * (bounds.width - 1)),
    y: Math.round(bounds.y + Math.min(Math.max(y, 0), 1) * (bounds.height - 1)),
  };
  return isWin ? screen.dipToScreenPoint(p) : p;
}

const unit = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

function parse(raw: unknown): Input | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if ((e.k === "move" || e.k === "down" || e.k === "up") && unit(e.x) && unit(e.y)) {
    if (e.k === "move") return { k: "move", x: e.x, y: e.y };
    return e.b === 0 || e.b === 1 || e.b === 2 ? { k: e.k, b: e.b, x: e.x, y: e.y } : null;
  }
  if (e.k === "wheel" && typeof e.dx === "number" && typeof e.dy === "number" && Number.isFinite(e.dx) && Number.isFinite(e.dy)) {
    return { k: "wheel", dx: Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, e.dx)), dy: Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, e.dy)) };
  }
  if (e.k === "key" && typeof e.code === "string" && typeof e.down === "boolean") return { k: "key", code: e.code, down: e.down };
  return null;
}

function inject(nut: Libnut, e: Input): void {
  switch (e.k) {
    case "move": {
      const p = toScreen(e.x, e.y);
      // macOS only treats a move as a drag when it's sent as one.
      if (heldButtons.size && isMac) nut.dragMouse(p.x, p.y);
      else nut.moveMouse(p.x, p.y);
      break;
    }
    case "down": {
      const p = toScreen(e.x, e.y);
      const button = BUTTONS[e.b];
      nut.moveMouse(p.x, p.y);
      const now = Date.now();
      const double =
        isMac &&
        lastDown?.button === button &&
        now - lastDown.at < DOUBLE_CLICK_MS &&
        Math.abs(lastDown.x - p.x) <= DOUBLE_CLICK_SLOP &&
        Math.abs(lastDown.y - p.y) <= DOUBLE_CLICK_SLOP;
      if (double) {
        // macOS needs the click count on the event to see a double click; libnut sets it here.
        nut.mouseClick(button, true);
        swallowUp = button;
        lastDown = null;
      } else {
        nut.mouseToggle("down", button);
        heldButtons.add(button);
        lastDown = { at: now, x: p.x, y: p.y, button };
      }
      break;
    }
    case "up": {
      const button = BUTTONS[e.b];
      if (swallowUp === button) {
        swallowUp = null;
        break;
      }
      if (!heldButtons.delete(button)) break;
      const p = toScreen(e.x, e.y);
      if (isMac) nut.dragMouse(p.x, p.y);
      else nut.moveMouse(p.x, p.y);
      nut.mouseToggle("up", button);
      break;
    }
    case "wheel": {
      // Browser deltas are pixels with positive = down/right; the OS scrolls the other way.
      if (isMac) nut.scrollMouse(Math.round(-e.dx), Math.round(-e.dy));
      else nut.scrollMouse(Math.round(e.dx * 1.2), Math.round(-e.dy * 1.2)); // 100px ≈ one 120-unit notch
      break;
    }
    case "key": {
      const key = KEYS[e.code];
      if (!key) break;
      if (e.down) heldKeys.add(key);
      else if (!heldKeys.delete(key)) break;
      nut.keyToggle(key, e.down ? "down" : "up");
      break;
    }
  }
}

function releaseAll(): void {
  const nut = libnut;
  if (!nut) return;
  for (const key of heldKeys) {
    try {
      nut.keyToggle(key, "up");
    } catch {
      // keep releasing the rest
    }
  }
  for (const button of heldButtons) {
    try {
      nut.mouseToggle("up", button);
    } catch {
      // keep releasing the rest
    }
  }
  heldKeys.clear();
  heldButtons.clear();
  lastDown = null;
  swallowUp = null;
}

function end(): void {
  releaseAll();
  if (active) globalShortcut.unregister(STOP_SHORTCUT);
  active = false;
}

export function setupRemoteControl(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("rc:can-control", () => remoteControlSupported && sharedDisplayId !== null);

  /** Resolves null when ready, or a message explaining why control can't be given. */
  ipcMain.handle("rc:begin", (): string | null => {
    if (!remoteControlSupported) return "Remote control isn't supported on this OS yet.";
    if (sharedDisplayId === null) return "Only a whole-screen share can be controlled, not a single window.";
    if (isMac && !systemPreferences.isTrustedAccessibilityClient(true)) {
      return "To let others control your screen, allow open2talk in System Settings → Privacy & Security → Accessibility, then try again.";
    }
    if (!loadLibnut()) return "Remote control isn't available in this build.";
    end();
    active = true;
    if (
      !globalShortcut.register(STOP_SHORTCUT, () => {
        end();
        getWindow()?.webContents.send("rc:stop");
      })
    ) {
      console.warn(`[open2talk] could not register ${STOP_SHORTCUT}`);
    }
    return null;
  });

  ipcMain.on("rc:input", (e, raw: unknown) => {
    // Only the app's own window may send input, and only while control is on.
    if (!active || e.sender !== getWindow()?.webContents) return;
    const input = parse(raw);
    const nut = libnut;
    if (!input || !nut) return;
    try {
      inject(nut, input);
    } catch (err) {
      console.warn("[open2talk] could not inject input", err);
    }
  });

  ipcMain.handle("rc:end", () => end());
}

/** Never leave keys held down or the shortcut registered. */
export function shutdownRemoteControl(): void {
  end();
}
