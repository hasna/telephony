# @hasna/telephony

Telephony platform for AI agents — SMS, WhatsApp, voice calls, TTS/STT, real-time streaming.

Each agent gets their own phone number. Agents can send/receive SMS, WhatsApp messages (text + audio), make voice calls, handle voicemail, and schedule automated messages using AI.

## Install

```bash
bun install -g @hasna/telephony
```

## Quick Start

```bash
# Register an agent
telephony agent register --name my-agent

# Search available phone numbers
telephony number search-available --country US

# Send an SMS
telephony sms send --to +1234567890 --body "Hello from AI"

# Send WhatsApp message
telephony whatsapp send --to +1234567890 --body "Hello"

# Text-to-speech
telephony tts --text "Hello world"

# AI-powered scheduling
telephony schedule ai "Send a follow-up SMS to +1234567890 tomorrow at 9am"

# Start the server (REST API + webhooks + dashboard)
telephony serve
```

## Features

- **SMS** — Send/receive via Twilio
- **WhatsApp** — Text + audio messages via Twilio WhatsApp API
- **Voice Calls** — Outbound/inbound calls, TwiML generation
- **Voicemail** — Auto-greeting (TTS), recording, transcription
- **TTS** — ElevenLabs text-to-speech
- **STT** — ElevenLabs speech-to-text
- **Phone Numbers** — Buy, release, configure via Twilio API
- **Contacts** — Per-agent address book
- **Scheduling** — Cron jobs with Cerebras AI natural language parsing
- **Webhooks** — Inbound Twilio callbacks + custom webhook dispatch
- **OpenAI Realtime** — Live voice streaming (cloud-only)
- **Projects** — Organize agents and numbers by project
- **Dashboard** — Web UI at http://localhost:19451

## Binaries

| Binary | Purpose |
|--------|---------|
| `telephony` | CLI |
| `telephony-mcp` | MCP server (37 tools) |
| `telephony-serve` | REST API + webhook server + dashboard |

## MCP Server Setup

### Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "telephony": {
      "command": "telephony-mcp",
      "env": {
        "TWILIO_ACCOUNT_SID": "your-sid",
        "TWILIO_AUTH_TOKEN": "your-token",
        "TWILIO_PHONE_NUMBER": "+1234567890"
      }
    }
  }
}
```

### Codex CLI

Add to `.codex/config.json`:

```json
{
  "mcpServers": {
    "telephony": {
      "command": "telephony-mcp"
    }
  }
}
```

### Gemini CLI

Add to `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "telephony": {
      "command": "telephony-mcp"
    }
  }
}
```

### Open Code

Add to your Open Code MCP config:

```json
{
  "mcpServers": {
    "telephony": {
      "command": "telephony-mcp"
    }
  }
}
```

### Pi.dev

```json
{
  "mcpServers": {
    "telephony": {
      "command": "telephony-mcp"
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Yes | Default outbound number |
| `ELEVENLABS_API_KEY` | For TTS/STT | ElevenLabs API key |
| `CEREBRAS_API_KEY` | For AI scheduling | Cerebras API key |
| `OPENAI_API_KEY` | For Realtime | OpenAI API key |
| `TELEPHONY_PORT` | No | Server port (default: 19451) |
| `TELEPHONY_WEBHOOK_URL` | For cloud | Public webhook base URL |

Also supports `HASNAXYZ_TWILIO_LIVE_*` and `HASNAXYZ_ELEVENLABS_LIVE_*` variable naming conventions.

## REST API

All endpoints available at `http://localhost:19451/api/`:

- `POST /api/sms/send` — Send SMS
- `POST /api/whatsapp/send` — Send WhatsApp
- `POST /api/call/make` — Make call
- `GET /api/messages` — List messages
- `GET /api/calls` — List calls
- `GET /api/numbers` — List numbers
- `POST /api/numbers/search` — Search available
- `POST /api/numbers/provision` — Buy number
- `GET /api/agents` — List agents
- `GET /api/projects` — List projects
- `POST /api/tts` — Generate speech
- `GET /api/voices` — List voices
- `POST /api/schedules/ai` — AI schedule
- `GET /health` — Health check

## SDK

```typescript
import { createClient } from "@hasna/telephony";

const client = createClient("http://localhost:19451");
await client.sendSms("+1234567890", "Hello from AI");
await client.listMessages();
```

## License

Apache-2.0
