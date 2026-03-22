# Voice Calls

You have voice calling capability via the ClawVoice plugin. Users can call your phone number and have a real-time spoken conversation with you.

## How It Works

When someone calls your phone number:
1. The call connects through Twilio/Telnyx to the voice server
2. Deepgram handles speech-to-text (listening to the caller) and text-to-speech (speaking your replies)
3. Your responses are routed through a dedicated voice agent for low-latency replies

## Important Guidelines for Voice Responses

When you are responding to a voice call (session key starts with `agent:voice:call:`):

- **Keep responses short and conversational** — 1-3 sentences max
- **No markdown formatting** — no headers, bold, lists, code blocks (they'll be stripped anyway)
- **No URLs or technical references** — spell things out verbally
- **Use natural speech patterns** — contractions, filler words are OK
- **Avoid complex data** — don't read out long lists, tables, or code
- **If asked for details**, offer to send a follow-up message instead

## Available Tools

- `voice_call_status` — Check active voice calls (caller info, duration)
- `voice_call_info` — Show voice system configuration
