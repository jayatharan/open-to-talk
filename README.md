# open2talk

Open-source video calls with screen sharing (including screen audio) for **web, desktop (macOS / Windows / Linux), Android and iOS**.

- **No accounts, no sign-up, no database.** A call is just a link plus a room name and password.
- **Password-gated.** People with only the link can't join: the room name and password derive the key that encrypts the whole call setup.
- **Peer-to-peer WebRTC.** Media flows directly between participants (mesh, best for up to about 6 people).
- **Self-hostable.** A single Next.js server provides the web app and the signaling API. The native apps point at any server you choose in **Settings**.

## How it works

```
 create call                                  join call
 ───────────                                  ─────────
 name + password ─┐                           link ─► salt, roomId
 random salt ─────┤ PBKDF2-SHA256 (310k)       name + password + salt ─► PBKDF2
                  ▼                                     ▼
          ┌── 32-byte AES-GCM key (stays on device)    derived roomId == link roomId ?
          └── 16-byte roomId (public)                    no  → "wrong name or password" (no network)
                                                         yes → connect
 link = https://host/r/<salt>.<roomId>
```

1. The creator picks a room name and password. The client derives an AES-GCM **room key** and a public **room id** from them with a random salt. The link is `https://<host>/r/<salt>.<roomId>`.
2. A joiner opens the link and types the name and password. Their device re-derives the room id and checks that it matches the link. A wrong name or password is rejected locally, before any network request.
3. Every signaling message (SDP offers and answers, ICE candidates, and the participant state that carries the DTLS certificate fingerprints) is **sealed with AES-GCM** using the room key. The room id is bound as additional authenticated data.
4. The server only relays opaque envelopes between connections in the same room, over **Server-Sent Events** (server → client) and **POST** (client → server). It never sees names, passwords, keys or SDP, so it can't man-in-the-middle the call.
5. WebRTC connects peer-to-peer. Media is encrypted by DTLS-SRTP as usual.

> **Note:** The link contains the salt and room id, so a weak password can be brute-forced offline. PBKDF2 makes that slow, and the UI requires at least 8 characters and shows a strength hint. Use a passphrase, and send it through a different channel from the link.

## Repository layout

| Path | What |
| --- | --- |
| `packages/core` | Platform-agnostic TypeScript: key derivation and slugs, AES-GCM sealing, protocol types, the SSE `SignalingClient`, and the `MeshCall` engine (perfect negotiation, one `RTCPeerConnection` per peer) |
| `packages/call-react` | React DOM UI shared by web and desktop: create/join forms, call view, screen source picker, styles |
| `apps/web` | Next.js app with the UI and API (`/api/rooms/:id/events`, `/api/rooms/:id/signal`, `/api/config`, `/api/health`) |
| `apps/desktop` | Electron app with a server-host setting, a native screen/window picker with system audio, and `open2talk://` deep links |
| `apps/mobile` | Expo (dev build) app using `react-native-webrtc`, with a server-host setting and `open2talk://` deep links |

## Quick start

Requirements: Node 20+ and pnpm 10.

```bash
pnpm install
```

```bash
pnpm --filter @open2talk/web dev
```

Open http://localhost:3000, create a call, and open the link in a second window.

```bash
pnpm --filter @open2talk/desktop dev
```

On first launch, set the host to `localhost:3000`.

```bash
pnpm --filter @open2talk/mobile ios
```

```bash
pnpm --filter @open2talk/mobile android
```

In the app, set the host to your computer's LAN address, e.g. `192.168.1.20:3000`. A physical phone needs **https** for anything other than a local network address. Camera and microphone access in browsers also needs https, except on `localhost`.

Run the tests and typecheck:

```bash
pnpm test
```

```bash
pnpm typecheck
```

## Self-hosting

The server keeps rooms in process memory, so run **one long-running Node instance**. It won't work on serverless platforms, and it needs sticky sessions if you put several instances behind a load balancer.

```bash
docker compose up -d --build
```

This serves on port 3000. Put it behind a TLS-terminating reverse proxy. Disable response buffering for `/api/rooms/*/events`; the server already sends `X-Accel-Buffering: no` for nginx.

Configuration (`apps/web/.env`, see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUN_URLS` | Google public STUN | Comma-separated STUN servers |
| `TURN_URLS` | (none) | Comma-separated TURN URLs |
| `TURN_SECRET` | (none) | coturn `static-auth-secret`. Short-lived credentials are minted per request (coturn REST scheme), with no user database |
| `TURN_TTL_SECONDS` | `3600` | TURN credential lifetime |
| `MAX_PEERS_PER_ROOM` | `8` | Connection cap per room |

Users behind symmetric NATs or strict corporate firewalls need TURN. To run the bundled coturn:

```bash
TURN_SECRET=change-me docker compose --profile turn up -d
```

Set the same `TURN_SECRET`, plus `TURN_URLS=turn:<your-host>:3478`, for the web service.

## Platform support

| Capability | Web (Chrome/Edge) | Web (Firefox/Safari) | Desktop (Electron) | Android | iOS |
| --- | --- | --- | --- | --- | --- |
| Video + audio | ✅ | ✅ | ✅ | ✅ | ✅ |
| Screen share (video) | ✅ | ✅ | ✅ custom picker | ✅ MediaProjection | 🚧 needs broadcast extension |
| Screen share **audio** | ✅ tab audio; full system audio on Windows | ❌ (browser limitation) | ✅ Windows; macOS 13+ (ScreenCaptureKit loopback, needs the system-audio permission); ❌ Linux | 🚧 planned (AudioPlaybackCapture, Android 10+) | 🚧 planned (ReplayKit app audio) |
| Hear others' screen audio | ✅ | ✅ | ✅ | ✅ | ✅ |

Packaging the desktop app:

```bash
pnpm --filter @open2talk/desktop dist:mac
```

```bash
pnpm --filter @open2talk/desktop dist:win
```

```bash
pnpm --filter @open2talk/desktop dist:linux
```

Mobile store builds use EAS (`npx eas-cli build`) from `apps/mobile`.

## Security notes

- The server is untrusted by design. It can see who is connected to which room id (IP addresses and timing) but not names, passwords, keys or signaling contents.
- An outsider with only the link can open an SSE stream to the room id. All they get is ciphertext. Peers drop anything that fails to decrypt, so the outsider never appears in the call.
- Each SSE connection gets a random token, and the server stamps the sender on relayed messages from that token, so peers can't spoof each other. Sealed payloads also repeat sender and recipient, which prevents replay across peers.
- Media is end-to-end between peers (DTLS-SRTP). A TURN relay only forwards encrypted packets.

## License

MIT
