# Session Share: a portal between two BB instances

Watch a teammate's live [BB](https://getbb.app) thread inside your own BB. With an explicitly chat-enabled invitation, send messages into that same agent session.

Requires BB 0.43 or later. Git installs need npm on the machine running BB. BB asks for confirmation before installing full-trust plugin code.

## 1. Both people install the plugin

Run this in a terminal connected to **your own BB**. Your colleague runs it against **their BB** too:

```sh
bb plugin install https://github.com/expandai/bb-sharing
```

Refresh an already-open BB window after installation. **Shared sessions** appears in the sidebar, sometimes under **More**. **Share session** appears in each thread header.

## 2. Owner: prepare the connection

Install [cloudflared](https://developers.cloudflare.com/tunnel/downloads/) on the machine running the **BB server**, which may differ from your laptop or agent machine. Leave `publicBaseUrl` empty for temporary tunnels. If cloudflared is not on the server's PATH:

```sh
bb plugin config session-share set cloudflaredPath /absolute/path/to/cloudflared
```

The recipient does not need cloudflared. The first invitation starts a temporary public HTTPS tunnel serving only this plugin's invitation, snapshot and message routes. It does not expose the owner's BB controls.

For a stable setup, configure an HTTPS origin that proxies only `/api/v1/plugins/session-share/http/*` to BB, then set:

```sh
bb plugin config session-share set publicBaseUrl https://share.example.com
```

An owner-only BB Connect URL will not let colleagues connect. The recipient requires a publicly resolvable HTTPS origin on port 443; private LAN and Tailscale addresses are rejected.

## 3. Owner: create an invitation

1. Open the thread you want to share.
2. Click **Share session** in its header.
3. Choose **1 hour**, **24 hours**, or **7 days**.
4. Leave **Allow chat** off for observation, or enable it to allow messages to the agent.
5. Click **Create invitation**, then **Copy invitation**. Send it to your colleague.

Copy the complete link, including everything after `#`. It is shown only at creation. Existing invitations remain view-only after upgrading; create a new invitation to enable chat.

Anyone holding a chat-enabled invitation can prompt the agent using the owner's existing permissions, potentially causing tool actions and code changes. Recipients have no separate tool-execution buttons, permission settings or approval controls. All messages are labelled `[Shared participant]`; this is not a verified personal identity. Share separate invitations if you want to revoke colleagues independently.

## 4. Colleague: connect inside your BB

1. Open **Shared sessions** in **your own BB sidebar**.
2. Paste the invitation into **Session invitation** and click **Connect session**.
3. Select the saved session to follow its messages. It refreshes every two seconds.
4. For chat-enabled invitations, type in the composer and click **Send**. View-only invitations have no composer.

Opening the invitation in a browser shows these connection instructions. It does not sign you into the owner's BB. Messages sent through the portal go to the original thread, not a fork. If delivery fails, retain your draft and check the source thread before retrying: a lost response can leave delivery uncertain.

## Stop or reconnect

- **Owner:** open **Share session** and click **Stop sharing** beside an invitation. It blocks future reads and sends. It does not undo messages already accepted or work already triggered.
- **Colleague:** **Disconnect** removes the saved invitation from your BB. It does not revoke other recipients.
- A temporary tunnel URL stops working on sender restart, plugin reload or tunnel failure. Ask for a **new invitation** and reconnect. The portal entry survives receiving-BB reloads, but does not discover a changed sender address.
- Expired, revoked or offline sessions cannot be read. Content previously viewed cannot be erased from a recipient's copies.

## Owner CLI

```sh
bb session-share create <thread-id> 24
bb session-share list <thread-id>
bb session-share revoke <share-id>
```

CLI creation is view-only; use the owner dialog for chat. Create returns JSON containing `id`, `threadId`, `expiresAt`, `canChat`, and `url`.

## Limits and storage

The view includes the latest 30 timeline segments, at most 200 rows and 40,000 characters per message. Tools show activity status, not arguments/results. Attachments, workspace files, reasoning and system messages are excluded; sensitive text already in user/assistant messages is still shared. Messages sent through the portal are limited to 20,000 characters. Up to 100 active invitations per thread; maximum lifetime is seven days.

The sending BB stores only the SHA-256 digest of each random capability. The receiving BB stores the full invitation in its private plugin database to reconnect. Treat its backups as credentials. Portal lists and snapshots do not return that invitation. Disconnect removes it. HTTPS requests reject private/special IPs and redirects, with bounded responses. Quick Tunnels are temporary and have no uptime guarantee.

## Development

```sh
npm ci
npm run typecheck
npm test
bb plugin build
```

For the optional live receiving-host test: `BB_PORTAL_TEST_INVITATION='<invitation>' npm test`. It requires an active invitation and does not send chat messages. Unit and transport tests verify chat permission, forwarding, expiry and revocation separately.

## License

[MIT](LICENSE)
