import { ClawVoiceServer, type ClawVoiceConfig } from "../server.js";
import { createLogger } from "../utils.js";

const log = createLogger("clawvoice:plugin");

/**
 * ClawVoice — OpenClaw plugin registration.
 *
 * Registers:
 * - voice_call_start tool (agent can initiate awareness of voice calls)
 * - voice_call_status tool
 * - Background voice server service
 */
export const id = "clawvoice";

let server: ClawVoiceServer | null = null;

export function register(api: any) {
  const pluginConfig = (api.config?.plugins?.entries?.clawvoice?.config ||
    {}) as Partial<ClawVoiceConfig>;

  // Resolve config with env var fallbacks
  const config: ClawVoiceConfig = {
    voiceProvider: pluginConfig.voiceProvider || "deepgram",
    telephonyProvider: pluginConfig.telephonyProvider || "twilio",
    deepgram: {
      apiKey:
        pluginConfig.deepgram?.apiKey ||
        process.env.DEEPGRAM_API_KEY ||
        "",
      voice: pluginConfig.deepgram?.voice || "aura-2-asteria-en",
      language: pluginConfig.deepgram?.language || "en",
    },
    twilio: {
      accountSid:
        pluginConfig.twilio?.accountSid ||
        process.env.TWILIO_ACCOUNT_SID ||
        "",
      authToken:
        pluginConfig.twilio?.authToken ||
        process.env.TWILIO_AUTH_TOKEN ||
        "",
    },
    telnyx: {
      apiKey:
        pluginConfig.telnyx?.apiKey || process.env.TELNYX_API_KEY || "",
      publicKey:
        pluginConfig.telnyx?.publicKey ||
        process.env.TELNYX_PUBLIC_KEY ||
        "",
    },
    serve: {
      port: pluginConfig.serve?.port || 8000,
      host: pluginConfig.serve?.host || "127.0.0.1",
    },
    voiceModel:
      pluginConfig.voiceModel || "anthropic/claude-haiku-4-5-20251001",
    greeting:
      pluginConfig.greeting || "Hello! How can I help you today?",
    gatewayUrl:
      pluginConfig.gatewayUrl ||
      process.env.OPENCLAW_GATEWAY_URL ||
      "http://127.0.0.1:18789",
    gatewayToken:
      pluginConfig.gatewayToken ||
      process.env.OPENCLAW_GATEWAY_TOKEN ||
      "",
  };

  // ---- Register tools ----

  api.registerTool(
    {
      name: "voice_call_status",
      description:
        "Check the status of active voice calls. Returns a list of ongoing phone calls with caller info and duration.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        if (!server) {
          return {
            content: [
              {
                type: "text",
                text: "Voice server is not running.",
              },
            ],
          };
        }

        const calls = server.getActiveCalls().map((c) => ({
          callId: c.callId,
          from: c.from,
          to: c.to,
          startedAt: c.startedAt.toISOString(),
          durationSeconds: Math.round(
            (Date.now() - c.startedAt.getTime()) / 1000,
          ),
        }));

        return {
          content: [
            {
              type: "text",
              text:
                calls.length === 0
                  ? "No active voice calls."
                  : `Active calls:\n${JSON.stringify(calls, null, 2)}`,
            },
          ],
        };
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "voice_call_info",
      description:
        "Get information about the voice calling system — phone number, provider, and configuration.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  voiceProvider: config.voiceProvider,
                  telephonyProvider: config.telephonyProvider,
                  voice: config.deepgram?.voice,
                  language: config.deepgram?.language,
                  model: config.voiceModel,
                  serverRunning: server !== null,
                  activeCalls: server?.getActiveCalls().length ?? 0,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    },
    { optional: true },
  );

  // ---- Register background service ----

  api.registerService({
    id: "clawvoice-server",
    label: "ClawVoice Server",

    async start() {
      if (!config.deepgram?.apiKey) {
        log.warn(
          "No Deepgram API key — voice server will not start. Set DEEPGRAM_API_KEY or configure plugins.entries.clawvoice.config.deepgram.apiKey",
        );
        return;
      }

      server = new ClawVoiceServer(config);
      const { port, host } = await server.start();
      log.info(`Voice server started on ${host}:${port}`);
    },

    async stop() {
      if (server) {
        await server.stop();
        server = null;
        log.info("Voice server stopped");
      }
    },
  });

  // ---- Register CLI commands ----

  api.registerCli({
    command: "clawvoice",
    description: "Voice agent management",
    subcommands: {
      status: {
        description: "Show voice server status and active calls",
        async handler() {
          if (!server) {
            console.log("Voice server is not running.");
            return;
          }
          const calls = server.getActiveCalls();
          console.log(`Voice server: running`);
          console.log(`Active calls: ${calls.length}`);
          for (const call of calls) {
            const dur = Math.round(
              (Date.now() - call.startedAt.getTime()) / 1000,
            );
            console.log(
              `  ${call.callId}: ${call.from} → ${call.to} (${dur}s)`,
            );
          }
        },
      },
      config: {
        description: "Show current voice configuration",
        async handler() {
          console.log(
            JSON.stringify(
              {
                voiceProvider: config.voiceProvider,
                telephonyProvider: config.telephonyProvider,
                deepgramVoice: config.deepgram?.voice,
                language: config.deepgram?.language,
                model: config.voiceModel,
                port: config.serve?.port,
              },
              null,
              2,
            ),
          );
        },
      },
    },
  });

  log.info(
    `Registered (voice: ${config.voiceProvider}, telephony: ${config.telephonyProvider})`,
  );
}
