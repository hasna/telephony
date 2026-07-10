// Vendored from @hasna/mcp-harness (open-mcp) — the two helpers telephony's
// MCP HTTP transport needs: `resolveMcpHttpPort` (strict port resolution) and
// `handleStatelessMcpNode` (stateless Streamable-HTTP request handler).
//
// WHY VENDORED: @hasna/mcp-harness is a private, unpublished package. Depending
// on it via `file:../open-mcp` made `bun add -g @hasna/telephony` impossible on
// a clean machine (the published tarball carried a 404 relative-path dep). This
// module inlines only the surface telephony uses so the package installs
// standalone. Keep in sync with open-mcp/src/port.ts + open-mcp/src/node.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT_MIN = 0;
const PORT_MAX = 65535;

/** Harness fallback default when a service supplies no default of its own. */
export const DEFAULT_MCP_HTTP_PORT = 8899;

function invalidPortMessage(source: string, value: string): string {
  return `Invalid ${source} "${value}". Expected an integer between ${PORT_MIN} and ${PORT_MAX}.`;
}

/** Validate an already-numeric port, throwing on out-of-range / non-integer. */
export function validatePort(port: number, source: string): number {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(invalidPortMessage(source, String(port)));
  }
  return port;
}

/** Strict string→port parser: only bare digit strings are accepted. */
export function parsePortValue(value: string, source: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(invalidPortMessage(source, value));
  }
  return validatePort(Number(trimmed), source);
}

/** True when the server should run over HTTP (`--http` or `MCP_HTTP=1`). */
export function isHttpMode(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return argv.includes("--http") || env.MCP_HTTP === "1";
}

/**
 * Parse `--http` and any `--port`/`--port=` argument from argv.
 * Throws (strict) on a malformed port value.
 */
export function parseHttpArgv(argv: readonly string[] = process.argv): {
  http: boolean;
  port?: number;
} {
  const http = isHttpMode(argv);
  let port: number | undefined;

  const portEqualsArg = argv.find((arg) => arg.startsWith("--port="));
  if (portEqualsArg) {
    port = parsePortValue(portEqualsArg.slice("--port=".length), "--port");
  }

  const portIdx = argv.indexOf("--port");
  if (portIdx !== -1) {
    const value = argv[portIdx + 1];
    if (value === undefined) {
      throw new Error(invalidPortMessage("--port", ""));
    }
    port = parsePortValue(value, "--port");
  }

  return { http, port };
}

/**
 * Resolve the HTTP port with precedence:
 *   explicit → `--port`/`--port=` argv → `MCP_HTTP_PORT` env → `default`.
 */
export function resolveMcpHttpPort(opts?: {
  explicit?: number;
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  default?: number;
}): number {
  const argv = opts?.argv ?? process.argv;
  const env = opts?.env ?? process.env;

  if (opts?.explicit != null) {
    return validatePort(opts.explicit, "--port");
  }

  const { port } = parseHttpArgv(argv);
  if (port != null) return port;

  const envPort = env.MCP_HTTP_PORT;
  if (envPort && envPort.trim() !== "") {
    return parsePortValue(envPort, "MCP_HTTP_PORT");
  }

  return opts?.default ?? DEFAULT_MCP_HTTP_PORT;
}

/** A factory that builds a connectable MCP server instance. */
export type BuildServer = () => { connect(t: unknown): Promise<void>; close(): Promise<void> } | Promise<{
  connect(t: unknown): Promise<void>;
  close(): Promise<void>;
}>;

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as unknown) : undefined;
}

/**
 * Handle a single stateless MCP request. Emits a JSON-RPC `-32603` 500 on
 * failure.
 */
export async function handleStatelessMcpNode(
  req: IncomingMessage,
  res: ServerResponse,
  buildServer: BuildServer,
  serviceName: string,
): Promise<void> {
  try {
    const server = await buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);

    const body = req.method === "POST" ? await readJsonBody(req) : undefined;
    await transport.handleRequest(req, res, body);

    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    console.error(`[${serviceName}-mcp] HTTP error:`, error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
      );
    }
  }
}
