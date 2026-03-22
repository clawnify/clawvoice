// ClawVoice — Voice agent plugin for OpenClaw
// https://github.com/clawnify/clawvoice

export { ClawVoiceServer } from "./server.js";
export type { ClawVoiceConfig } from "./server.js";
export { deepgramProvider } from "./providers/deepgram.js";
export { twilioBridge } from "./bridges/twilio.js";
export { telnyxBridge } from "./bridges/telnyx.js";
export type {
  VoiceProvider,
  VoiceProviderSession,
  VoiceProviderEvent,
} from "./providers/types.js";
export type {
  TelephonyBridge,
  TelephonySession,
  TelephonyEvent,
} from "./bridges/types.js";
