import { test } from "node:test";
import assert from "node:assert/strict";
import { publicTunnel, startViewerServer } from "./tunnel";

test("dedicated listener rejects writes and does not proxy arbitrary BB routes", async (t) => {
  const { server, origin } = await startViewerServer((request) => {
    if (new URL(request.url).pathname !== "/view")
      return new Response("Not found", { status: 404 });
    return new Response("Viewer", { headers: { "Cache-Control": "no-store" } });
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const view = await fetch(origin + "/view");
  assert.equal(await view.text(), "Viewer");
  assert.equal(view.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(origin + "/api/v1/threads")).status, 404);
  assert.equal((await fetch(origin + "/view", { method: "POST" })).status, 405);
});
test("missing tunnel executable fails with setup guidance and can retry", async () => {
  const tunnel = publicTunnel(() => new Response("Viewer"));
  try {
    await assert.rejects(
      tunnel.origin("/does-not-exist/cloudflared"),
      /Install cloudflared/,
    );
    await assert.rejects(
      tunnel.origin("/does-not-exist/cloudflared"),
      /Install cloudflared/,
    );
  } finally {
    await tunnel.dispose();
  }
  await assert.rejects(tunnel.origin("anything"), /Plugin stopped/);
});

test("tunnel forwards chat POST body and authorization only to the message route", async (t) => {
  const { server, origin } = await startViewerServer(async (request) => {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("authorization"), "Bearer test");
    assert.deepEqual(await request.json(), { text: "hello" });
    return Response.json({ sent: true });
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const response = await fetch(
    origin + "/api/v1/plugins/session-share/http/message",
    {
      method: "POST",
      headers: { authorization: "Bearer test" },
      body: JSON.stringify({ text: "hello" }),
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });
  assert.equal(
    (await fetch(origin + "/api/v1/threads", { method: "POST" })).status,
    405,
  );
  assert.equal(
    (
      await fetch(origin + "/api/v1/plugins/session-share/http/message", {
        method: "POST",
        body: "x".repeat(100001),
      })
    ).status,
    413,
  );
});
