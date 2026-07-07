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

`telephony-serve` fails closed for `/api/*` until a REST API key is configured.
Clients must send either a bearer token or `x-telephony-api-key`. The REST gate
runs before send, call, phone-number provisioning, and release paths, so missing
or invalid credentials do not call Twilio or write local ledgers. Mutating phone
operations also require E.164 destinations and pass a toll-fraud prefix denylist
before provider calls.

Mutating REST operations are queue-first. Requests must include `Idempotency-Key`;
otherwise they return `428` before provider execution. By default, and in
`fixture` or `sandbox` provider mode, send/call/number mutations are retained in
the local safety queue with retry metadata and no Twilio side effects. Live
provider mutation requires all of:

- `X-Telephony-Provider-Mode: live_mutating`
- `X-Telephony-Live-Execution: approved`
- `X-Telephony-Operator-Approval: approved`
- `X-Telephony-Sandbox-Smoke: passed`

The safety queue is visible through `GET /api/safety/queue`, and queued entries
can be marked for retry with `POST /api/safety/queue/:id/retry`. Retention
defaults to one day and can be tuned with `TELEPHONY_OPERATION_RETENTION_MS`.
Per-destination mutation quotas default to 10 per day and can be tuned with
`TELEPHONY_MAX_DAILY_MUTATIONS_PER_DESTINATION` and
`TELEPHONY_MUTATION_QUOTA_WINDOW_MS`.

Run `POST /api/safety/smoke` with `X-Telephony-Provider-Mode: sandbox` to produce
the no-side-effect sandbox proof needed before live mutation. Live smoke is also
explicitly gated and returns no provider side effects unless the request carries
operator approval and `X-Telephony-Live-Smoke: approved`.

Twilio webhooks under `/webhooks/*` require `X-Twilio-Signature` verification
with the configured Twilio auth token. Replayed MessageSid, CallSid, SmsSid, or
RecordingSid values are rejected before inbound messages, calls, or webhook
dispatch rows are written.

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
