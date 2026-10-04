import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Dedicated listener: only the caller's explicitly allowed viewer routes exist. */
export async function startViewerServer(
  handle: (request: Request) => Promise<Response> | Response,
) {
  const server = createServer(async (req, res) => {
    try {
      // Never use the incoming Host to select an upstream.
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (
        req.method !== "GET" &&
        !(
          req.method === "POST" &&
          url.pathname === "/api/v1/plugins/session-share/http/message"
        )
      ) {
        res.writeHead(405);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 100_000) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const response = await handle(
        new Request(url, {
          method: req.method,
          ...(req.method === "POST"
            ? { body: Buffer.concat(chunks).toString("utf8") }
            : {}),
          headers: {
            authorization:
              typeof req.headers.authorization === "string"
                ? req.headers.authorization
                : "",
          },
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(503, { "Cache-Control": "no-store" });
      res.end("Unavailable");
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Unable to start viewer listener");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

export function publicTunnel(
  handle: (request: Request) => Promise<Response> | Response,
) {
  let pending: Promise<string> | undefined;
  let process: ChildProcess | undefined;
  let listener: Server | undefined;
  let directory: string | undefined;
  let disposed = false;
  async function close() {
    if (process) {
      process.kill("SIGKILL");
      process = undefined;
    }
    if (listener) {
      listener.closeAllConnections();
      await new Promise<void>((resolve) => listener!.close(() => resolve()));
      listener = undefined;
    }
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  }
  async function start(binary: string): Promise<string> {
    await close();
    if (disposed) throw new Error("Plugin stopped");
    const gateway = await startViewerServer(handle);
    listener = gateway.server;
    directory = await mkdtemp(join(tmpdir(), "bb-session-share-"));
    const config = join(directory, "config.yml");
    await writeFile(config, "{}\n");
    if (disposed) throw new Error("Plugin stopped");
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(
        binary,
        [
          "tunnel",
          "--config",
          config,
          "--no-autoupdate",
          "--url",
          gateway.origin,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      process = child;
      let buffer = "";
      let ready = false;
      const timer = setTimeout(
        () =>
          reject(new Error("Public tunnel did not start within 30 seconds.")),
        30_000,
      );
      const output = (chunk: Buffer) => {
        buffer = (buffer + chunk.toString()).slice(-8192);
        const url = buffer.match(
          /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/,
        )?.[0];
        if (url) {
          clearTimeout(timer);
          ready = true;
          resolve(url);
        }
      };
      child.stdout!.on("data", output);
      child.stderr!.on("data", output);
      child.once("error", () => {
        clearTimeout(timer);
        reject(
          new Error(
            "Install cloudflared on the BB server, or set cloudflaredPath to its executable.",
          ),
        );
      });
      child.once("exit", () => {
        clearTimeout(timer);
        // A dead tunnel must never be returned for a new link.
        if (ready && process === child) pending = undefined;
        reject(
          new Error(
            "Public tunnel stopped. Create a new share link to reconnect.",
          ),
        );
      });
    });
  }
  return {
    async origin(binary: string) {
      if (disposed) throw new Error("Plugin stopped");
      if (!pending)
        pending = start(binary).catch(async (error) => {
          await close();
          pending = undefined;
          throw error;
        });
      return pending;
    },
    async dispose() {
      disposed = true;
      await close();
      await pending?.catch(() => {});
      await close();
    },
  };
}
