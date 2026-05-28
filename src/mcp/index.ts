#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../../package.json";
import { buildServer } from "./server.js";
import { DEFAULT_MCP_HTTP_PORT, isHttpMode, parseCliPort, startMcpHttpServer } from "./http.js";

function printHelp(): void {
  console.log(`Usage: telephony-mcp [options]

Runs the @hasna/telephony MCP server.

Options:
  -V, --version    output the version number
  -h, --help       display help for command
      --http       start Streamable HTTP transport on 127.0.0.1 (env: MCP_HTTP=1)
      --port <n>   HTTP port (default ${DEFAULT_MCP_HTTP_PORT}, env: MCP_HTTP_PORT)`);
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(pkg.version);
  process.exit(0);
}

async function main(): Promise<void> {
  if (isHttpMode(args)) {
    await startMcpHttpServer({ name: "telephony", port: parseCliPort(args) });
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start telephony-mcp:", error);
  process.exit(1);
});
