import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { projectRows } from "./projection";

async function fixture() {
  let title = "Live test";
  const host = createFakePluginHost({
    pluginId: "session-share",
    settings: { publicBaseUrl: "https://team.example" },
    sdk: {
      threads: {
        get: async () => makeThreadResponse({ id: "t1", title }),
        timeline: async () => ({
          rows: [],
          timelinePage: { hasOlderRows: false },
        }),
      },
    },
  });
  await plugin(host.bb);
  host.harness.sdk.stub("threads.send", async () => ({
    ok: true,
    delivery: "sent",
  }));
  const create = async (threadId = "t1") =>
    (await host.harness.behavior.callRpc("create", { threadId, hours: 1 })) as {
      id: string;
      url: string;
    };
  const fetch = (token?: string) =>
    host.harness.behavior.fetchHttp("GET", "/snapshot", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  return {
    ...host,
    create,
    fetch,
    setTitle: (v: string) => {
      title = v;
    },
  };
}
test("capability gates live data, list never returns tokens, revocation persists across reload", async (t) => {
  const f = await fixture();
  t.after(() => f.harness.lifecycle.dispose());
  assert.equal((await f.fetch()).status, 404);
  assert.equal((await f.fetch("x".repeat(43))).status, 404);
  const share = await f.create();
  const token = new URL(share.url).hash.slice(1);
  assert.equal(token.length, 43);
  assert.equal((await (await f.fetch(token)).json()).title, "Live test");
  f.setTitle("Updated live");
  assert.equal((await (await f.fetch(token)).json()).title, "Updated live");
  const list = JSON.stringify(
    await f.harness.behavior.callRpc("list", { threadId: "t1" }),
  );
  assert.ok(!list.includes(token));
  assert.ok(!list.includes("tokenHash"));
  const next = await f.harness.lifecycle.reload(plugin);
  t.after(() => next.harness.lifecycle.dispose());
  const fetchNext = () =>
    next.harness.behavior.fetchHttp("GET", "/snapshot", {
      headers: { authorization: `Bearer ${token}` },
    });
  assert.equal((await fetchNext()).status, 200);
  await next.harness.behavior.callRpc("revoke", { id: share.id });
  assert.equal((await fetchNext()).status, 404);
  const last = await next.harness.lifecycle.reload(plugin);
  t.after(() => last.harness.lifecycle.dispose());
  assert.equal(
    (
      await last.harness.behavior.fetchHttp("GET", "/snapshot", {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status,
    404,
  );
});
test("expiry and deletion stop access", async (t) => {
  const f = await fixture();
  t.after(() => f.harness.lifecycle.dispose());
  const share = await f.create();
  const token = new URL(share.url).hash.slice(1);
  f.bb.storage.database().prepare("UPDATE shares SET expiresAt = 0").run();
  assert.equal((await f.fetch(token)).status, 404);
  const next = await f.create();
  await f.harness.behavior.emitThreadEvent("thread.deleted", {
    thread: makeThreadResponse({ id: "t1" }),
  });
  assert.equal((await f.fetch(new URL(next.url).hash.slice(1))).status, 404);
});
test("revocation during an in-flight timeline read prevents a response containing data", async (t) => {
  const f = await fixture();
  t.after(() => f.harness.lifecycle.dispose());
  const share = await f.create();
  f.harness.inspection.sdk.stub("threads.timeline", async () => {
    await f.harness.behavior.callRpc("revoke", { id: share.id });
    return { rows: [], timelinePage: { hasOlderRows: false } };
  });
  assert.equal((await f.fetch(new URL(share.url).hash.slice(1))).status, 404);
});
test("input validation rejects unbounded lifetime and CLI typos", async (t) => {
  const f = await fixture();
  t.after(() => f.harness.lifecycle.dispose());
  await assert.rejects(
    f.harness.behavior.callRpc("create", {
      threadId: "t1",
      hours: 169,
    }),
  );
  assert.equal(
    (await f.harness.behavior.runCli(["create", "t1", "NaN"])).exitCode,
    1,
  );
  assert.equal(
    (await f.harness.behavior.runCli(["list", "t1", "extra"])).exitCode,
    1,
  );
});
test("viewer shell contains no session data and disables caching and framing", async (t) => {
  const f = await fixture();
  t.after(() => f.harness.lifecycle.dispose());
  const response = await f.harness.behavior.fetchHttp("GET", "/view");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(
    response.headers.get("content-security-policy")!,
    /frame-ancestors 'none'/,
  );
  assert.ok(!(await response.text()).includes("Live test"));
});
test("projection allows text and activity status only, including nested turns", () => {
  // Minimal wire fixtures deliberately contain sensitive extra fields.
  const input = [
    {
      kind: "conversation",
      role: "user",
      initiator: "user",
      id: "1",
      text: "Hello",
      attachments: { localFilePaths: ["/secret"] },
    },
    {
      kind: "conversation",
      role: "user",
      initiator: "system",
      id: "2",
      text: "Private instructions",
    },
    {
      kind: "turn",
      children: [
        {
          kind: "conversation",
          role: "assistant",
          id: "3",
          text: "<script>alert(1)</script>",
        },
        {
          kind: "work",
          id: "4",
          workKind: "command",
          status: "completed",
          output: "SECRET",
        },
      ],
    },
  ];
  assert.deepEqual(projectRows(input as Parameters<typeof projectRows>[0]), [
    { id: "1", role: "user", text: "Hello" },
    { id: "3", role: "assistant", text: "<script>alert(1)</script>" },
    { id: "4", role: "activity", text: "command · completed" },
  ]);
});

test("chat permission gates remote messages and attributes accepted text", async (t) => {
  const f = await fixture();
  t.after(() => f.harness.lifecycle.dispose());
  const viewOnly = await f.create();
  const viewToken = new URL(viewOnly.url).hash.slice(1);
  const denied = await f.harness.behavior.fetchHttp("POST", "/message", {
    headers: {
      authorization: `Bearer ${viewToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: "hello" }),
  });
  assert.equal(denied.status, 403);
  const chat = (await f.harness.behavior.callRpc("create", {
    threadId: "t1",
    hours: 1,
    canChat: true,
  })) as { id: string; url: string };
  const token = new URL(chat.url).hash.slice(1);
  const accepted = await f.harness.behavior.fetchHttp("POST", "/message", {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: "Please check this" }),
  });
  assert.equal(accepted.status, 200);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 1);
});

test("BB-hosted chat route limits bytes before JSON parsing", async (t) => {
  const f = await fixture();
  t.after(() => f.harness.lifecycle.dispose());
  const share = (await f.harness.behavior.callRpc("create", {
    threadId: "t1",
    hours: 1,
    canChat: true,
  })) as { url: string };
  const response = await f.harness.behavior.fetchHttp("POST", "/message", {
    headers: {
      authorization: `Bearer ${new URL(share.url).hash.slice(1)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: "x".repeat(100001) }),
  });
  assert.equal(response.status, 413);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
});
