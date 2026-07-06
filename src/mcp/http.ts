import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolveMcpHttpPort as harnessResolveMcpHttpPort } from "@hasna/mcp-harness";
import { handleStatelessMcpNode } from "@hasna/mcp-harness/node";
import { buildServer } from "./server.js";

/**
 * open-telephony MCP transport/port boilerplate — now a thin shim over
 * `@hasna/mcp-harness`. The public API (names, signatures, health shape) is
 * preserved so `mcp/index.ts` and the tests are unchanged; the `POST /mcp`
 * request handling and env/default port resolution now delegate to the
 * shared harness.
 *
 * Two bits stay hand-wired because telephony's dialect diverges from the
 * harness's own semantics:
 *   - `isHttpMode`/`isStdioMode` default to **stdio** when neither `--http`/
 *     `--stdio` nor `MCP_HTTP`/`MCP_STDIO` is set. The harness treats the two
 *     as independent, no-default flags (see open-files/open-crawl, which
 *     default to HTTP), so delegating here would flip telephony's default
 *     transport.
 *   - `parseCliPort` has no harness equivalent (bare `--port` argv lookup,
 *     no env/default fallback) and is used by the CLI's `--port` flag.
 */

export const DEFAULT_MCP_HTTP_PORT = 8884;
const DEFAULT_HOST = "127.0.0.1";

export interface McpHttpServerOptions {
  name: string;
  port?: number;
  host?: string;
}

export function resolveMcpHttpPort(explicitPort?: number): number {
  // argv: [] — CLI already resolved any --port flag into `explicitPort` via
  // `parseCliPort`; avoid re-parsing process.argv a second time.
  return harnessResolveMcpHttpPort({ explicit: explicitPort, argv: [], default: DEFAULT_MCP_HTTP_PORT });
}

export function parseCliPort(args: string[]): number | undefined {
  const idx = args.indexOf("--port");
  if (idx >= 0 && args[idx + 1]) {
    const parsed = parseInt(args[idx + 1]!, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function resolveMcpTransportMode(args: string[]): "stdio" | "http" {
  if (args.includes("--stdio")) return "stdio";
  if (args.includes("--http")) return "http";
  if (process.env.MCP_STDIO === "1") return "stdio";
  if (process.env.MCP_HTTP === "1") return "http";
  return "stdio";
}

export function isHttpMode(args: string[]): boolean {
  return resolveMcpTransportMode(args) === "http";
}

export function isStdioMode(args: string[]): boolean {
  return resolveMcpTransportMode(args) === "stdio";
}

export async function startMcpHttpServer(options: McpHttpServerOptions): Promise<{ server: Server; port: number; host: string }> {
  const host = options.host ?? DEFAULT_HOST;
  const port = resolveMcpHttpPort(options.port);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: options.name }));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    await handleStatelessMcpNode(req, res, buildServer, options.name);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  console.error(`[${options.name}-mcp] Streamable HTTP listening on http://${host}:${boundPort}/mcp`);
  return { server: httpServer, port: boundPort, host };
}
