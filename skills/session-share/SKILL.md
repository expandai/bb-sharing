---
name: session-share
description: Share a live BB thread with teammates through a portal, optionally allow chat, or revoke access.
---

To share, use the Share session button in the thread header. Check Allow chat when recipients should be able to send messages into the owner's thread. Messages are attributed as `[Shared participant]`; recipients cannot run tools or change permissions. To receive, open Shared sessions in your own BB, paste the invitation and select Connect session. Both instances need this plugin. Do not open a browser transcript; the invitation URL is a landing page for connecting the session inside BB.

Owner CLI:

- `bb session-share create <thread-id> [hours]` creates a link, default 24 hours, maximum 168.
- `bb session-share list <thread-id>` lists active share IDs and expiry times.
- `bb session-share revoke <share-id>` stops access for that link.

Creation returns JSON with `id`, `threadId`, `expiresAt`, `canChat`, and `url`. The fragment in the URL is a bearer credential; preserve it when copying the link. Give the link to the user, and never send it to teammates without permission. Anyone holding it can view the shared conversation.

The viewer polls every two seconds and shows recent conversation text and activity status. Chat-enabled invitations can prompt the owner’s agent using its existing permissions. Tool arguments/results, system messages, reasoning, files and attachments are excluded. Secrets already written in conversation text are still visible. Revocation and expiry stop future reads; they cannot erase copies someone already made.

Install cloudflared on the BB server. The first share starts a Quick Tunnel that exposes only the viewer. Set `bb plugin config session-share set cloudflaredPath /path/to/cloudflared` if the executable is not on PATH. Quick Tunnel URLs stop working on plugin reload, server restart or tunnel failure; create a new link then. For a stable operator-managed viewer origin, set `publicBaseUrl` to an HTTPS origin with only the viewer routes proxied. An owner-only BB Connect URL is not suitable for team sharing.
