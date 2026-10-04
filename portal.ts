import { lookup } from "node:dns/promises";
import { request } from "node:https";
import ipaddr from "ipaddr.js";
import { z } from "zod";

export const snapshotSchema = z.object({
  title: z.string().max(1000),
  status: z.string().max(100),
  expiresAt: z.number(),
  canChat: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        id: z.string().max(1000),
        role: z.enum(["user", "assistant", "activity"]),
        text: z.string().max(40_000),
      }),
    )
    .max(200),
  hasOlderRows: z.boolean(),
});
export type PortalSnapshot = z.infer<typeof snapshotSchema>;
export function parseInvitation(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    (url.port && url.port !== "443") ||
    url.pathname !== "/api/v1/plugins/session-share/http/view" ||
    !/^#[A-Za-z0-9_-]{43}$/.test(url.hash)
  )
    throw new Error("Paste a complete Session Share invitation link.");
  const token = url.hash.slice(1);
  url.hash = "";
  url.pathname = "/api/v1/plugins/session-share/http/snapshot";
  return { endpoint: url.href, token, origin: url.origin };
}
export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
/** Resolve and pin the public IP for this connection. Never follow redirects. */
export async function readRemote(invitation: string): Promise<PortalSnapshot> {
  const { endpoint, token } = parseInvitation(invitation);
  const url = new URL(endpoint);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("Portals require a public HTTPS address.");
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        family: address.family,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              response.statusCode === 404
                ? "Sharing ended or the invitation expired."
                : "The other BB is unavailable. Reconnecting…",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 10_000_000) {
            req.destroy(new Error("Remote session is too large."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolve(
              snapshotSchema.parse(
                JSON.parse(Buffer.concat(chunks).toString("utf8")),
              ),
            );
          } catch {
            reject(new Error("The other BB returned an incompatible session."));
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error("The other BB did not respond.")),
      15_000,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", () =>
      reject(new Error("Could not connect to the other BB.")),
    );
    req.end();
  });
}

export async function sendRemote(
  invitation: string,
  text: string,
): Promise<void> {
  const { endpoint, token } = parseInvitation(invitation);
  const url = new URL(endpoint);
  url.pathname = url.pathname.replace(/\/snapshot$/, "/message");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("Portals require a public HTTPS address.");
  const address = addresses[0]!;
  await new Promise<void>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        family: address.family,
        lookup: (_h, _o, cb) => cb(null, address.address, address.family),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 64_000) {
            req.destroy(new Error("Remote response is too large."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (response.statusCode === 200) resolve();
          else {
            try {
              reject(
                new Error(
                  (
                    JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                      error?: string;
                    }
                  ).error || "The other BB rejected the message.",
                ),
              );
            } catch {
              reject(new Error("The other BB rejected the message."));
            }
          }
        });
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error("The other BB did not respond.")),
      15_000,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", () =>
      reject(new Error("Could not send the message to the other BB.")),
    );
    req.end(JSON.stringify({ text }));
  });
}
