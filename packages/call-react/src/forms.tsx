import {
  createRoom,
  openRoom,
  parseRoomLink,
  passwordStrength,
  roomNameInUse,
  unlockRoom,
  type RoomLink,
  type RoomSecret,
} from "@open2talk/core";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { LockIcon } from "./icons";
import { loadDisplayName, saveDisplayName } from "./secretCache";

type RoomResult = { slug: string; secret: RoomSecret; displayName: string };

export interface HomePanelProps {
  /** Server origin used to check the name isn't already taken. Empty string means same origin (web). */
  host: string;
  onCreated: (result: RoomResult) => void;
  /** Joined with room name + password (no link). */
  onJoined: (result: RoomResult) => void;
  /** A pasted call link; with a key it joins directly, without one it asks for name + password. */
  onLink: (link: RoomLink) => void;
  /** Extra guidance under the link field, e.g. "this link is for another server". */
  linkHint?: (link: string) => ReactNode;
}

const TABS = [
  { id: "create", label: "New call" },
  { id: "join", label: "Join" },
] as const;

/** One panel for both ways into a call, so the home screen has a single clear primary action. */
export function HomePanel({ host, onCreated, onJoined, onLink, linkHint }: HomePanelProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("create");
  const [room, setRoom] = useState("");
  const [password, setPassword] = useState("");
  const [link, setLink] = useState("");
  const [displayName, setDisplayName] = useState("");
  useEffect(() => setDisplayName((n) => n || loadDisplayName()), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const strength = passwordStrength(password);
  const usingLink = tab === "join" && link.trim().length > 0;
  const name = displayName.trim();

  function select(id: typeof tab) {
    setTab(id);
    setError(null);
  }

  function onTabKey(e: KeyboardEvent, i: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    select(TABS[next]!.id);
    tabRefs.current[next]?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (usingLink) {
      const parsed = parseRoomLink(link);
      if (!parsed) {
        setError("That doesn't look like an open2talk call link.");
        return;
      }
      if (name) saveDisplayName(name);
      onLink(parsed);
      return;
    }
    if (!room.trim() || !password || !name) return;
    if (tab === "create" && !strength.ok) return;
    setBusy(true);
    try {
      const { slug, ...secret } = await (tab === "create" ? createRoom : openRoom)(room, password);
      if (tab === "create" && (await roomNameInUse(host, secret.salt))) {
        setError(`A call named “${room.trim()}” is already in progress. Pick another name, or join it with its password.`);
        return;
      }
      saveDisplayName(name);
      (tab === "create" ? onCreated : onJoined)({ slug, secret, displayName: name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const tabIndex = TABS.findIndex((t) => t.id === tab);
  const canSubmit = usingLink || (!!room.trim() && !!password && !!name && (tab === "join" || strength.ok));

  return (
    <form className="o2t-card o2t-form o2t-home" onSubmit={submit} noValidate>
      <div className="o2t-tabs" role="tablist" aria-label="Start or join a call" style={{ ["--o2t-tab" as string]: tabIndex }}>
        <span className="o2t-tab-indicator" aria-hidden="true" />
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`o2t-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="o2t-home-panel"
            tabIndex={tab === t.id ? 0 : -1}
            className="o2t-tab"
            onClick={() => select(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div key={tab} id="o2t-home-panel" role="tabpanel" aria-labelledby={`o2t-tab-${tab}`} className="o2t-tabpanel">
        {tab === "create" ? (
          <p className="o2t-muted">
            Pick a room name and password. Anyone with the link joins directly; others can join with the name and
            password.
          </p>
        ) : (
          <>
            <label>
              Call link
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://…/r/…"
                inputMode="url"
                autoComplete="off"
              />
            </label>
            {link.trim() && linkHint?.(link)}
            <div className="o2t-or">or room name and password</div>
          </>
        )}

        <label style={{ opacity: usingLink ? 0.45 : 1 }}>
          Room name
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder={tab === "create" ? "Weekly sync" : undefined}
            disabled={usingLink}
          />
        </label>
        <label style={{ opacity: usingLink ? 0.45 : 1 }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={tab === "create" ? "At least 8 characters" : undefined}
            autoComplete={tab === "create" ? "new-password" : "current-password"}
            disabled={usingLink}
          />
          {tab === "create" && password && (
            <span className="o2t-strength" data-score={strength.score}>
              <span className="o2t-strength-bar" />
              {strength.hint}
            </span>
          )}
        </label>
        <label>
          Your name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex" maxLength={40} />
        </label>
      </div>

      {error && <p className="o2t-error" role="alert">{error}</p>}
      <button className="o2t-btn o2t-primary" disabled={busy || !canSubmit}>
        {busy ? (tab === "create" ? "Securing room…" : "Checking…") : tab === "create" ? "Create call" : "Join call"}
      </button>
    </form>
  );
}

export interface CreateRoomFormProps {
  /** Server origin used to check the name isn't already taken. Empty string means same origin (web). */
  host: string;
  onCreated: (result: { slug: string; secret: RoomSecret; displayName: string }) => void;
}

export function CreateRoomForm({ host, onCreated }: CreateRoomFormProps) {
  const [room, setRoom] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  useEffect(() => setDisplayName((n) => n || loadDisplayName()), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = passwordStrength(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!room.trim() || !strength.ok || !displayName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { slug, ...secret } = await createRoom(room, password);
      if (await roomNameInUse(host, secret.salt)) {
        setError(`A call named “${room.trim()}” is already in progress. Pick another name, or join it with its password.`);
        return;
      }
      saveDisplayName(displayName.trim());
      onCreated({ slug, secret, displayName: displayName.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="o2t-card o2t-form" onSubmit={submit}>
      <h2>Create a call</h2>
      <p className="o2t-muted">
        Pick a room name and password. Anyone with the link joins directly; others can join with the
        room name and password.
      </p>
      <label>
        Room name
        <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Weekly sync" required autoFocus />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          required
        />
        {password && (
          <span className="o2t-strength" data-score={strength.score}>
            <span className="o2t-strength-bar" />
            {strength.hint}
          </span>
        )}
      </label>
      <label>
        Your name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex" required maxLength={40} />
      </label>
      {error && <p className="o2t-error">{error}</p>}
      <button className="o2t-btn o2t-primary" disabled={busy || !strength.ok}>
        {busy ? "Securing room…" : "Create call"}
      </button>
    </form>
  );
}

export interface JoinRoomFormProps {
  /** A key-less link's slug. Without it, the room is found from the name + password alone. */
  slug?: string;
  onUnlocked: (result: { slug: string; secret: RoomSecret; displayName: string }) => void;
}

export function JoinRoomForm({ slug, onUnlocked }: JoinRoomFormProps) {
  const [room, setRoom] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  useEffect(() => setDisplayName((n) => n || loadDisplayName()), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let result: { slug: string; secret: RoomSecret };
      if (slug) {
        const secret = await unlockRoom(slug, room, password);
        if (!secret) {
          setError("Wrong room name or password.");
          return;
        }
        result = { slug, secret };
      } else {
        const { slug: found, ...secret } = await openRoom(room, password);
        result = { slug: found, secret };
      }
      saveDisplayName(displayName.trim());
      onUnlocked({ ...result, displayName: displayName.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock the room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="o2t-card o2t-form" onSubmit={submit}>
      <h2>
        <LockIcon /> {slug ? "Join call" : "Join with room name"}
      </h2>
      <p className="o2t-muted">
        {slug
          ? "Enter the room name and password you were given."
          : "No link? Enter the room name and password to join the call."}
      </p>
      <label>
        Room name
        <input value={room} onChange={(e) => setRoom(e.target.value)} required autoFocus={!!slug} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        Your name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex" required maxLength={40} />
      </label>
      {error && <p className="o2t-error">{error}</p>}
      <button className="o2t-btn o2t-primary" disabled={busy}>
        {busy ? "Checking…" : "Join"}
      </button>
    </form>
  );
}

/** For a direct link: the key is already in hand, so only ask for a display name. */
export function DirectJoinForm({ onJoin }: { onJoin: (displayName: string) => void }) {
  const [displayName, setDisplayName] = useState("");
  useEffect(() => setDisplayName((n) => n || loadDisplayName()), []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    saveDisplayName(name);
    onJoin(name);
  }

  return (
    <form className="o2t-card o2t-form" onSubmit={submit}>
      <h2>Join call</h2>
      <p className="o2t-muted">You were invited with a direct link. Choose the name others will see.</p>
      <label>
        Your name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex" required maxLength={40} autoFocus />
      </label>
      <button className="o2t-btn o2t-primary">Join</button>
    </form>
  );
}

export function ShareLink({ url, onJoin }: { url: string; onJoin?: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; user can select the text manually
    }
  }
  return (
    <div className="o2t-card o2t-form">
      <h2>Your call is ready</h2>
      <p className="o2t-muted">Anyone with this link can join directly, so share it only with people you invite. People without the link can join with the room name and password.</p>
      <div className="o2t-share">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="o2t-btn" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {onJoin && (
        <button type="button" className="o2t-btn o2t-primary" onClick={onJoin}>
          Join now
        </button>
      )}
    </div>
  );
}
