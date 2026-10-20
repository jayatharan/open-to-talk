"use client";

import { roomUrl, type RoomSecret } from "@open2talk/core";
import { HomePanel, rememberSecret, ShareLink } from "@open2talk/call-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The real create/join flow: keys are derived on this device and links work immediately. */
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
  return (
    <HomePanel
      host=""
      onCreated={({ slug, secret }) => setCreated({ slug, secret })}
      onJoined={({ slug, secret }) => enter(slug, secret)}
      onLink={({ slug, linkKey }) => router.push(`/r/${slug}${linkKey ? `#k=${linkKey}` : ""}`)}
    />
  );
}
