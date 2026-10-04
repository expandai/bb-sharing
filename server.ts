import { createHash, randomBytes, randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { viewerHtml, viewerScript } from "./viewer";
import { projectRows } from "./projection";
import { publicTunnel } from "./tunnel";
import {
  parseInvitation,
  readRemote,
  sendRemote,
  snapshotSchema,
} from "./portal";

const threadInput = z.object({ threadId: z.string().min(1).max(200) }).strict();
const createInput = threadInput.extend({
  hours: z.number().int().min(1).max(168).default(24),
  canChat: z.boolean().default(false),
});
const shareSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  expiresAt: z.number(),
  canChat: z.boolean(),
});
type Share = z.infer<typeof shareSchema>;
const portalSchema = z.object({
  id: z.string(),
  title: z.string(),
  origin: z.string(),
  addedAt: z.number(),
});
export const rpcContract = defineRpcContract({
  portals: { input: z.null(), output: z.array(portalSchema) },
  connect: {
    input: z.object({ invitation: z.string().max(4096) }).strict(),
    output: portalSchema,
  },
  disconnect: {
    input: z.object({ id: z.string().uuid() }).strict(),
    output: z.object({ removed: z.boolean() }),
  },
  follow: {
    input: z.object({ id: z.string().uuid() }).strict(),
    output: snapshotSchema,
  },
  send: {
    input: z
      .object({
        id: z.string().uuid(),
        text: z.string().trim().min(1).max(20_000),
      })
      .strict(),
    output: z.object({ sent: z.boolean() }),
  },
  create: {
    input: createInput,
    output: shareSchema.extend({ url: z.string() }),
  },
  list: { input: threadInput, output: z.array(shareSchema) },
  revoke: {
    input: z.object({ id: z.string().uuid() }).strict(),
    output: z.object({ revoked: z.boolean() }),
  },
});
const baseSchema = z.string().refine((v) => {
  if (!v) return true;
  try {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}, "Use an HTTPS origin, for example https://share.example.com");
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    cloudflaredPath: {
      type: "string",
      label: "cloudflared executable",
      default: "cloudflared",
    },
    publicBaseUrl: {
      type: "string",
      label: "Public BB origin",
      default: "",
      experimental_schema: baseSchema,
    },
  });
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE shares (id TEXT PRIMARY KEY, threadId TEXT NOT NULL, tokenHash TEXT UNIQUE NOT NULL, expiresAt INTEGER NOT NULL)",
    "CREATE INDEX shares_thread ON shares(threadId)",
    "CREATE TABLE portals (id TEXT PRIMARY KEY, title TEXT NOT NULL, origin TEXT NOT NULL, addedAt INTEGER NOT NULL, invitation TEXT NOT NULL UNIQUE)",
    "ALTER TABLE shares ADD COLUMN canChat INTEGER NOT NULL DEFAULT 0",
  ]);
  const prefix = `/api/v1/plugins/${bb.pluginId}/http`;
  const changed = () => bb.realtime.publish("shares-changed", {});
  function list(threadId: string): Share[] {
    return (
      db
        .prepare(
          "SELECT id, threadId, expiresAt, canChat FROM shares WHERE threadId = ? AND expiresAt > ? ORDER BY expiresAt DESC LIMIT 100",
        )
        .all(threadId, Date.now()) as Array<
        Omit<Share, "canChat"> & { canChat: number }
      >
    ).map((share) => ({ ...share, canChat: share.canChat === 1 }));
  }
  async function create(input: z.infer<typeof createInput>) {
    const { threadId, hours, canChat } = createInput.parse(input);
    await bb.sdk.threads.get({ threadId }); // Fail before minting a link for a missing thread.
    const { publicBaseUrl, cloudflaredPath } = await settings.get();
    const base =
      baseSchema.parse(publicBaseUrl) || (await tunnel.origin(cloudflaredPath));
    const token = randomBytes(32).toString("base64url");
    const share = {
      id: randomUUID(),
      threadId,
      expiresAt: Date.now() + hours * 3_600_000,
      canChat,
    };
    db.transaction(() => {
      db.prepare("DELETE FROM shares WHERE expiresAt <= ?").run(Date.now());
      if (list(threadId).length >= 100)
        throw new Error("Stop an existing share before creating another.");
      db.prepare("INSERT INTO shares VALUES (?, ?, ?, ?, ?)").run(
        share.id,
        threadId,
        hash(token),
        share.expiresAt,
        share.canChat ? 1 : 0,
      );
    })();
    changed();
    return {
      ...share,
      url: `${base.replace(/\/$/, "")}${prefix}/view#${token}`,
    };
  }
  function revoke(id: string) {
    const revoked =
      db.prepare("DELETE FROM shares WHERE id = ?").run(id).changes > 0;
    changed();
    return { revoked };
  }
  function portals() {
    return db
      .prepare(
        "SELECT id, title, origin, addedAt FROM portals ORDER BY addedAt DESC LIMIT 100",
      )
      .all() as z.infer<typeof portalSchema>[];
  }
  const reads = new Map<string, Promise<z.infer<typeof snapshotSchema>>>();
  bb.rpc.register(rpcContract, {
    portals,
    async connect({ invitation }) {
      const { origin } = parseInvitation(invitation);
      const remote = await readRemote(invitation);
      const existing = db
        .prepare(
          "SELECT id, title, origin, addedAt FROM portals WHERE invitation = ?",
        )
        .get(invitation) as z.infer<typeof portalSchema> | undefined;
      if (existing) return existing;
      if (portals().length >= 100)
        throw new Error("Disconnect a portal before adding another.");
      const portal = {
        id: randomUUID(),
        title: remote.title,
        origin,
        addedAt: Date.now(),
      };
      db.prepare("INSERT INTO portals VALUES (?, ?, ?, ?, ?)").run(
        portal.id,
        portal.title,
        portal.origin,
        portal.addedAt,
        invitation,
      );
      changed();
      return portal;
    },
    disconnect({ id }) {
      const removed =
        db.prepare("DELETE FROM portals WHERE id = ?").run(id).changes > 0;
      changed();
      return { removed };
    },
    async follow({ id }) {
      const portal = db
        .prepare("SELECT invitation FROM portals WHERE id = ?")
        .get(id) as { invitation: string } | undefined;
      if (!portal) throw new Error("Portal disconnected.");
      let read = reads.get(id);
      if (!read) {
        read = readRemote(portal.invitation).finally(() => reads.delete(id));
        reads.set(id, read);
      }
      const remote = await read;
      if (!db.prepare("SELECT id FROM portals WHERE id = ?").get(id))
        throw new Error("Portal disconnected.");
      return remote;
    },
    async send({ id, text }) {
      const portal = db
        .prepare("SELECT invitation FROM portals WHERE id = ?")
        .get(id) as { invitation: string } | undefined;
      if (!portal) throw new Error("Portal disconnected.");
      await sendRemote(portal.invitation, text);
      return { sent: true };
    },
    create,
    list: ({ threadId }) => list(threadId),
    revoke: ({ id }) => revoke(id),
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    db.prepare("DELETE FROM shares WHERE threadId = ?").run(thread.id);
    changed();
  });

  // Public shell contains no session data. The data route verifies a per-share
  // capability, never the owner's plugin token or BB credentials.
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
  const html = () =>
    new Response(viewerHtml, {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
  const script = () =>
    new Response(viewerScript, {
      headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" },
    });
  const snapshot = async (request: Request) => {
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token)
      return reply({ error: "This share is unavailable or has expired." }, 404);
    const find = () => {
      const share = db
        .prepare(
          "SELECT id, threadId, expiresAt, canChat FROM shares WHERE tokenHash = ? AND expiresAt > ?",
        )
        .get(hash(token), Date.now()) as
        (Omit<Share, "canChat"> & { canChat: number }) | undefined;
      return share && { ...share, canChat: share.canChat === 1 };
    };
    const share = find();
    if (!share)
      return reply({ error: "This share is unavailable or has expired." }, 404);
    try {
      const [thread, timeline] = await Promise.all([
        bb.sdk.threads.get({ threadId: share.threadId }),
        bb.sdk.threads.timeline({
          threadId: share.threadId,
          segmentLimit: "30",
          includeNestedRows: "true",
        }),
      ]);
      // Recheck after awaits so a revocation during a read cannot release data.
      if (!find())
        return reply(
          { error: "This share is unavailable or has expired." },
          404,
        );
      return reply({
        title: thread.title,
        status: thread.status,
        expiresAt: share.expiresAt,
        canChat: share.canChat,
        rows: projectRows(timeline.rows),
        hasOlderRows: timeline.timelinePage.hasOlderRows,
      });
    } catch {
      return reply(
        { error: "Session temporarily unavailable. Reconnecting…" },
        503,
      );
    }
  };
  const message = async (request: Request) => {
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token)
      return reply({ error: "This share is unavailable or has expired." }, 404);
    const share = db
      .prepare(
        "SELECT threadId, canChat = 1 AS canChat FROM shares WHERE tokenHash = ? AND expiresAt > ?",
      )
      .get(hash(token), Date.now()) as
      { threadId: string; canChat: boolean } | undefined;
    if (!share)
      return reply({ error: "This share is unavailable or has expired." }, 404);
    if (!share.canChat)
      return reply({ error: "Chat is disabled for this invitation." }, 403);
    let body: unknown;
    try {
      const reader = request.body?.getReader();
      if (!reader) return reply({ error: "Invalid message." }, 400);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 100_000) {
            void reader.cancel().catch(() => {});
            return reply({ error: "Message body is too large." }, 413);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return reply({ error: "Invalid message." }, 400);
    }
    const parsed = z
      .object({ text: z.string().trim().min(1).max(20_000) })
      .safeParse(body);
    if (!parsed.success)
      return reply(
        { error: "Message must be between 1 and 20,000 characters." },
        400,
      );
    // Body reads yield: check revocation/expiry again immediately before dispatch.
    if (
      !db
        .prepare(
          "SELECT id FROM shares WHERE tokenHash = ? AND expiresAt > ? AND canChat = 1",
        )
        .get(hash(token), Date.now())
    )
      return reply({ error: "Chat access ended." }, 403);
    try {
      await bb.sdk.threads.send({
        threadId: share.threadId,
        mode: "auto",
        input: [
          {
            type: "text",
            text: `[Shared participant]\n${parsed.data.text}`,
            mentions: [],
          },
        ],
      });
      return reply({ sent: true });
    } catch {
      return reply(
        { error: "The session could not accept that message." },
        409,
      );
    }
  };
  const tunnel = publicTunnel((request) => {
    const path = new URL(request.url).pathname;
    if (path === `${prefix}/view`) return html();
    if (path === `${prefix}/viewer.js`) return script();
    if (path === `${prefix}/snapshot`) return snapshot(request);
    if (path === `${prefix}/message` && request.method === "POST")
      return message(request);
    return new Response("Not found", { status: 404, headers });
  });
  bb.onDispose(() => tunnel.dispose());
  bb.http.route("GET", "/view", html, { auth: "none" });
  bb.http.route("GET", "/viewer.js", script, { auth: "none" });
  bb.http.route("GET", "/snapshot", (c) => snapshot(c.req.raw), {
    auth: "none",
  });
  bb.http.route("POST", "/message", (c) => message(c.req.raw), {
    auth: "none",
  });

  const usage =
    "bb session-share create <thread-id> [hours=24] | list <thread-id> | revoke <share-id>";
  bb.cli.register({
    name: "session-share",
    summary: "Share live sessions with optional chat",
    commands: [
      {
        name: "create",
        summary: "Create an expiring link",
        usage: "bb session-share create <thread-id> [hours=24]",
      },
      {
        name: "list",
        summary: "List active share IDs",
        usage: "bb session-share list <thread-id>",
      },
      {
        name: "revoke",
        summary: "Stop a share",
        usage: "bb session-share revoke <share-id>",
      },
    ],
    async run(argv) {
      const [command, id, hours, ...rest] = argv;
      try {
        if (rest.length) throw new Error(usage);
        if (command === "create" && id) {
          const result = await create(
            createInput.parse({
              threadId: id,
              hours: hours === undefined ? 24 : Number(hours),
              canChat: false,
            }),
          );
          return { exitCode: 0, stdout: JSON.stringify(result) };
        }
        if (command === "list" && id && !hours)
          return {
            exitCode: 0,
            stdout: JSON.stringify(
              list(threadInput.parse({ threadId: id }).threadId),
            ),
          };
        if (command === "revoke" && id && !hours)
          return {
            exitCode: 0,
            stdout: JSON.stringify(revoke(z.string().uuid().parse(id))),
          };
        return {
          exitCode:
            command === "help" || command === "--help" || !command ? 0 : 1,
          stdout: usage,
        };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : "Sharing failed",
        };
      }
    },
  });
}
