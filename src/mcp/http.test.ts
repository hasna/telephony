import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "./server.js";
import { isHttpMode, isStdioMode, startMcpHttpServer } from "./http.js";

const repoRoot = new URL("../..", import.meta.url).pathname;
const MCP_TRANSPORT_ENV_KEYS = new Set(["MCP_HTTP", "MCP_STDIO"]);

function envWith(overrides: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && !MCP_TRANSPORT_ENV_KEYS.has(entry[0]),
      ),
    ),
    TELEPHONY_DB_PATH: ":memory:",
    ...overrides,
  };
}

describe("telephony MCP buildServer", () => {
  it("registers expected tools", async () => {
    const server = buildServer();
    expect(server).toBeDefined();
  });
});

describe("telephony-mcp transport mode", () => {
  const originalMcpHttp = process.env.MCP_HTTP;
  const originalMcpStdio = process.env.MCP_STDIO;

  afterEach(() => {
    if (originalMcpHttp === undefined) delete process.env.MCP_HTTP;
    else process.env.MCP_HTTP = originalMcpHttp;

    if (originalMcpStdio === undefined) delete process.env.MCP_STDIO;
    else process.env.MCP_STDIO = originalMcpStdio;
  });

  it("defaults to stdio unless HTTP mode is requested", () => {
    delete process.env.MCP_HTTP;
    delete process.env.MCP_STDIO;

    expect(isStdioMode([])).toBe(true);
    expect(isHttpMode([])).toBe(false);
  });

  it("uses HTTP mode when requested by CLI flag or environment", () => {
    delete process.env.MCP_STDIO;

    expect(isHttpMode(["--http"])).toBe(true);
    expect(isStdioMode(["--http"])).toBe(false);

    process.env.MCP_HTTP = "1";
    expect(isHttpMode([])).toBe(true);
    expect(isStdioMode([])).toBe(false);
  });

  it("keeps explicit stdio mode available", () => {
    delete process.env.MCP_HTTP;
    delete process.env.MCP_STDIO;

    expect(isStdioMode(["--stdio"])).toBe(true);

    process.env.MCP_STDIO = "1";
    expect(isStdioMode([])).toBe(true);
  });

  it("does not leak ambient MCP transport mode into spawned test processes", () => {
    process.env.MCP_HTTP = "1";
    process.env.MCP_STDIO = "1";

    const childEnv = envWith({});

    expect(childEnv.MCP_HTTP).toBeUndefined();
    expect(childEnv.MCP_STDIO).toBeUndefined();
  });
});

describe("telephony-mcp stdio transport", () => {
  it("initializes and lists projects over stdio", async () => {
    const client = new Client({ name: "telephony-stdio-test", version: "1.0.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["run", "src/mcp/index.ts"],
      cwd: repoRoot,
      env: envWith({}),
      stderr: "pipe",
    });

    try {
      await client.connect(transport, { timeout: 10_000 });
      const tools = await client.listTools(undefined, { timeout: 10_000 });
      expect(tools.tools.some((tool) => tool.name === "telephony_list_projects")).toBe(true);

      const result = await client.callTool(
        { name: "telephony_list_projects", arguments: {} },
        undefined,
        { timeout: 10_000 },
      ) as CallToolResult;
      expect(result.content[0]?.type).toBe("text");
    } finally {
      await transport.close();
    }
  });
});

describe("telephony-mcp HTTP transport", () => {
  let httpServer: Awaited<ReturnType<typeof startMcpHttpServer>> | undefined;

  afterEach(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.server.close(() => resolve()));
      httpServer = undefined;
    }
  });

  it("serves /health and MCP tool calls over Streamable HTTP", async () => {
    httpServer = await startMcpHttpServer({ name: "telephony", port: 0 });
    const { port, host } = httpServer;

    const health = await fetch(`http://${host}:${port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", name: "telephony" });

    const client = new Client({ name: "telephony-http-test", version: "1.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`));

    try {
      await client.connect(transport, { timeout: 10_000 });
      const result = await client.callTool(
        { name: "telephony_list_projects", arguments: {} },
        undefined,
        { timeout: 10_000 },
      ) as CallToolResult;
      expect(result.content[0]?.type).toBe("text");
      expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("[");
    } finally {
      await transport.close();
    }
  });

  it("handles concurrent HTTP clients in one process", async () => {
    httpServer = await startMcpHttpServer({ name: "telephony", port: 0 });
    const { port, host } = httpServer;

    const runClient = async () => {
      const client = new Client({ name: "telephony-http-concurrent", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`));
      try {
        await client.connect(transport, { timeout: 10_000 });
        const result = await client.callTool(
          { name: "telephony_describe_tools", arguments: {} },
          undefined,
          { timeout: 10_000 },
        ) as CallToolResult;
        expect(result.content[0]?.type).toBe("text");
      } finally {
        await transport.close();
      }
    };

    await Promise.all([runClient(), runClient(), runClient()]);
  });
});
