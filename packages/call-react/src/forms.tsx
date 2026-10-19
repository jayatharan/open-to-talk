import { createRoom, passwordStrength, unlockRoom, type RoomSecret } from "@open2talk/core";
import { useEffect, useState, type FormEvent } from "react";
import { LockIcon } from "./icons";
import { loadDisplayName, saveDisplayName } from "./secretCache";

export interface CreateRoomFormProps {
  onCreated: (result: { slug: string; secret: RoomSecret; displayName: string }) => void;
}

export function CreateRoomForm({ onCreated }: CreateRoomFormProps) {
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
        Pick a room name and password. Share the link; people join only if they know both.
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
  slug: string;
  onUnlocked: (result: { secret: RoomSecret; displayName: string }) => void;
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
      const secret = await unlockRoom(slug, room, password);
      if (!secret) {
        setError("Wrong room name or password.");
        return;
      }
      saveDisplayName(displayName.trim());
      onUnlocked({ secret, displayName: displayName.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock the room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="o2t-card o2t-form" onSubmit={submit}>
      <h2>
        <LockIcon /> Join call
      </h2>
      <p className="o2t-muted">Enter the room name and password you were given.</p>
      <label>
        Room name
        <input value={room} onChange={(e) => setRoom(e.target.value)} required autoFocus />
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
      <p className="o2t-muted">Send this link along with the room name and password (ideally through a different channel).</p>
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
