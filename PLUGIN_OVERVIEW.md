# Session Share architecture

`server.ts` owns SQLite share capabilities, owner RPC/CLI, and four invitation, snapshot and message HTTP routes. `projection.ts` explicitly selects public fields from SDK timeline rows. `viewer.ts` contains a standalone invitation HTML page and its JavaScript. `app.tsx` adds the thread-header sharing dialog.

No new SDK APIs or private imports are needed. HTTP routes deliberately use `auth: none`: the static shell has no data and the snapshot route checks its own per-share bearer capability. The owner plugin token is never issued to a viewer.

Plugin-owned storage is closed by BB on disposal; route/RPC/event registrations are generation-scoped. `tunnel.ts` starts a dedicated loopback listener and cloudflared process lazily. Disposal kills the process, closes the listener, and removes its temporary configuration. Expired records are pruned on link creation.

`portal.ts` validates invitations and remote snapshots and pins public DNS addresses for HTTPS reads. `portal-app.tsx` is the receiving BB navigation panel. Portal credentials live only in the receiving plugin database. The HTTP viewer now serves invitation instructions, not a separate transcript.
