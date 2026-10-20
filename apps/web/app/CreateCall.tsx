"use client";

import { roomUrl, type RoomSecret } from "@open2talk/core";
import { CreateRoomForm, JoinRoomForm, rememberSecret, ShareLink } from "@open2talk/call-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The real create-call flow: it derives the room key on this device and produces a working link. */
export function CreateCall() {
  const router = useRouter();
  const [created, setCreated] = useState<{ slug: string; secret: RoomSecret } | null>(null);

  function enter(slug: string, secret: RoomSecret) {
    rememberSecret(slug, secret);
    router.push(`/r/${slug}`);
  }

  if (created) {
    return (
      <ShareLink
        url={roomUrl(window.location.origin, created.slug, created.secret.linkKey)}
        onJoin={() => enter(created.slug, created.secret)}
      />
    );
  }
  return <CreateRoomForm host="" onCreated={({ slug, secret }) => setCreated({ slug, secret })} />;
}

/** Join without a link: the room name + password locate the room on their own. */
export function JoinByName() {
  const router = useRouter();
  return (
    <JoinRoomForm
      onUnlocked={({ slug, secret }) => {
        rememberSecret(slug, secret);
        router.push(`/r/${slug}`);
      }}
    />
  );
}
