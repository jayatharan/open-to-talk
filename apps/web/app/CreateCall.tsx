"use client";

import { roomUrl, type RoomSecret } from "@open2talk/core";
import { CreateRoomForm, rememberSecret, ShareLink } from "@open2talk/call-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The real create-call flow: it derives the room key on this device and produces a working link. */
export function CreateCall() {
  const router = useRouter();
  const [created, setCreated] = useState<{ slug: string; secret: RoomSecret } | null>(null);

  if (created) {
    return (
      <ShareLink
        url={roomUrl(window.location.origin, created.slug)}
        onJoin={() => {
          rememberSecret(created.slug, created.secret);
          router.push(`/r/${created.slug}`);
        }}
      />
    );
  }
  return <CreateRoomForm onCreated={({ slug, secret }) => setCreated({ slug, secret })} />;
}
