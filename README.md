<p align="center"><img src="brand/logo.svg" width="96" height="96" alt="open2talk logo"></p>

# open2talk

Open-source video calls with screen sharing (including screen audio) for **web, desktop (macOS / Windows / Linux), Android and iOS**.

- **No accounts, no sign-up, no database.** A call is just a room name and password.
- **Two ways in.** Anyone with the call link joins directly (the room key rides in the link's `#fragment`, which never reaches the server). Anyone without it joins by typing the room name and password, which derive the same key.
- **Peer-to-peer WebRTC.** Media flows directly between participants (mesh, best for up to about 6 people).
- **Self-hostable.** A single Next.js server provides the web app and the signaling API. The native apps point at any server you choose in **Settings**.

## How it works

```
 create call / join by name                    join by link
 ──────────────────────────                    ────────────
 salt = SHA-256(name)[0..16]                   link ─► salt, roomId, #k=key
 name + password + salt ─┐ PBKDF2-SHA256 (310k)           ▼
                         ▼                          import key, connect
          ┌── 32-byte AES-GCM key (never sent to the server)
          └── 16-byte roomId (public)

 link = https://host/r/<salt>.<roomId>#k=<key>
```

1. The creator picks a room name and password. The client derives an AES-GCM **room key** and a public **room id** from them, with a salt derived from the room name. The link is `https://<host>/r/<salt>.<roomId>#k=<key>`.
2. A joiner either opens the link, which hands their device the key directly (browsers never send the `#` part to the server), or types the room name and password, which re-derive the same salt, key and room id. A wrong password just leads to a different, empty room. (Older links without `#k=` still ask for the name and password and reject a wrong one locally.)
3. Every signaling message (SDP offers and answers, ICE candidates, and the participant state that carries the DTLS certificate fingerprints) is **sealed with AES-GCM** using the room key. The room id is bound as additional authenticated data.
4. The server only relays opaque envelopes between connections in the same room, over **Server-Sent Events** (server → client) and **POST** (client → server). It never sees names, passwords, keys or SDP, so it can't man-in-the-middle the call.
5. WebRTC connects peer-to-peer. Media is encrypted by DTLS-SRTP as usual.

> **Note:** The room id is derived from the name and password, so anyone who sees it (the server included) can try to brute-force a weak password offline. PBKDF2 makes that slow, and the UI requires at least 8 characters and shows a strength hint. Use a passphrase. Treat the link like a password too: it contains the room key.

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
| `CLOUDFLARE_TURN_KEY_ID` | (none) | Cloudflare Realtime TURN key id |
| `CLOUDFLARE_TURN_API_TOKEN` | (none) | API token for that key. Short-lived credentials are minted on the server and cached; the token never reaches clients |
| `TURN_URLS` | (none) | Comma-separated TURN URLs |
| `TURN_SECRET` | (none) | coturn `static-auth-secret`. Short-lived credentials are minted per request (coturn REST scheme), with no user database |
| `TURN_TTL_SECONDS` | `3600` | TURN credential lifetime |
| `MAX_PEERS_PER_ROOM` | `8` | Connection cap per room |

Users behind symmetric NATs, mobile carrier NAT (phone hotspots) or strict corporate firewalls need TURN. Without it their calls hang on "connecting…" and often never connect.

The simplest option is [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/): create a TURN key in the Cloudflare dashboard (Realtime → TURN) and set `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN`. If Cloudflare can't be reached, clients fall back to STUN.

To run the bundled coturn instead:

```bash
TURN_SECRET=change-me docker compose --profile turn up -d
```

Set the same `TURN_SECRET`, plus `TURN_URLS=turn:<your-host>:3478`, for the web service.

## Platform support

| Capability | Web (Chrome/Edge) | Web (Firefox/Safari) | Desktop (Electron) | Android | iOS |
| --- | --- | --- | --- | --- | --- |
| Video + audio | ✅ | ✅ | ✅ | ✅ | ✅ |
| Screen share (video) | ✅ | ✅ | ✅ custom picker | ✅ MediaProjection | ✅ ReplayKit broadcast extension (physical device) |
| Screen share **audio** | ✅ tab audio; full system audio on Windows | ❌ (browser limitation) | ✅ Windows; macOS 13+ (ScreenCaptureKit loopback, needs the system-audio permission); ❌ Linux | ✅ Android 10+: other apps' media/game audio (AudioPlaybackCapture), mixed into the mic track; apps can opt out | ❌ (react-native-webrtc only carries broadcast video) |
| Hear others' screen audio | ✅ | ✅ | ✅ | ✅ | ✅ |
| Control someone's shared screen | ✅ | ✅ | ✅ | ❌ | ❌ |
| Let others control your screen | ❌ | ❌ | ✅ macOS / Windows, whole-screen shares only | ❌ | ❌ |

### Remote control

While the desktop app shares a whole screen, others in the call can click **Request control** on it. Nothing happens until the sharer clicks **Allow control**. After that, the controller's mouse, scroll wheel and keyboard drive the shared screen until either side clicks **Stop**. Control also ends when the sharer presses ⌘⇧Esc (macOS) / Ctrl+Alt+Shift+Esc (Windows), stops sharing or leaves.

- **Input path:** input travels over the call's peer-to-peer data channel, which is DTLS-encrypted, and the server never sees it. The sharer only accepts it from the one person they allowed.
- **Keyboard:** keys are sent as physical keys, using US-layout positions.
- **macOS:** the sharer must allow open2talk under System Settings → Privacy & Security → **Accessibility**. The app asks the first time someone is given control. macOS ties that permission to the app's code signature, so it only lasts across updates for signed (Developer ID) builds. Unsigned or dev builds need it granted again after each rebuild, and in dev the entry is "Electron".

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
- Clients also report the room's salt (a SHA-256 hash of the room name, already visible in `/r/<slug>` URLs) so the server can refuse to let a second call be created under a name that's in use. Someone running the server could guess common room names from it, but not passwords.
- An outsider who knows only the room id can open an SSE stream to it. All they get is ciphertext. Peers drop anything that fails to decrypt, so the outsider never appears in the call.
- Each SSE connection gets a random token, and the server stamps the sender on relayed messages from that token, so peers can't spoof each other. Sealed payloads also repeat sender and recipient, which prevents replay across peers.
- Media is end-to-end between peers (DTLS-SRTP). A TURN relay only forwards encrypted packets.

## License

MIT
