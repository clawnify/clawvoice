import * as http from "node:http";
import * as url from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { deepgramProvider } from "./providers/deepgram.js";
import { twilioBridge } from "./bridges/twilio.js";
import { telnyxBridge } from "./bridges/telnyx.js";
import { stripMarkdown, randomSecret, createLogger } from "./utils.js";
import type { VoiceProviderSession } from "./providers/types.js";
import type { TelephonySession } from "./bridges/types.js";

const log = createLogger("clawvoice");

export interface ClawVoiceConfig {
  voiceProvider: "deepgram";
  telephonyProvider: "twilio" | "telnyx";
  deepgram?: { apiKey?: string; voice?: string; language?: string };
  twilio?: { accountSid?: string; authToken?: string };
  telnyx?: { apiKey?: string; publicKey?: string };
  serve?: { port?: number; host?: string };
  voiceModel?: string;
  greeting?: string;
  /** OpenClaw gateway URL (auto-detected or configured) */
  gatewayUrl?: string;
  /** OpenClaw gateway token */
  gatewayToken?: string;
}

interface ActiveCall {
  callId: string;
  from: string;
  to: string;
  startedAt: Date;
  telephonySession: TelephonySession;
  voiceSession: VoiceProviderSession;
}

export class ClawVoiceServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private activeCalls = new Map<string, ActiveCall>();
  private proxySecret: string;
  private publicUrl = "";

  constructor(private config: ClawVoiceConfig) {
    this.proxySecret = randomSecret();
  }

  async start(): Promise<{ port: number; host: string }> {
    const port = this.config.serve?.port ?? 8000;
    const host = this.config.serve?.host ?? "127.0.0.1";

    this.httpServer = http.createServer((req, res) =>
      this.handleHttp(req, res),
    );

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws, req) => this.handleWsUpgrade(ws, req));

    return new Promise((resolve) => {
      this.httpServer!.listen(port, host, () => {
        log.info(`Voice server listening on ${host}:${port}`);
        resolve({ port, host });
      });
    });
  }

  /** Set the public URL (from Cloudflare Tunnel or ngrok) */
  setPublicUrl(publicUrl: string) {
    this.publicUrl = publicUrl.replace(/\/$/, "");
    log.info(`Public URL set to ${this.publicUrl}`);
  }

  async stop() {
    // Close all active calls
    for (const call of this.activeCalls.values()) {
      call.voiceSession.close();
      call.telephonySession.close();
    }
    this.activeCalls.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      return new Promise<void>((resolve) => {
        this.httpServer!.close(() => {
          this.httpServer = null;
          resolve();
        });
      });
    }
  }

  /** Get active call count */
  getActiveCalls(): ActiveCall[] {
    return Array.from(this.activeCalls.values());
  }

  // ---- HTTP request handler ----

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const pathname = url.parse(req.url || "").pathname || "";

    // Health check
    if (pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          activeCalls: this.activeCalls.size,
          voiceProvider: this.config.voiceProvider,
          telephonyProvider: this.config.telephonyProvider,
        }),
      );
      return;
    }

    // Twilio incoming call webhook
    if (pathname === "/voice/twilio/incoming" && req.method === "POST") {
      this.handleTwilioIncoming(req, res);
      return;
    }

    // Telnyx webhook
    if (pathname === "/voice/telnyx/webhook" && req.method === "POST") {
      this.handleTelnyxWebhook(req, res);
      return;
    }

    // LLM proxy (Deepgram calls this for chat completions)
    if (
      pathname === "/v1/chat/completions" &&
      req.method === "POST"
    ) {
      this.handleLLMProxy(req, res);
      return;
    }

    // Status
    if (pathname === "/voice/status" && req.method === "GET") {
      const calls = this.getActiveCalls().map((c) => ({
        callId: c.callId,
        from: c.from,
        to: c.to,
        startedAt: c.startedAt.toISOString(),
        duration: Math.round(
          (Date.now() - c.startedAt.getTime()) / 1000,
        ),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ activeCalls: calls }));
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  // ---- Twilio incoming call ----

  private handleTwilioIncoming(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const params = Object.fromEntries(new URLSearchParams(body));
      const baseUrl = this.publicUrl || `http://${req.headers.host}`;

      const result = twilioBridge.handleIncomingCall({
        body: params,
        baseUrl,
      });

      res.writeHead(result.statusCode, {
        "Content-Type": result.contentType,
      });
      res.end(result.body);

      log.info(
        `Incoming Twilio call from ${params.From} to ${params.To}`,
      );
    });
  }

  // ---- Telnyx webhook ----

  private handleTelnyxWebhook(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        log.info(`Telnyx webhook: ${payload.data?.event_type}`);
      } catch {
        // ignore
      }

      const result = telnyxBridge.handleIncomingCall({
        body: {},
        baseUrl: this.publicUrl || `http://${req.headers.host}`,
      });

      res.writeHead(result.statusCode, {
        "Content-Type": result.contentType,
      });
      res.end(result.body);
    });
  }

  // ---- WebSocket media stream ----

  private handleWsUpgrade(ws: WebSocket, req: http.IncomingMessage) {
    const pathname = url.parse(req.url || "").pathname || "";

    if (pathname === "/voice/twilio/media") {
      this.bridgeCall(ws, "twilio");
    } else if (pathname === "/voice/telnyx/media") {
      this.bridgeCall(ws, "telnyx");
    } else {
      ws.close(1008, "Unknown path");
    }
  }

  private async bridgeCall(
    ws: WebSocket,
    telephonyType: "twilio" | "telnyx",
  ) {
    const bridge =
      telephonyType === "twilio" ? twilioBridge : telnyxBridge;
    const provider = deepgramProvider; // extensible later

    const apiKey = this.config.deepgram?.apiKey;
    if (!apiKey) {
      log.error("No Deepgram API key configured");
      ws.close(1008, "No voice provider API key");
      return;
    }

    // Set up telephony session
    const telephonySession = bridge.handleMediaStream(ws, async (event) => {
      switch (event.type) {
        case "call_started": {
          log.info(
            `Call started: ${event.callId} (${event.from} → ${event.to})`,
          );

          // Connect to voice provider
          try {
            const voiceSession = await provider.connect({
              apiKey,
              llmProxy: {
                proxyUrl:
                  this.publicUrl || `http://127.0.0.1:${this.config.serve?.port ?? 8000}`,
                proxySecret: this.proxySecret,
                model: this.config.voiceModel || "anthropic/claude-haiku-4-5-20251001",
              },
              voice: this.config.deepgram?.voice,
              language: this.config.deepgram?.language,
              greeting: this.config.greeting,
              onEvent: (voiceEvent) => {
                switch (voiceEvent.type) {
                  case "audio":
                    telephonySession.sendAudio(
                      voiceEvent.audio,
                      voiceEvent.encoding,
                    );
                    break;
                  case "user_started_speaking":
                    telephonySession.clearAudio(); // barge-in
                    break;
                  case "transcript":
                    log.debug(
                      `[${voiceEvent.role}] ${voiceEvent.text}`,
                    );
                    break;
                  case "error":
                    log.error(`Voice provider: ${voiceEvent.message}`);
                    break;
                  case "close":
                    log.info(`Voice session closed for ${event.callId}`);
                    telephonySession.close();
                    this.activeCalls.delete(event.callId);
                    break;
                }
              },
            });

            this.activeCalls.set(event.callId, {
              callId: event.callId,
              from: event.from,
              to: event.to,
              startedAt: new Date(),
              telephonySession,
              voiceSession,
            });

            // Pre-warm OpenClaw prompt cache
            this.prewarmGateway().catch(() => {});
          } catch (err) {
            log.error(`Failed to connect voice provider: ${err}`);
            telephonySession.close();
          }
          break;
        }

        case "audio": {
          // Forward telephony audio to voice provider
          const call = this.findCallByStreamId(
            telephonySession.streamId,
          );
          if (call) {
            call.voiceSession.sendAudio(event.audio, event.encoding);
          }
          break;
        }

        case "call_ended": {
          log.info(`Call ended: ${event.callId}`);
          const call = this.activeCalls.get(event.callId);
          if (call) {
            call.voiceSession.close();
            this.activeCalls.delete(event.callId);
          }
          break;
        }

        case "error":
          log.error(`Telephony: ${event.message}`);
          break;
      }
    });
  }

  private findCallByStreamId(streamId: string): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.telephonySession.streamId === streamId) return call;
    }
    return undefined;
  }

  // ---- LLM Proxy (Deepgram → OpenClaw) ----

  private async handleLLMProxy(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    // Verify proxy secret
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${this.proxySecret}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const request = JSON.parse(body);

        // Override model to route through OpenClaw voice agent
        request.model = "openclaw/voice";

        const gatewayUrl =
          this.config.gatewayUrl || "http://127.0.0.1:18789";

        // Determine session key from active calls
        let sessionKey = "agent:voice:call:default";
        if (this.activeCalls.size > 0) {
          const firstCall = this.activeCalls.values().next().value as ActiveCall;
          sessionKey = `agent:voice:call:${firstCall.callId}`;
        }

        // Forward to OpenClaw gateway
        const response = await fetch(
          `${gatewayUrl}/v1/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.config.gatewayToken || ""}`,
              "X-OpenClaw-Session-Key": sessionKey,
            },
            body: JSON.stringify(request),
          },
        );

        // Stream the response back
        const contentType =
          response.headers.get("content-type") || "application/json";
        res.writeHead(response.status, { "Content-Type": contentType });

        if (request.stream && response.body) {
          // Streaming: pipe through with markdown stripping on complete messages
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          const pump = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                res.end();
                break;
              }

              const chunk = decoder.decode(value, { stream: true });
              // Process SSE lines — strip markdown from content deltas
              const processed = this.processStreamChunk(chunk);
              res.write(processed);
            }
          };
          pump().catch((err) => {
            log.error(`Stream proxy error: ${err}`);
            res.end();
          });
        } else {
          // Non-streaming: strip markdown from complete response
          const data = await response.json();
          if (data.choices?.[0]?.message?.content) {
            data.choices[0].message.content = stripMarkdown(
              data.choices[0].message.content,
            );
          }
          res.end(JSON.stringify(data));
        }
      } catch (err) {
        log.error(`LLM proxy error: ${err}`);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Gateway error" }));
      }
    });
  }

  /** Process SSE stream chunks — strip markdown from content deltas */
  private processStreamChunk(chunk: string): string {
    const lines = chunk.split("\n");
    return lines
      .map((line) => {
        if (!line.startsWith("data: ") || line === "data: [DONE]") {
          return line;
        }

        try {
          const data = JSON.parse(line.slice(6));
          const delta = data.choices?.[0]?.delta;
          if (delta?.content) {
            // For streaming, we do lightweight cleanup
            // (full markdown stripping happens on complete messages)
            delta.content = delta.content
              .replace(/\*\*/g, "")
              .replace(/`/g, "");
          }
          return `data: ${JSON.stringify(data)}`;
        } catch {
          return line;
        }
      })
      .join("\n");
  }

  // ---- Gateway pre-warm ----

  private async prewarmGateway() {
    const gatewayUrl =
      this.config.gatewayUrl || "http://127.0.0.1:18789";

    try {
      await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.gatewayToken || ""}`,
          "X-OpenClaw-Session-Key": "agent:voice:prewarm",
        },
        body: JSON.stringify({
          model: "openclaw/voice",
          messages: [{ role: "user", content: "." }],
          max_tokens: 1,
        }),
      });
      log.debug("Gateway pre-warmed");
    } catch {
      log.debug("Gateway pre-warm failed (non-critical)");
    }
  }
}
