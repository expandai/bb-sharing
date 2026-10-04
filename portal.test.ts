import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInvitation, isPublicAddress, snapshotSchema } from "./portal";

test("invitation parser extracts only the exact viewer capability", () => {
  const token = "a".repeat(43);
  const parsed = parseInvitation(
    `https://peer.example/api/v1/plugins/session-share/http/view#${token}`,
  );
  assert.equal(
    parsed.endpoint,
    "https://peer.example/api/v1/plugins/session-share/http/snapshot",
  );
  assert.equal(parsed.token, token);
  for (const url of [
    `http://peer.example/api/v1/plugins/session-share/http/view#${token}`,
    `https://user:pass@peer.example/api/v1/plugins/session-share/http/view#${token}`,
    `https://peer.example:1234/api/v1/plugins/session-share/http/view#${token}`,
    `https://peer.example/api/v1/threads#${token}`,
    "https://peer.example/api/v1/plugins/session-share/http/view#bad",
  ])
    assert.throws(() => parseInvitation(url));
});
test("peer connections cannot access private or special address ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.100.100.100",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "224.0.0.1",
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});
test("remote snapshot schema strips extras and rejects oversized or unexpected rows", () => {
  const data = {
    title: "Remote",
    status: "active",
    expiresAt: Date.now(),
    canChat: false,
    hasOlderRows: false,
    rows: [],
    secret: "not forwarded",
  };
  assert.ok(!("secret" in snapshotSchema.parse(data)));
  assert.throws(() =>
    snapshotSchema.parse({
      ...data,
      rows: [{ id: "x", role: "system", text: "oops" }],
    }),
  );
  assert.throws(() =>
    snapshotSchema.parse({
      ...data,
      rows: Array.from({ length: 201 }, () => ({
        id: "x",
        role: "user",
        text: "x",
      })),
    }),
  );
});
