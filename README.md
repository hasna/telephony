# @hasna/telephony

Telephony platform for AI agents — SMS, WhatsApp, voice calls, TTS/STT, real-time streaming

[![npm](https://img.shields.io/npm/v/@hasna/telephony)](https://www.npmjs.com/package/@hasna/telephony)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/telephony
```

## CLI Usage

```bash
telephony --help
```

- `telephony sms send`
- `telephony sms list`
- `telephony whatsapp send`
- `telephony call make`
- `telephony call list`

## MCP Server

```bash
telephony-mcp
```

39 tools available.

## HTTP mode

Shared Streamable HTTP transport (stateless, localhost only):

```bash
telephony-mcp --http
# or: MCP_HTTP=1 telephony-mcp
```

Default port **8839** (`--port` / `MCP_HTTP_PORT`). Endpoints: `GET /health`, `POST /mcp`.

## REST API

```bash
telephony-serve
```

## Data Directory

Telephony owns its local SQLite store directly. By default data is stored in
`~/.hasna/telephony/`; set `HASNA_TELEPHONY_DB_PATH` or `TELEPHONY_DB_PATH` to
use a specific database file, or set `TELEPHONY_DB_SCOPE=project` to use
`.telephony/telephony.db` under the nearest git root.

Realtime voice streaming requires a public webhook URL for Twilio Media Streams.
External PostgreSQL deployments may reuse the exported `PG_MIGRATIONS` schema
with their own database adapter.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
