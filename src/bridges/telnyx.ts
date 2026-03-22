import type WebSocket from "ws";
import type {
  TelephonyBridge,
  TelephonySession,
  TelephonyEventHandler,
} from "./types.js";

class TelnyxSession implements TelephonySession {
  private _streamId = "";
  private _callControlId = "";
  private closed = false;

  get streamId() {
    return this._streamId;
  }

  constructor(
    private ws: WebSocket,
    private onEvent: TelephonyEventHandler,
  ) {
    this.setupListeners();
  }

  private setupListeners() {
    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch {
        // Ignore non-JSON
      }
    });

    this.ws.on("close", () => {
      if (!this.closed) {
        this.closed = true;
        this.onEvent({ type: "call_ended", callId: this._callControlId });
      }
    });

    this.ws.on("error", (err) => {
      this.onEvent({
        type: "error",
        message: `Telnyx WebSocket error: ${err.message}`,
      });
    });
  }

  private handleMessage(msg: Record<string, unknown>) {
    const eventType = (msg.event as string) || "";
    const data = (msg.data as Record<string, unknown>) || {};

    switch (eventType) {
      case "stream.started": {
        this._streamId = (data.stream_id as string) || "";
        this._callControlId = (data.call_control_id as string) || "";
        this.onEvent({
          type: "call_started",
          callId: this._callControlId,
          from: (data.from as string) || "",
          to: (data.to as string) || "",
        });
        break;
      }

      case "stream.data": {
        this.onEvent({
          type: "audio",
          audio: data.payload as string, // base64 audio
          encoding: (data.encoding as string) || "audio/x-mulaw",
        });
        break;
      }

      case "stream.stopped": {
        if (!this.closed) {
          this.closed = true;
          this.onEvent({ type: "call_ended", callId: this._callControlId });
        }
        break;
      }
    }
  }

  sendAudio(audio: string, _encoding: string) {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;

    this.ws.send(
      JSON.stringify({
        event: "media",
        media: {
          payload: audio,
        },
      }),
    );
  }

  clearAudio() {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;

    this.ws.send(JSON.stringify({ event: "clear" }));
  }

  close() {
    this.closed = true;
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.close();
    }
  }
}

export const telnyxBridge: TelephonyBridge = {
  id: "telnyx",
  label: "Telnyx",

  handleIncomingCall(_req) {
    // Telnyx uses call control API — answer + start stream via REST
    return {
      statusCode: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    };
  },

  handleMediaStream(ws, onEvent) {
    return new TelnyxSession(ws, onEvent);
  },
};
