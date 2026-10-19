# Contributing

Thanks for helping! A few ground rules keep open2talk simple and private:

- **No server-side persistence.** The server must stay a dumb relay: no database, no logs of room ids beyond what's needed to route messages.
- **Never send names, passwords or keys over the network.** All of it is derived and kept on the device (`packages/core/src/crypto.ts`).
- **Shared logic goes in `packages/core`.** It must stay platform-agnostic (no DOM-only or Node-only APIs without an injection point) so web, desktop and mobile behave the same.

Before opening a PR:

```bash
pnpm typecheck
```

```bash
pnpm test
```

For UI changes, test a call between two platforms (for example web ↔ desktop) and note what you tried in the PR.
