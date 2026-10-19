# Deploying open2talk.cosmerg.com

`.github/workflows/deploy.yml` builds `apps/web/Dockerfile` on a GitHub runner, pushes it to GitHub Container Registry as `ghcr.io/jayatharan/open-to-talk-web`, and deploys it over SSH to the cosmerg.com server (the same Contabo VPS and `deploy` user as the Cosmerg site; see `docs/server.md` in the cosmerg repo).

```
Cloudflare (proxied, SSL "Full (strict)")
  → nginx :443 (Cloudflare origin certificate for *.cosmerg.com)
    → open2talk-web container on 127.0.0.1:3010
```

The deploy job stays off until the one-time setup below is done.

## 1. Server (one time, as root)

```bash
# Folder the workflow deploys into, owned by the deploy user
mkdir -p /opt/open2talk && chown deploy:deploy /opt/open2talk
```

nginx site. Copy `deploy/nginx/open2talk.cosmerg.com.conf` from this repo to the server, then:

```bash
cp open2talk.cosmerg.com.conf /etc/nginx/sites-available/open2talk.cosmerg.com
ln -sf /etc/nginx/sites-available/open2talk.cosmerg.com /etc/nginx/sites-enabled/open2talk.cosmerg.com
nginx -t && systemctl reload nginx
```

The config disables proxy buffering for `/api/rooms/*/events` (Server-Sent Events) and allows streams to stay open for an hour. The app sends a heartbeat every 15 seconds, well within Cloudflare's 100-second idle limit.

**Cloudflare DNS:** `open2talk.cosmerg.com` needs a proxied `A` record pointing to the server. It already resolves.

**Optional TURN.** Users behind strict NATs need a relay. Create `/opt/open2talk/open2talk.env` (chmod 600, owned by deploy) with `TURN_URLS` and `TURN_SECRET` (see `apps/web/.env.example`), and run coturn. Cloudflare can't proxy TURN: use a DNS-only record such as `turn.cosmerg.com`, and open 3478/udp+tcp and the relay port range in the firewall. Without TURN, calls still work for most networks using STUN.

Also add a row for open2talk to the cosmerg repo's `docs/server.md`:

| Service | Container | Folder | Host port |
| --- | --- | --- | --- |
| open2talk, open2talk.cosmerg.com | `open2talk-web` | `/opt/open2talk` | `127.0.0.1:3010` |

## 2. GitHub secrets and variables

In **jayatharan/open-to-talk → Settings → Secrets and variables → Actions** (or scoped to the `production` environment), add the same SSH values the cosmerg repo uses:

| Secret | Value |
| --- | --- |
| `SSH_HOST` | `109.205.176.231` |
| `SSH_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | A deploy private key whose public key is in `/home/deploy/.ssh/authorized_keys`. Reuse the cosmerg one or create a new key with `ssh-keygen -t ed25519 -C github-actions-open2talk` |
| `SSH_KNOWN_HOSTS` | Output of `ssh-keyscan 109.205.176.231` (check the fingerprint against the server) |
| `SSH_PORT` | Optional, default `22` |

| Variable | Value |
| --- | --- |
| `DEPLOY_ENABLED` | `true` (turns the deploy job on) |
| `DEPLOY_PATH` | Optional, default `/opt/open2talk` |
| `SITE_URL` | Optional, default `https://open2talk.cosmerg.com` |

Then run **Actions → Deploy web → Run workflow**, or push to `main`.

The workflow uploads `docker-compose.prod.yml` and pulls the exact image digest it just built. It waits for the container's health check to pass and keeps the previous image if the new one fails. Then it checks `https://open2talk.cosmerg.com/api/health`.

## App builds

`.github/workflows/apps.yml` builds the desktop installers (macOS `.dmg`/`.zip`, Windows `.exe`, Linux `.AppImage`/`.deb`) and an Android `.apk` on every relevant push to `main`. They're stored as workflow artifacts (download them from the run page; retained 90 days).

To publish downloads for the landing page, push a version tag. The workflow attaches the files to a GitHub Release, and the landing page links to `releases/latest`.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The builds are unsigned. macOS needs right-click → Open the first time, Windows SmartScreen warns, and the APK is signed with the Android debug key. iOS isn't built in CI because it needs an Apple developer account for signing; use EAS (`npx eas-cli build -p ios`) from `apps/mobile` once you have one.
