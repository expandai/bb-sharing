import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const invitation = process.env.BB_PORTAL_TEST_INVITATION;
test(
  "isolated receiving BB follows a remote session without local thread access",
  { skip: !invitation },
  async () => {
    let receiver = createFakePluginHost({ pluginId: "session-share" });
    await plugin(receiver.bb);
    try {
      const portal = (await receiver.harness.behavior.callRpc("connect", {
        invitation,
      })) as { id: string; title: string };
      const snapshot = (await receiver.harness.behavior.callRpc("follow", {
        id: portal.id,
      })) as { title: string; rows: unknown[] };
      assert.equal(snapshot.title, portal.title);
      assert.ok(snapshot.rows.length > 0);
      const list = JSON.stringify(
        await receiver.harness.behavior.callRpc("portals", null),
      );
      assert.ok(!list.includes(new URL(invitation!).hash.slice(1)));
      assert.deepEqual(receiver.harness.inspection.sdk.calls, []);
      receiver = await receiver.harness.lifecycle.reload(plugin);
      assert.equal(
        (
          (await receiver.harness.behavior.callRpc("follow", {
            id: portal.id,
          })) as { title: string }
        ).title,
        portal.title,
      );
      await receiver.harness.behavior.callRpc("disconnect", { id: portal.id });
      await assert.rejects(
        receiver.harness.behavior.callRpc("follow", { id: portal.id }),
        /disconnected/,
      );
    } finally {
      await receiver.harness.lifecycle.dispose();
    }
  },
);
