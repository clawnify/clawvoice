import * as crypto from "node:crypto";

/**
 * Strip markdown formatting from text for voice output.
 * Spoken responses should be plain text — no headers, bold, links, etc.
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // Code blocks (``` ... ```)
      .replace(/```[\s\S]*?```/g, "")
      // Inline code (`...`)
      .replace(/`([^`]+)`/g, "$1")
      // Bold/italic (**text**, *text*, __text__, _text_)
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      // Headers (# ...)
      .replace(/^#{1,6}\s+/gm, "")
      // Links [text](url)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Images ![alt](url)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      // Bullet points
      .replace(/^[\s]*[-*+]\s+/gm, "")
      // Numbered lists
      .replace(/^[\s]*\d+\.\s+/gm, "")
      // Blockquotes
      .replace(/^>\s+/gm, "")
      // Horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // HTML tags
      .replace(/<[^>]+>/g, "")
      // Emojis (common unicode ranges)
      .replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        "",
      )
      // Multiple newlines → single
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Validate Twilio webhook signature.
 * See: https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  // Build the data string: URL + sorted params concatenated as key+value
  const keys = Object.keys(params).sort();
  let data = url;
  for (const key of keys) {
    data += key + params[key];
  }

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(data, "utf-8")
    .digest("base64");

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "base64"),
      Buffer.from(expected, "base64"),
    );
  } catch {
    return false;
  }
}

/** Generate a random hex secret */
export function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** Simple logger with prefix */
export function createLogger(prefix: string) {
  return {
    info: (...args: unknown[]) => console.log(`[${prefix}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${prefix}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${prefix}]`, ...args),
    debug: (...args: unknown[]) => {
      if (process.env.CLAWVOICE_DEBUG) {
        console.log(`[${prefix}:debug]`, ...args);
      }
    },
  };
}
