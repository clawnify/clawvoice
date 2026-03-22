import WebSocket from "ws";
import type {
  VoiceProvider,
  VoiceProviderSession,
  VoiceProviderEventHandler,
  LLMProxyConfig,
} from "./types.js";

const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";

/** Buffer size: accumulate N telephony packets before sending to Deepgram */
const BUFFER_SIZE = 20;
const PACKET_SIZE = 160; // bytes per mulaw packet at 8kHz

interface DeepgramConfig {
  apiKey: string;
  llmProxy: LLMProxyConfig;
  voice?: string;
  language?: string;
  greeting?: string;
  onEvent: VoiceProviderEventHandler;
}

function buildAgentConfig(config: DeepgramConfig) {
  return {
    type: "Settings",
    audio: {
      input: {
        encoding: "mulaw",
        sample_rate: 8000,
      },
      output: {
        encoding: "mulaw",
        sample_rate: 8000,
        container: "none",
      },
    },
    agent: {
      listen: {
        provider: { type: "deepgram" },
        model: "nova-3",
        keyterms: [],
      },
      think: {
        provider: { type: "open_ai" },
        model: "gpt-4o-mini", // ignored — proxy overrides to openclaw/voice
        endpoint: {
          url: `${config.llmProxy.proxyUrl}/v1/chat/completions`,
          headers: {
            Authorization: `Bearer ${config.llmProxy.proxySecret}`,
          },
        },
        instructions: "",
      },
      speak: {
        provider: { type: "deepgram" },
        model: config.voice || "aura-2-asteria-en",
      },
      greeting: {
        text: config.greeting || "Hello! How can I help you today?",
      },
      turn: {
        endpointing: { type: "semantic" },
      },
    },
  };
}

class DeepgramSession implements VoiceProviderSession {
  private ws: WebSocket | null = null;
  private audioBuffer: Buffer[] = [];
  private _connected = false;

  get connected() {
    return this._connected;
  }

  constructor(
    private config: DeepgramConfig,
    private onReady: () => void,
  ) {
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(DEEPGRAM_AGENT_URL, {
      headers: {
        Authorization: `Token ${this.config.apiKey}`,
      },
    });

    this.ws.on("open", () => {
      this._connected = true;
      // Send settings immediately
      this.ws!.send(JSON.stringify(buildAgentConfig(this.config)));
      this.onReady();
    });

    this.ws.on("message", (data) => {
      const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as ArrayBuffer);

      // Try to parse as JSON (event), otherwise it's audio
      try {
        const text = raw.toString("utf-8");
        if (text.startsWith("{")) {
          const event = JSON.parse(text);
          this.handleEvent(event);
          return;
        }
      } catch {
        // Not JSON — treat as audio
      }

      // Binary audio data from Deepgram TTS
      this.config.onEvent({
        type: "audio",
        audio: raw.toString("base64"),
        encoding: "mulaw",
      });
    });

    this.ws.on("error", (err) => {
      this.config.onEvent({
        type: "error",
        message: `Deepgram WebSocket error: ${err.message}`,
      });
    });

    this.ws.on("close", () => {
      this._connected = false;
      this.config.onEvent({ type: "close" });
    });
  }

  private handleEvent(event: Record<string, unknown>) {
    const eventType = event.type as string;

    switch (eventType) {
      case "UserStartedSpeaking":
        this.config.onEvent({ type: "user_started_speaking" });
        break;
      case "AgentStartedSpeaking":
        this.config.onEvent({ type: "agent_started_speaking" });
        break;
      case "AgentAudioDone":
        this.config.onEvent({ type: "agent_stopped_speaking" });
        break;
      case "ConversationText":
        this.config.onEvent({
          type: "transcript",
          role: (event.role as string) === "user" ? "user" : "agent",
          text: event.content as string,
        });
        break;
    }
  }

  sendAudio(audio: string, _encoding: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const chunk = Buffer.from(audio, "base64");
    this.audioBuffer.push(chunk);

    // Batch send: accumulate BUFFER_SIZE packets (~0.4s of audio)
    if (this.audioBuffer.length >= BUFFER_SIZE) {
      const combined = Buffer.concat(this.audioBuffer);
      this.audioBuffer = [];
      this.ws.send(combined);
    }
  }

  notifyBargeIn() {
    // Deepgram handles barge-in via its own VAD — no explicit signal needed.
    // We just need to tell the telephony bridge to stop playback.
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }
}

export const deepgramProvider: VoiceProvider = {
  id: "deepgram",
  label: "Deepgram Voice Agent",

  async connect(config) {
    return new Promise<VoiceProviderSession>((resolve) => {
      const session = new DeepgramSession(config, () => resolve(session));
    });
  },
};
