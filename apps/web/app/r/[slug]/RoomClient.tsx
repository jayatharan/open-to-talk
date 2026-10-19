"use client";

import { parseSlug, roomUrl, type RoomSecret } from "@open2talk/core";
import { CallView, JoinRoomForm, loadDisplayName, takeSecret } from "@open2talk/call-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function RoomClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [session, setSession] = useState<{ secret: RoomSecret; displayName: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The creator arrives with the secret already derived; everyone else must unlock.
    const secret = takeSecret(slug);
    if (secret) setSession({ secret, displayName: loadDisplayName() || "Host" });
    setReady(true);
  }, [slug]);

  if (!parseSlug(slug)) {
    return (
      <main className="o2t-center">
        <div className="o2t-card o2t-form">
          <h2>Invalid link</h2>
          <p className="o2t-muted">This call link is malformed. Ask for a new one.</p>
          <Link className="o2t-btn o2t-primary" href="/">
            Create a call
          </Link>
        </div>
      </main>
    );
  }

  if (!ready) return null;

  if (!session) {
    return (
      <main className="o2t-center">
        <JoinRoomForm slug={slug} onUnlocked={setSession} />
      </main>
    );
  }

  return (
    <CallView
      host=""
      secret={session.secret}
      displayName={session.displayName}
      shareUrl={roomUrl(window.location.origin, slug)}
      onLeave={() => router.push("/")}
    />
  );
}
