#!/usr/bin/env bun
import { createServer } from "./serve.js";
import { getConfig } from "../lib/config.js";

const config = getConfig();
const port = config.server_port || 19451;

const server = createServer(port);
console.log(`🔊 Telephony server running on http://localhost:${server.port}`);
console.log(`   Dashboard: http://localhost:${server.port}/`);
console.log(`   API: http://localhost:${server.port}/api/`);
console.log(`   Webhooks: http://localhost:${server.port}/webhooks/`);
