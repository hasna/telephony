import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";

export const DEFAULT_MCP_HTTP_PORT = 8884;
const DEFAULT_HOST = "127.0.0.1";

export interface McpHttpServerOptions {
  name: string;
  port?: number;
  host?: string;
}

export function resolveMcpHttpPort(explicitPort?: number): number {
  if (explicitPort !== undefined && !Number.isNaN(explicitPort)) return explicitPort;
  const envPort = process.env.MCP_HTTP_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return DEFAULT_MCP_HTTP_PORT;
}

export function parseCliPort(args: string[]): number | undefined {
  const idx = args.indexOf("--port");
  if (idx >= 0 && args[idx + 1]) {
    const parsed = parseInt(args[idx + 1]!, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

export function isHttpMode(args: string[]): boolean {
  return args.includes("--http") || process.env.MCP_HTTP === "1";
}

export function isStdioMode(args: string[]): boolean {
  return args.includes("--stdio") || process.env.MCP_STDIO === "1";
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return undefined;
  return JSON.parse(text);
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

    const mcpServer = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await mcpServer.connect(transport);
      const body = req.method === "POST" ? await readJsonBody(req) : undefined;
      await transport.handleRequest(req, res, body);
    } finally {
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
    }
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
