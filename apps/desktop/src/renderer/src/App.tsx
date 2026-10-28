import {
  CallView,
  DirectJoinForm,
  HomePanel,
  JoinRoomForm,
  ScreenSourcePicker,
  ShareLink,
  type RemoteControlHost,
  type ScreenSource,
} from "@open2talk/call-react";
import { checkHost, extractHost, joinFromLink, normalizeHost, parseRoomLink, roomUrl, type RoomLink, type RoomSecret } from "@open2talk/core";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import logo from "./assets/logo.svg";

type Screen =
  | { name: "loading" }
  | { name: "settings"; firstRun: boolean }
  | { name: "home" }
  | { name: "share"; slug: string; secret: RoomSecret; displayName: string }
  | { name: "join"; slug: string }
  | { name: "direct"; slug: string; secret: RoomSecret }
  | { name: "call"; slug: string; secret: RoomSecret; displayName: string };

const api = window.open2talk;

/** Lets others in the call control this computer while it shares a whole screen. */
const remoteControl: RemoteControlHost | undefined = api.remoteControl.supported
  ? {
      canControlShare: api.remoteControl.canControlShare,
      begin: api.remoteControl.begin,
      input: api.remoteControl.input,
      end: () => void api.remoteControl.end(),
      onStop: api.remoteControl.onStop,
    }
  : undefined;

/** Call tiles can pop out into a floating always-on-top window. */
const popOut = { onBackToCall: () => void api.focusMainWindow() };

export function App() {
  const [host, setHost] = useState("");
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [picker, setPicker] = useState<{ sources: ScreenSource[]; audioSupported: boolean } | null>(null);
  const pickerResolve = useRef<((ok: boolean) => void) | null>(null);

  // A direct link (with #k=) only needs a display name; a key-less one needs the name + password.
  const openRoomLink = useCallback(async ({ slug, linkKey }: RoomLink) => {
    const secret = linkKey ? await joinFromLink(slug, linkKey) : null;
    setScreen(secret ? { name: "direct", slug, secret } : { name: "join", slug });
  }, []);

  const openLink = useCallback(
    (link: string) => {
      const parsed = parseRoomLink(link);
      if (parsed) void openRoomLink(parsed);
    },
    [openRoomLink],
  );

  useEffect(() => {
    void (async () => {
      const settings = await api.getSettings();
      setHost(settings.host);
      if (!settings.host) {
        setScreen({ name: "settings", firstRun: true });
        return;
      }
      setScreen({ name: "home" });
      const link = await api.consumeDeepLink();
      if (link) openLink(link);
    })();
    return api.onDeepLink(openLink);
  }, [openLink]);

  // Electron has no built-in chooser, so ask the user before getDisplayMedia() runs.
  const beforeScreenShare = useCallback(async () => {
    const { sources, audioSupported } = await api.getScreenSources();
    return new Promise<boolean>((resolve) => {
      pickerResolve.current = resolve;
      setPicker({ sources, audioSupported });
    });
  }, []);

  async function onPick(id: string | null) {
    await api.selectScreenSource(id);
    setPicker(null);
    pickerResolve.current?.(id !== null);
    pickerResolve.current = null;
  }

  if (screen.name === "loading") return null;

  if (screen.name === "call") {
    return (
      <>
        <CallView
          host={host}
          secret={screen.secret}
          displayName={screen.displayName}
          shareUrl={roomUrl(host, screen.slug, screen.secret.linkKey)}
          onLeave={() => setScreen({ name: "home" })}
          beforeScreenShare={beforeScreenShare}
          remoteControl={remoteControl}
          stopControlShortcut={api.remoteControl.stopShortcut}
          popOut={popOut}
        />
        {picker && <ScreenSourcePicker {...picker} onPick={(id) => void onPick(id)} />}
      </>
    );
  }

  return (
    <div className="d-shell">
      <header className="d-top">
        <span className="d-brand">
          <img src={logo} alt="" width={22} height={22} />
          open2talk
        </span>
        <div>
          {host && <span className="d-host">{host}</span>}
          {screen.name !== "settings" && (
            <button className="o2t-btn" onClick={() => setScreen({ name: "settings", firstRun: false })}>
              Settings
            </button>
          )}
        </div>
      </header>
      <main className="d-main">
        {screen.name === "settings" && (
          <SettingsForm
            initial={host}
            firstRun={screen.firstRun}
            onSaved={(h) => {
              setHost(h);
              setScreen({ name: "home" });
            }}
            onCancel={screen.firstRun ? undefined : () => setScreen({ name: "home" })}
          />
        )}
        {screen.name === "home" && (
          <>
            <HomePanel
              host={host}
              onCreated={(r) => setScreen({ name: "share", ...r })}
              onJoined={(r) => setScreen({ name: "call", ...r })}
              onLink={(link) => void openRoomLink(link)}
              linkHint={(link) => (
                <OtherHostHint
                  host={host}
                  link={link}
                  onUseHost={async (h) => {
                    await api.setSettings({ host: h });
                    setHost(h);
                  }}
                />
              )}
            />
          </>
        )}
        {screen.name === "share" && (
          <ShareLink
            url={roomUrl(host, screen.slug, screen.secret.linkKey)}
            onJoin={() => setScreen({ ...screen, name: "call" })}
          />
        )}
        {screen.name === "join" && (
          <JoinRoomForm
            slug={screen.slug}
            onUnlocked={(r) => setScreen({ name: "call", ...r })}
          />
        )}
        {screen.name === "direct" && (
          <DirectJoinForm
            onJoin={(displayName) => setScreen({ name: "call", slug: screen.slug, secret: screen.secret, displayName })}
          />
        )}
      </main>
    </div>
  );
}

function SettingsForm({
  initial,
  firstRun,
  onSaved,
  onCancel,
}: {
  initial: string;
  firstRun: boolean;
  onSaved: (host: string) => void;
  onCancel?: () => void;
}) {
  // Suggest the public instance on first run; any self-hosted server works too.
  const [value, setValue] = useState(initial || "https://open2talk.cosmerg.com");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const host = normalizeHost(value);
    setBusy(true);
    setError(null);
    const problem = await checkHost(host);
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    await api.setSettings({ host });
    onSaved(host);
  }

  return (
    <form className="o2t-card o2t-form" onSubmit={submit}>
      <h2>{firstRun ? "Welcome to open2talk" : "Settings"}</h2>
      <p className="o2t-muted">
        Enter the address of the open2talk server you want to use. Anyone can self-host one; it stores nothing.
      </p>
      <label>
        Server host
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://talk.example.com"
          autoFocus
          required
        />
      </label>
      {error && <p className="o2t-error">{error}</p>}
      <button className="o2t-btn o2t-primary" disabled={busy}>
        {busy ? "Checking…" : "Save"}
      </button>
      {onCancel && (
        <button type="button" className="o2t-btn" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}

/** A pasted link can point at a different server than the one this app is set to. */
function OtherHostHint({ host, link, onUseHost }: { host: string; link: string; onUseHost: (host: string) => Promise<void> }) {
  const linkHost = extractHost(link);
  if (!linkHost || linkHost === host) return null;
  return (
    <p className="o2t-hint">
      This link is for <strong>{linkHost}</strong>, but you're using {host || "no server"}.{" "}
      <button type="button" onClick={() => void onUseHost(linkHost)}>
        Switch to {linkHost}
      </button>
    </p>
  );
}
