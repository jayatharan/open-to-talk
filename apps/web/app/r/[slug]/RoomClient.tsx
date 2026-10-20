"use client";

import { joinFromLink, parseRoomLink, parseSlug, roomUrl, type RoomSecret } from "@open2talk/core";
import { CallView, DirectJoinForm, JoinRoomForm, loadDisplayName, takeSecret } from "@open2talk/call-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function RoomClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [session, setSession] = useState<{ secret: RoomSecret; displayName: string } | null>(null);
  const [invite, setInvite] = useState<RoomSecret | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // A direct link carries the key in its #k= fragment, which never reaches the server.
    const readKey = async () => {
      const linkKey = parseRoomLink(`/r/${slug}${window.location.hash}`)?.linkKey;
      setInvite(linkKey ? await joinFromLink(slug, linkKey) : null);
    };
    void (async () => {
      // The creator (or a name + password joiner) arrives with the secret already derived.
      const secret = takeSecret(slug);
      if (secret) setSession({ secret, displayName: loadDisplayName() || "Host" });
      else await readKey();
      setReady(true);
    })();
    // Opening the direct link in a tab already showing this room only changes the hash.
    const onHash = () => void readKey();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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

  if (!session && invite) {
    return (
      <main className="o2t-center">
        <DirectJoinForm onJoin={(displayName) => setSession({ secret: invite, displayName })} />
      </main>
    );
  }

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
      shareUrl={roomUrl(window.location.origin, slug, session.secret.linkKey)}
      onLeave={() => router.push("/")}
    />
  );
}
