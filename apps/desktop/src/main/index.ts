import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell, systemPreferences } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

const PROTOCOL = "open2talk";

// ------------------------------------------------------------------ system audio capture

const macMajor = process.platform === "darwin" ? Number(release().split(".")[0]) - 9 : 0; // Darwin 22 = macOS 13
/** Windows supports loopback natively; macOS 13+ via ScreenCaptureKit (Chromium feature flags). */
const systemAudioSupported = process.platform === "win32" || macMajor >= 13;
if (process.platform === "darwin" && systemAudioSupported) {
  app.commandLine.appendSwitch(
    "enable-features",
    "MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride",
  );
}

// ------------------------------------------------------------------ settings (plain JSON, no DB)

interface Settings {
  host: string;
}

const settingsPath = () => join(app.getPath("userData"), "settings.json");

function readSettings(): Settings {
  try {
    return { host: "", ...(JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<Settings>) };
  } catch {
    return { host: "" };
  }
}

function writeSettings(next: Settings): void {
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
}

// ------------------------------------------------------------------ deep links

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

function handleDeepLink(url: string | undefined): void {
  if (!url?.startsWith(`${PROTOCOL}://`)) return;
  if (mainWindow) {
    mainWindow.webContents.send("deeplink", url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingDeepLink = url;
  }
}

if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => handleDeepLink(argv.find((a) => a.startsWith(`${PROTOCOL}://`))));
}
app.on("open-url", (e, url) => {
  e.preventDefault();
  handleDeepLink(url);
});
pendingDeepLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`)) ?? null;

// ------------------------------------------------------------------ screen capture

let selectedSourceId: string | null = null;

ipcMain.handle("screen:sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false,
  });
  return {
    audioSupported: systemAudioSupported,
    sources: sources
      .filter((s) => s.name !== "open2talk")
      .map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        kind: s.id.startsWith("screen:") ? "screen" : "window",
      })),
  };
});

ipcMain.handle("screen:select", (_e, id: string | null) => {
  selectedSourceId = id;
});

function setupSession(): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(["media", "display-capture", "clipboard-sanitized-write", "fullscreen"].includes(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) =>
    ["media", "display-capture", "clipboard-sanitized-write"].includes(permission),
  );

  // getDisplayMedia() in the renderer lands here; the renderer picks a source first via our picker.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const id = selectedSourceId;
    selectedSourceId = null;
    if (!id) return callback(null);
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
    const source = sources.find((s) => s.id === id);
    if (!source) return callback(null);
    callback({
      video: source,
      ...(request.audioRequested && systemAudioSupported ? { audio: "loopback" as const } : {}),
    });
  });
}

// ------------------------------------------------------------------ window

ipcMain.handle("settings:get", () => readSettings());
ipcMain.handle("settings:set", (_e, next: Settings) => {
  writeSettings({ host: String(next.host ?? "") });
  return readSettings();
});
ipcMain.handle("app:consume-deeplink", () => {
  const link = pendingDeepLink;
  pendingDeepLink = null;
  return link;
});
ipcMain.handle("app:open-external", (_e, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url);
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 420,
    minHeight: 560,
    title: "open2talk",
    backgroundColor: "#0d0f12",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Calls play remote audio and meter the local mic; never wait for a click to start audio.
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => (mainWindow = null));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://") && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "\0")) e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    // Trigger the macOS privacy prompts up front.
    await systemPreferences.askForMediaAccess("microphone").catch(() => false);
    await systemPreferences.askForMediaAccess("camera").catch(() => false);
  }
  setupSession();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
