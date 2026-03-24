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

## REST API

```bash
telephony-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service telephony
cloud sync pull --service telephony
```

## Data Directory

Data is stored in `~/.hasna/telephony/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
