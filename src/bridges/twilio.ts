import type WebSocket from "ws";
import type {
  TelephonyBridge,
  TelephonySession,
  TelephonyEventHandler,
} from "./types.js";

class TwilioSession implements TelephonySession {
  private _streamSid = "";
  private _callSid = "";
  private _from = "";
  private _to = "";
  private closed = false;

  get streamId() {
    return this._streamSid;
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
        this.onEvent({ type: "call_ended", callId: this._callSid });
      }
    });

    this.ws.on("error", (err) => {
      this.onEvent({
        type: "error",
        message: `Twilio WebSocket error: ${err.message}`,
      });
    });
  }

  private handleMessage(msg: Record<string, unknown>) {
    const event = msg.event as string;

    switch (event) {
      case "start": {
        const start = msg.start as Record<string, string>;
        this._streamSid = start.streamSid;
        this._callSid = start.callSid;

        // Extract caller info from custom parameters if available
        const customParams = (start as Record<string, unknown>)
          .customParameters as Record<string, string> | undefined;
        this._from = customParams?.from || "";
        this._to = customParams?.to || "";

        this.onEvent({
          type: "call_started",
          callId: this._callSid,
          from: this._from,
          to: this._to,
        });
        break;
      }

      case "media": {
        const media = msg.media as Record<string, string>;
        this.onEvent({
          type: "audio",
          audio: media.payload, // base64 mulaw
          encoding: media.encoding || "audio/x-mulaw",
        });
        break;
      }

      case "stop": {
        if (!this.closed) {
          this.closed = true;
          this.onEvent({ type: "call_ended", callId: this._callSid });
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
        streamSid: this._streamSid,
        media: {
          payload: audio,
        },
      }),
    );
  }

  clearAudio() {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;

    this.ws.send(
      JSON.stringify({
        event: "clear",
        streamSid: this._streamSid,
      }),
    );
  }

  close() {
    this.closed = true;
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.close();
    }
  }
}

export const twilioBridge: TelephonyBridge = {
  id: "twilio",
  label: "Twilio",

  handleIncomingCall(req) {
    const wsUrl = req.baseUrl.replace(/^http/, "ws");
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}/voice/twilio/media">
      <Parameter name="from" value="${req.body.From || ""}" />
      <Parameter name="to" value="${req.body.To || ""}" />
    </Stream>
  </Connect>
</Response>`;

    return {
      statusCode: 200,
      contentType: "text/xml",
      body: twiml,
    };
  },

  handleMediaStream(ws, onEvent) {
    return new TwilioSession(ws, onEvent);
  },
};
