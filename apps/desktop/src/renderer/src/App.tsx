import {
  CallView,
  CreateRoomForm,
  JoinRoomForm,
  ScreenSourcePicker,
  ShareLink,
  type ScreenSource,
} from "@open2talk/call-react";
import { checkHost, extractHost, extractSlug, normalizeHost, roomUrl, type RoomSecret } from "@open2talk/core";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Screen =
  | { name: "loading" }
  | { name: "settings"; firstRun: boolean }
  | { name: "home" }
  | { name: "share"; slug: string; secret: RoomSecret; displayName: string }
  | { name: "join"; slug: string }
  | { name: "call"; slug: string; secret: RoomSecret; displayName: string };

const api = window.open2talk;

export function App() {
  const [host, setHost] = useState("");
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [picker, setPicker] = useState<{ sources: ScreenSource[]; audioSupported: boolean } | null>(null);
  const pickerResolve = useRef<((ok: boolean) => void) | null>(null);

  const openLink = useCallback((link: string) => {
    const slug = extractSlug(link);
    if (slug) setScreen({ name: "join", slug });
  }, []);

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
          shareUrl={roomUrl(host, screen.slug)}
          onLeave={() => setScreen({ name: "home" })}
          beforeScreenShare={beforeScreenShare}
        />
        {picker && <ScreenSourcePicker {...picker} onPick={(id) => void onPick(id)} />}
      </>
    );
  }

  return (
    <div className="d-shell">
      <header className="d-top">
        <span className="d-brand">open2talk</span>
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
            <CreateRoomForm onCreated={(r) => setScreen({ name: "share", ...r })} />
            <JoinByLink host={host} onSlug={(slug) => setScreen({ name: "join", slug })} onUseHost={async (h) => {
              await api.setSettings({ host: h });
              setHost(h);
            }} />
          </>
        )}
        {screen.name === "share" && (
          <ShareLink
            url={roomUrl(host, screen.slug)}
            onJoin={() => setScreen({ ...screen, name: "call" })}
          />
        )}
        {screen.name === "join" && (
          <JoinRoomForm
            slug={screen.slug}
            onUnlocked={({ secret, displayName }) => setScreen({ name: "call", slug: screen.slug, secret, displayName })}
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

function JoinByLink({
  host,
  onSlug,
  onUseHost,
}: {
  host: string;
  onSlug: (slug: string) => void;
  onUseHost: (host: string) => Promise<void>;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const linkHost = extractHost(link);
  const otherHost = linkHost && linkHost !== host ? linkHost : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const slug = extractSlug(link);
    if (!slug) {
      setError("That doesn't look like an open2talk call link.");
      return;
    }
    onSlug(slug);
  }

  return (
    <form className="o2t-card o2t-form" onSubmit={submit}>
      <h2>Join with a link</h2>
      <p className="o2t-muted">Paste the call link you received.</p>
      <label>
        Call link
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/r/…" required />
      </label>
      {otherHost && (
        <p className="o2t-muted">
          This link is for <strong>{otherHost}</strong>, but you're using {host || "no server"}.{" "}
          <button type="button" className="d-link" onClick={() => void onUseHost(otherHost)}>
            Switch to {otherHost}
          </button>
        </p>
      )}
      {error && <p className="o2t-error">{error}</p>}
      <button className="o2t-btn o2t-primary">Continue</button>
    </form>
  );
}
