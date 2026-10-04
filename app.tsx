import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { PortalsPage } from "./portal-app";

type Share = {
  id: string;
  expiresAt: number;
  threadId: string;
  canChat: boolean;
};
function SharePanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [shares, setShares] = useState<Share[]>([]);
  const [hours, setHours] = useState(24);
  const [canChat, setCanChat] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const refetch = useCallback(() => {
    rpc
      .call("list", { threadId })
      .then(setShares, (e: Error) => setError(e.message));
  }, [rpc, threadId]);
  useEffect(refetch, [refetch]);
  useRealtime("shares-changed", refetch);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sharing failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Give a teammate an invitation to this session. In their BB, they open
        Shared sessions and paste it to connect. They can follow your
        conversation live until you stop sharing.
      </p>
      <label className="flex items-center gap-3 text-sm">
        Link expires in
        <select
          aria-label="Link lifetime"
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="rounded border border-input bg-background p-2"
        >
          <option value={1}>1 hour</option>
          <option value={24}>24 hours</option>
          <option value={168}>7 days</option>
        </select>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={canChat}
          onChange={(e) => setCanChat(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block">Allow chat</span>
          <span className="block text-xs text-muted-foreground">
            Recipients can send messages to this session as shared participants.
          </span>
        </span>
      </label>
      <Button
        disabled={busy}
        onClick={() =>
          run(async () => {
            const share = await rpc.call("create", {
              threadId,
              hours,
              canChat,
            });
            setUrl(new URL(share.url, window.location.origin).href);
            setCopied(false);
          })
        }
      >
        Create invitation
      </Button>
      {url && (
        <div className="space-y-2">
          <Input
            aria-label="Share link"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="outline"
            onClick={() =>
              run(async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              })
            }
          >
            {copied ? "Copied" : "Copy invitation"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Keep this link. For temporary tunnels, create a new link after
            restarting BB or reloading this plugin.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <h3 className="text-sm font-medium">Active links</h3>
      {shares.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active share links.</p>
      ) : (
        shares.map((share) => (
          <div
            key={share.id}
            className="flex items-center justify-between gap-2 border-t border-border pt-2 text-sm"
          >
            <span>
              Expires {new Date(share.expiresAt).toLocaleString()} ·{" "}
              {share.canChat ? "Chat enabled" : "View only"}
            </span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await rpc.call("revoke", { id: share.id });
                  setUrl("");
                })
              }
            >
              Stop sharing
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
function ShareAction({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Share session"
        onClick={() => setOpen(true)}
      >
        {isCompactViewport ? "Share" : "Share session"}
      </Button>
      {open && (
        <ShareDialog
          key={threadId}
          threadId={threadId}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
function ShareDialog({
  threadId,
  close,
}: {
  threadId: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={close}
      onClose={close}
      aria-labelledby="share-title"
      className="m-auto w-full max-w-lg rounded-xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id="share-title" className="text-lg font-semibold">
          Share session
        </h2>
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
      </div>
      <SharePanel threadId={threadId} />
    </dialog>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "portals",
    path: "portals",
    title: "Shared sessions",
    icon: "Share2",
    component: PortalsPage,
  });
  app.slots.experimental_threadHeaderAction({
    id: "share-session",
    title: "Share session",
    component: ShareAction,
  });
});
