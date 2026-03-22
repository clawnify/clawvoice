/** Events emitted by a telephony bridge */
export type TelephonyEvent =
  | { type: "call_started"; callId: string; from: string; to: string }
  | { type: "audio"; audio: string; encoding: string }
  | { type: "call_ended"; callId: string }
  | { type: "error"; message: string };

export type TelephonyEventHandler = (event: TelephonyEvent) => void;

/** Telephony bridge — handles phone call media streaming */
export interface TelephonyBridge {
  id: string;
  label: string;

  /** Generate webhook response for incoming call (TwiML, etc.) */
  handleIncomingCall(req: {
    body: Record<string, string>;
    baseUrl: string;
  }): { statusCode: number; contentType: string; body: string };

  /** Handle WebSocket media stream connection */
  handleMediaStream(
    ws: import("ws").WebSocket,
    onEvent: TelephonyEventHandler,
  ): TelephonySession;
}

export interface TelephonySession {
  /** Stream ID for this call */
  readonly streamId: string;

  /** Send audio back to the caller */
  sendAudio(audio: string, encoding: string): void;

  /** Clear queued audio (barge-in) */
  clearAudio(): void;

  /** Close the media stream */
  close(): void;
}
