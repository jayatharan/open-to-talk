"use client";

import { roomUrl, type RoomSecret } from "@open2talk/core";
import { CreateRoomForm, rememberSecret, ShareLink } from "@open2talk/call-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function HomePage() {
  const router = useRouter();
  const [created, setCreated] = useState<{ slug: string; secret: RoomSecret } | null>(null);

  return (
    <main className="home">
      <div className="brand">
        <h1>open2talk</h1>
        <p>Video calls with screen and audio sharing. No accounts. No database.</p>
      </div>
      {created ? (
        <ShareLink
          url={roomUrl(window.location.origin, created.slug)}
          onJoin={() => {
            rememberSecret(created.slug, created.secret);
            router.push(`/r/${created.slug}`);
          }}
        />
      ) : (
        <CreateRoomForm onCreated={({ slug, secret }) => setCreated({ slug, secret })} />
      )}
      <p className="footer">
        The link only locates the room. Your room name and password never leave this device; they
        derive the key that encrypts the call setup, so only people who know them can connect.
      </p>
    </main>
  );
}
