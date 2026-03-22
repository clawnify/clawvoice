import type { WebSocket } from "ws";

/** Audio chunk flowing between telephony bridge and voice provider */
export interface AudioChunk {
  audio: string; // base64-encoded audio
  sampleRate: number;
  encoding: "mulaw" | "linear16" | "opus";
}

/** Events emitted by a voice provider */
export type VoiceProviderEvent =
  | { type: "audio"; audio: string; encoding: string }
  | { type: "agent_started_speaking" }
  | { type: "agent_stopped_speaking" }
  | { type: "user_started_speaking" }
  | { type: "transcript"; role: "user" | "agent"; text: string }
  | { type: "error"; message: string }
  | { type: "close" };

export type VoiceProviderEventHandler = (event: VoiceProviderEvent) => void;

/** Configuration for connecting to the LLM backend */
export interface LLMProxyConfig {
  /** Public URL that Deepgram can reach for /v1/chat/completions */
  proxyUrl: string;
  /** Secret for authenticating proxy requests */
  proxySecret: string;
  /** Model to route to (e.g. "openclaw/voice") */
  model: string;
}

/** Voice provider — handles STT + TTS + turn-taking */
export interface VoiceProvider {
  id: string;
  label: string;

  /** Open a new voice session */
  connect(config: {
    apiKey: string;
    llmProxy: LLMProxyConfig;
    voice?: string;
    language?: string;
    greeting?: string;
    onEvent: VoiceProviderEventHandler;
  }): Promise<VoiceProviderSession>;
}

export interface VoiceProviderSession {
  /** Send audio from the phone to the voice provider */
  sendAudio(audio: string, encoding: string): void;

  /** Signal that the user started speaking (barge-in) */
  notifyBargeIn(): void;

  /** Close the session */
  close(): void;

  /** Whether the session is still connected */
  readonly connected: boolean;
}
