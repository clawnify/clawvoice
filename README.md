# ClawVoice

Voice agent plugin for [OpenClaw](https://github.com/openclaw/openclaw) — give your agent a phone number.

ClawVoice bridges phone calls (via Twilio or Telnyx) with [Deepgram's Voice Agent API](https://developers.deepgram.com/docs/voice-agent), allowing real-time spoken conversations with your OpenClaw agent over a regular phone line.

## How It Works

```
Phone Call → Twilio/Telnyx (PSTN)
  → ClawVoice (WebSocket bridge)
    → Deepgram Voice Agent API (STT + TTS + turn-taking)
      → OpenClaw Gateway (/v1/chat/completions)
```

1. Someone calls your Twilio/Telnyx phone number
2. Twilio sends a webhook to ClawVoice, which starts a media stream
3. Audio is bridged to Deepgram's Voice Agent API via WebSocket
4. Deepgram handles speech-to-text (Nova-3), text-to-speech (Aura-2), and semantic turn detection
5. LLM requests are proxied back to your OpenClaw gateway's chat completions endpoint
6. The caller hears the agent's response spoken back in real-time

**Key features:**
- Semantic turn detection (not just VAD) — understands when someone is done speaking
- Barge-in support — interrupt the agent mid-sentence
- ~90ms TTS latency with Deepgram Aura-2
- Session pre-warming for faster first response
- Markdown stripping — responses are cleaned for voice output
- Twilio webhook signature validation

## Requirements

- Node.js >= 18
- OpenClaw >= 2026.3.12
- A [Deepgram](https://deepgram.com) account (comes with $200 free credit)
- A [Twilio](https://twilio.com) or [Telnyx](https://telnyx.com) account with a phone number

## Installation

### As an OpenClaw plugin (recommended)

```bash
cd ~/.openclaw/workspace
git clone https://github.com/clawnify/clawvoice.git
cd clawvoice
npm install && npm run build
```

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "allow": ["clawvoice"],
    "load": {
      "paths": ["/home/user/.openclaw/workspace/clawvoice"]
    },
    "entries": {
      "clawvoice": {
        "enabled": true,
        "config": {
          "voiceProvider": "deepgram",
          "telephonyProvider": "twilio",
          "serve": { "port": 8000 },
          "greeting": "Hello! How can I help you today?"
        }
      }
    }
  }
}
```

Enable the chat completions endpoint:

```bash
openclaw config set gateway.http.endpoints.chatCompletions.enabled true
```

### Standalone

```bash
git clone https://github.com/clawnify/clawvoice.git
cd clawvoice
npm install && npm run build
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEEPGRAM_API_KEY` | Yes | Deepgram API key |
| `TWILIO_ACCOUNT_SID` | If using Twilio | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | If using Twilio | Twilio Auth Token |
| `TELNYX_API_KEY` | If using Telnyx | Telnyx API key |
| `TELNYX_PUBLIC_KEY` | If using Telnyx | Telnyx public key |
| `OPENCLAW_GATEWAY_URL` | No | Gateway URL (default: `http://127.0.0.1:18789`) |
| `OPENCLAW_GATEWAY_TOKEN` | No | Gateway auth token |
| `CLAWVOICE_DEBUG` | No | Enable debug logging |

### Plugin Config

All config goes under `plugins.entries.clawvoice.config` in `openclaw.json`:

| Key | Default | Description |
|-----|---------|-------------|
| `voiceProvider` | `"deepgram"` | Voice provider |
| `telephonyProvider` | `"twilio"` | `"twilio"` or `"telnyx"` |
| `deepgram.apiKey` | env var | Deepgram API key |
| `deepgram.voice` | `"aura-2-asteria-en"` | Deepgram TTS voice |
| `deepgram.language` | `"en"` | Language code |
| `serve.port` | `8000` | Voice server port |
| `serve.host` | `"127.0.0.1"` | Voice server bind address |
| `publicUrl` | — | Public URL for webhooks (tunnel URL) |
| `voiceModel` | `"anthropic/claude-haiku-4-5-20251001"` | Model for voice responses |
| `greeting` | `"Hello! How can I help you today?"` | Greeting when call connects |

## Twilio Setup

1. Get a phone number in the [Twilio Console](https://console.twilio.com)
2. Go to **Phone Numbers** → your number → **Voice Configuration**
3. Set **A Call Comes In** → Webhook → `https://your-public-url/voice/twilio/incoming` (POST)

If running behind a Cloudflare Tunnel, the public URL would be your tunnel hostname.

## Architecture

ClawVoice is built with a provider-agnostic architecture:

```
src/
  providers/
    types.ts          # VoiceProvider interface
    deepgram.ts       # Deepgram Voice Agent API
  bridges/
    types.ts          # TelephonyBridge interface
    twilio.ts         # Twilio media stream bridge
    telnyx.ts         # Telnyx media stream bridge
  server.ts           # HTTP/WebSocket server
  plugin/
    index.ts          # OpenClaw plugin registration
  utils.ts            # Markdown stripping, signature validation
```

**Adding a new voice provider:** Implement the `VoiceProvider` interface in `src/providers/`.

**Adding a new telephony provider:** Implement the `TelephonyBridge` interface in `src/bridges/`.

### Planned Providers

Voice providers on the roadmap:
- **ElevenLabs** — high-quality TTS with 80+ voices (using OpenClaw's built-in STT for the inbound side)
- **OpenAI Realtime** — GPT-4o native voice
- **Google Cloud Speech** — STT + TTS

Telephony:
- **Telnyx** — already scaffolded, lower cost alternative to Twilio

## Plugin Surfaces

When loaded as an OpenClaw plugin, ClawVoice registers:

| Surface | What |
|---------|------|
| **Tools** | `voice_call_status`, `voice_call_info` |
| **Service** | Background HTTP/WebSocket server |
| **CLI** | `openclaw clawvoice status`, `openclaw clawvoice config` |
| **Skill** | Voice call guidelines for the agent |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check + active call count |
| `GET /voice/status` | List active calls with details |
| `POST /voice/twilio/incoming` | Twilio webhook (returns TwiML) |
| `WS /voice/twilio/media` | Twilio media stream |
| `POST /voice/telnyx/webhook` | Telnyx webhook |
| `WS /voice/telnyx/media` | Telnyx media stream |
| `POST /v1/chat/completions` | LLM proxy (internal, authenticated) |

## Security

- Twilio webhook requests are validated via `X-Twilio-Signature` (HMAC-SHA1)
- The LLM proxy endpoint is authenticated with a random secret generated at startup
- The voice server binds to `127.0.0.1` by default — expose via reverse proxy or tunnel

## Cost Estimate

| Service | Cost |
|---------|------|
| Deepgram Voice Agent | ~$4.50/hr |
| Twilio (phone + minutes) | ~$1/mo + $0.085/min |
| Telnyx (alternative) | ~$0.50/mo + $0.025/min |
| OpenClaw (your LLM keys) | Varies by provider |

## License

MIT
