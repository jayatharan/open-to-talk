import { CreateCall } from "./CreateCall";

const REPO = "https://github.com/jayatharan/open-to-talk";
const RELEASES = `${REPO}/releases/latest`;

const steps = [
  {
    state: "01 · Create",
    title: "The key is made on your device",
    body: "Your room name and password go through PBKDF2 (310,000 rounds), salted with a hash of the room name. That produces an encryption key, which never leaves the device, and a public room id.",
  },
  {
    state: "02 · Share",
    title: "The link only locates the room",
    body: "The link carries the room id and, after the #, the room key. Browsers never send the part after # to the server, so anyone you give the link to can join directly while the server still learns nothing.",
  },
  {
    state: "03 · Join",
    title: "With the link, or with the name and password",
    body: "Someone without the link types the room name and password; their device derives the same key and room id and joins the same call. A different password simply leads to a different, empty room.",
  },
  {
    state: "04 · Connect",
    title: "Signaling is sealed, media is peer-to-peer",
    body: "Offers, answers and ICE candidates are encrypted with AES-GCM and relayed over Server-Sent Events. Audio and video flow directly between peers over DTLS-SRTP.",
  },
];

const features = [
  { title: "Screen share with sound", body: "Share a tab, window or your whole screen, along with its audio, so you can show a video or a demo with sound." },
  { title: "Every platform", body: "Works in the browser with nothing to install. There are also apps for macOS, Windows, Linux, Android and iOS." },
  { title: "No accounts, no database", body: "Nothing to sign up for and nothing stored. Rooms exist only while people are in them." },
  { title: "Self-host in one container", body: "One Docker image runs the web app and the signaling server. The desktop and mobile apps connect to any host you set." },
  { title: "Small-group mesh", body: "Every participant connects to every other one directly. It works best for up to about six people." },
  { title: "Open source, MIT", body: "Read the crypto, run your own server, send a pull request. Nothing is hidden behind a hosted service." },
];

const downloads = [
  { os: "Web", detail: "Chrome, Edge, Firefox, Safari", href: "#start", cta: "Start a call", note: "Screen audio: Chrome and Edge" },
  { os: "macOS", detail: ".dmg · Apple silicon and Intel", href: RELEASES, cta: "Download", note: "System audio on macOS 13+" },
  { os: "Windows", detail: ".exe installer", href: RELEASES, cta: "Download", note: "Full system audio" },
  { os: "Linux", detail: "AppImage · .deb", href: RELEASES, cta: "Download", note: "Screen video only" },
  { os: "Android", detail: ".apk", href: RELEASES, cta: "Download", note: "Screen video; audio in progress" },
  { os: "iOS", detail: "Build from source", href: `${REPO}#quick-start`, cta: "Instructions", note: "App Store build not published yet" },
];

const faqs = [
  {
    q: "Is it end-to-end encrypted?",
    a: "Media goes directly between participants and is encrypted with DTLS-SRTP, the WebRTC standard. A TURN relay, if one is used, only forwards encrypted packets. The call setup is also sealed with a key only participants can derive, so the server can't swap in its own certificates.",
  },
  {
    q: "What does the server know?",
    a: "Which room id each connection is in, connection timing and IP addresses. It never receives room names, passwords, keys, names you type, or the contents of the call setup.",
  },
  {
    q: "What if I forget the password?",
    a: "Then the room can't be opened. Nothing is stored anywhere to recover it from. Create a new call and share a new link.",
  },
  {
    q: "How strong does the password need to be?",
    a: "The room id is derived from the room name and password, so anyone who sees it (including the server) could try to guess the password offline. PBKDF2 makes each guess slow, but a long passphrase is what really protects you. The form requires at least 8 characters. Treat the link itself like a password: it contains the room key.",
  },
  {
    q: "How many people can join?",
    a: "Up to 8 connections per room. Since each person sends video to every other person, quality is best with about six or fewer.",
  },
];

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Cross() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="lp">
      <header className="lp-header">
        <div className="lp-wrap lp-header-inner">
          <a href="/" className="lp-logo" aria-label="open2talk home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={24} height={24} className="lp-logo-mark" />
            open2talk
          </a>
          <nav className="lp-nav" aria-label="Main">
            <a href="#how">How it works</a>
            <a href="#download">Download</a>
            <a href="#self-host">Self-host</a>
            <a href={REPO}>GitHub</a>
          </nav>
          <a href="#start" className="lp-btn lp-btn-dark lp-btn-sm">
            Start a call
          </a>
        </div>
      </header>

      <main>
        <section className="lp-hero lp-wrap" id="start">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">Open source · No accounts · No database</p>
            <h1>Private video calls: send a link, or just a password.</h1>
            <p className="lp-lede">
              Pick a room name and password. People with the link join in one click; anyone else joins
              with the room name and password. Share your screen with its sound included, from the
              browser, your desktop or your phone.
            </p>
            <ul className="lp-hero-points">
              <li>
                <Check /> The password never leaves your device
              </li>
              <li>
                <Check /> The room key in the link is never sent to the server
              </li>
              <li>
                <Check /> Audio and video go peer-to-peer
              </li>
            </ul>
          </div>
          <div className="lp-stage">
            <p className="lp-stage-label">
              <span className="lp-dot" aria-hidden="true" /> Live: this creates a real room
            </p>
            <div className="lp-stage-card">
              <CreateCall />
            </div>
          </div>
        </section>

        <section className="lp-section lp-wrap" aria-labelledby="sees">
          <div className="lp-section-head">
            <p className="lp-eyebrow">What the server sees</p>
            <h2 id="sees">It just relays messages it can't read.</h2>
          </div>
          <div className="lp-compare">
            <div className="lp-compare-col">
              <h3>Visible to the server</h3>
              <ul>
                <li><Check /> A random room id</li>
                <li><Check /> When connections open and close, and from which IP</li>
                <li><Check /> Encrypted envelopes it passes along</li>
              </ul>
            </div>
            <div className="lp-compare-col lp-compare-never">
              <h3>Never sent to the server</h3>
              <ul>
                <li><Cross /> Room name and password</li>
                <li><Cross /> The room key</li>
                <li><Cross /> Your display name, mic and camera state</li>
                <li><Cross /> Offers, answers, ICE candidates and DTLS fingerprints</li>
                <li><Cross /> Your audio, video and screen</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="lp-section lp-wrap" id="how" aria-labelledby="how-title">
          <div className="lp-section-head">
            <p className="lp-eyebrow">How it works</p>
            <h2 id="how-title">From password to peer-to-peer in four steps.</h2>
          </div>
          <ol className="lp-steps">
            {steps.map((s) => (
              <li key={s.state} className="lp-step">
                <span className="lp-mono">{s.state}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
          <pre className="lp-flow" aria-label="Key derivation diagram">
{`salt = SHA-256(room name)
room name + password + salt ──PBKDF2──▶ ┌ AES-GCM key  (never sent to the server)
                                         └ room id      (public)
https://open2talk.cosmerg.com/r/<salt>.<room id>#k=<key>`}
          </pre>
        </section>

        <section className="lp-section lp-wrap" aria-labelledby="features-title">
          <div className="lp-section-head">
            <p className="lp-eyebrow">Features</p>
            <h2 id="features-title">Everything a small call needs, nothing it doesn't.</h2>
          </div>
          <div className="lp-features">
            {features.map((f) => (
              <div key={f.title} className="lp-feature">
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section lp-wrap" id="download" aria-labelledby="download-title">
          <div className="lp-section-head">
            <p className="lp-eyebrow">Download</p>
            <h2 id="download-title">Use it where you are.</h2>
            <p className="lp-muted">
              Installers come from the latest GitHub release. In the desktop and mobile apps, set the
              server to <span className="lp-mono">open2talk.cosmerg.com</span> or your own host.
            </p>
          </div>
          <div className="lp-downloads">
            {downloads.map((d) => (
              <div key={d.os} className="lp-download">
                <div>
                  <h3>{d.os}</h3>
                  <p className="lp-mono lp-muted">{d.detail}</p>
                </div>
                <p className="lp-download-note">{d.note}</p>
                <a className="lp-btn lp-btn-light" href={d.href}>
                  {d.cta}
                </a>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section lp-wrap" id="self-host" aria-labelledby="self-host-title">
          <div className="lp-split">
            <div>
              <p className="lp-eyebrow">Self-host</p>
              <h2 id="self-host-title">Your own server in one command.</h2>
              <p className="lp-muted">
                Run one long-running instance behind any TLS proxy; it keeps rooms in memory. If some
                users sit behind strict firewalls, add the bundled coturn relay.
              </p>
              <a className="lp-btn lp-btn-dark" href={`${REPO}#self-hosting`}>
                Self-hosting guide
              </a>
            </div>
            <pre className="lp-code">
{`git clone ${REPO}.git
cd open-to-talk
docker compose up -d --build
# → http://localhost:3000`}
            </pre>
          </div>
        </section>

        <section className="lp-section lp-wrap" id="faq" aria-labelledby="faq-title">
          <div className="lp-section-head">
            <p className="lp-eyebrow">FAQ</p>
            <h2 id="faq-title">Questions worth asking.</h2>
          </div>
          <div className="lp-faq">
            {faqs.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <span>open2talk · MIT licensed</span>
          <nav aria-label="Footer">
            <a href={REPO}>Source</a>
            <a href={`${REPO}#security-notes`}>Security notes</a>
            <a href={`${REPO}/issues`}>Report an issue</a>
            <a href="https://cosmerg.com">Hosted by Cosmerg</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
