import { useCallback, useEffect, useRef, useState } from "react";
import {
  Markdown,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { PortalSnapshot } from "./portal";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";

type Portal = { id: string; title: string; origin: string; addedAt: number };
function Conversation({ snapshot }: { snapshot: PortalSnapshot }) {
  const groups: { activities: boolean; rows: PortalSnapshot["rows"] }[] = [];
  for (const row of snapshot.rows) {
    const previous = groups.at(-1);
    if (row.role === "activity" && previous?.activities)
      previous.rows.push(row);
    else groups.push({ activities: row.role === "activity", rows: [row] });
  }
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      {snapshot.hasOlderRows && (
        <p className="text-center text-xs text-muted-foreground">
          Recent session activity
        </p>
      )}
      {groups.map((group) =>
        group.activities ? (
          <details
            key={group.rows[0]!.id}
            className="text-xs text-muted-foreground"
          >
            <summary className="cursor-pointer select-none py-1">
              {group.rows.length}{" "}
              {group.rows.length === 1 ? "action" : "actions"}{" "}
              <span className="ml-2 opacity-60">
                {group.rows.some((r) => r.text.endsWith("pending"))
                  ? "Working…"
                  : ""}
              </span>
            </summary>
            <div className="ml-1 mt-2 space-y-2 border-l border-border py-1 pl-4">
              {group.rows.map((row) => (
                <p key={row.id}>{row.text}</p>
              ))}
            </div>
          </details>
        ) : (
          group.rows.map((row) => (
            <article
              key={row.id}
              className={
                row.role === "user"
                  ? "rounded-xl bg-muted/60 px-5 py-4"
                  : "px-1"
              }
            >
              <Markdown
                content={row.text
                  .replace(/^([ \t]*)::/gm, "$1\\:\\:")
                  .replace(/!\[/g, "\\![")}
              />
            </article>
          ))
        ),
      )}
      {!groups.length && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Waiting for the session’s first message.
        </p>
      )}
    </div>
  );
}
function RemoteSession({
  portal,
  disconnect,
}: {
  portal: Portal;
  disconnect: () => Promise<void>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [snapshot, setSnapshot] = useState<PortalSnapshot | null>(null);
  const [error, setError] = useState("");
  const [following, setFollowing] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await rpc.call("follow", { id: portal.id });
        if (!disposed) {
          setSnapshot(next);
          setError("");
        }
      } catch (cause) {
        if (!disposed) {
          setSnapshot(null);
          setError(cause instanceof Error ? cause.message : "Connection lost");
        }
      } finally {
        if (!disposed) timer = setTimeout(refresh, 2000);
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [rpc, portal.id]);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [snapshot]);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${error ? "bg-destructive" : snapshot ? "bg-emerald-500" : "bg-muted-foreground"}`}
            />
            <h2 className="truncate text-sm font-medium">
              {snapshot?.title || portal.title}
            </h2>
          </div>
          <p className="mt-1 truncate pl-4 text-xs text-muted-foreground">
            {new URL(portal.origin).hostname} <span className="mx-1">·</span>{" "}
            {error ? "Disconnected" : snapshot ? snapshot.status : "Connecting"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void disconnect().catch((e) => setError(String(e)))}
        >
          Disconnect
        </Button>
      </header>
      <div
        ref={scroll}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={() => {
          const el = scroll.current!;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          setFollowing(follow.current);
        }}
      >
        {error ? (
          <div role="alert" className="mx-auto max-w-lg px-6 py-20 text-center">
            <p className="text-sm font-medium">Connection interrupted</p>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <p className="mt-4 text-xs text-muted-foreground">
              This portal will reconnect automatically. If the owner stopped
              sharing, ask for a new invitation.
            </p>
          </div>
        ) : snapshot ? (
          <Conversation snapshot={snapshot} />
        ) : (
          <p className="py-20 text-center text-sm text-muted-foreground">
            Connecting to the other BB…
          </p>
        )}
      </div>
      {snapshot?.canChat && !error && (
        <form
          className="flex gap-2 border-t border-border px-6 py-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text || sending) return;
            setSending(true);
            setError("");
            try {
              await rpc.call("send", { id: portal.id, text });
              setDraft("");
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not send message",
              );
            } finally {
              setSending(false);
            }
          }}
        >
          <textarea
            aria-label="Message shared session"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message the shared session…"
            rows={2}
            maxLength={20_000}
            className="min-h-10 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button type="submit" disabled={sending || !draft.trim()}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </form>
      )}
      <footer className="flex items-center justify-between border-t border-border px-6 py-3 text-xs text-muted-foreground">
        <span>
          Shared session <span className="mx-1">·</span>{" "}
          {snapshot?.canChat ? "Chat enabled" : "View only"}
        </span>
        {!following && (
          <button
            className="text-foreground"
            onClick={() => {
              follow.current = true;
              setFollowing(true);
              if (scroll.current)
                scroll.current.scrollTop = scroll.current.scrollHeight;
            }}
          >
            Follow live ↓
          </button>
        )}
        <span>
          {snapshot
            ? `Expires ${new Date(snapshot.expiresAt).toLocaleString()}`
            : "Live portal"}
        </span>
      </footer>
    </section>
  );
}
export function PortalsPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [portals, setPortals] = useState<Portal[]>([]);
  const [invitation, setInvitation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    rpc.call("portals").then(setPortals, (e) => setError(String(e)));
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime("shares-changed", refresh);
  const selected = portals.find((p) => p.id === subPath);
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border md:w-64 md:border-b-0 md:border-r">
        <div className="px-4 pb-3 pt-5">
          <h1 className="text-sm font-semibold">Shared sessions</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            A window into another BB
          </p>
        </div>
        <form
          className="space-y-2 px-3 pb-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !invitation.trim()) return;
            setBusy(true);
            setError("");
            try {
              const portal = await rpc.call("connect", {
                invitation: invitation.trim(),
              });
              setInvitation("");
              refresh();
              navigate.toPluginPanel("portals", { subPath: portal.id });
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "Connection failed",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input
            aria-label="Session invitation"
            placeholder="Paste an invitation link"
            type="password"
            value={invitation}
            onChange={(e) => setInvitation(e.target.value)}
          />
          <Button
            className="w-full"
            variant="outline"
            size="sm"
            disabled={busy || !invitation.trim()}
          >
            {busy ? "Connecting…" : "Connect session"}
          </Button>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
        <nav
          aria-label="Connected sessions"
          className="max-h-48 space-y-1 overflow-y-auto px-2 pb-3 md:max-h-none md:flex-1"
        >
          {portals.map((portal) => (
            <button
              key={portal.id}
              onClick={() =>
                navigate.toPluginPanel("portals", { subPath: portal.id })
              }
              aria-current={selected?.id === portal.id ? "page" : undefined}
              className={`w-full rounded-lg px-3 py-3 text-left hover:bg-muted/50 ${selected?.id === portal.id ? "bg-muted" : ""}`}
            >
              <span className="block truncate text-sm">{portal.title}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {new URL(portal.origin).hostname}
              </span>
            </button>
          ))}
        </nav>
      </aside>
      {selected ? (
        <RemoteSession
          key={selected.id}
          portal={selected}
          disconnect={async () => {
            await rpc.call("disconnect", { id: selected.id });
            refresh();
            navigate.toPluginPanel("portals");
          }}
        />
      ) : (
        <main className="flex flex-1 items-center justify-center px-8 py-20">
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-border text-2xl text-muted-foreground">
              ↗
            </div>
            <h2 className="text-xl font-medium">
              Bring a session into your BB
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Ask a teammate to choose Share session in their thread, then paste
              their invitation here. Their session stays in this sidebar and
              updates as they work.
            </p>
            <p className="mt-5 text-xs text-muted-foreground">
              Both BB instances need the Session Share plugin.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}
