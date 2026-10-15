/**
 * XSS-safe text sanitization.
 * Escapes dangerous HTML characters to prevent script injection.
 */
export function sanitizeText(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Validates whether an emoji is a standard single/compound emoji character.
 */
export function isValidEmoji(str: string): boolean {
  if (!str) return false;
  // Common emoji ranges regex (supports standard emojis, skin tones, zero-width joiners)
  const emojiRegex = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)+$/u;
  return emojiRegex.test(str.trim());
}

/**
 * Checks if a property key represents a prototype pollution attempt.
 */
export function isPrototypePollutionKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

/**
 * Recursively strips prototype pollution keys (__proto__, constructor, prototype) from an object.
 * Returns a clean, decoupled deep copy.
 */
export function sanitizeObject<T>(input: T): T {
  if (input === null || typeof input !== "object") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeObject(item)) as unknown as T;
  }

  const cleanObj: Record<string, any> = {};
  for (const [key, val] of Object.entries(input)) {
    if (isPrototypePollutionKey(key)) {
      continue;
    }
    cleanObj[key] = sanitizeObject(val);
  }

  return cleanObj as T;
}

/**
 * Parses JSON safely without permitting prototype pollution.
 */
export function safeJsonParse<T = unknown>(
  jsonStr: string
): { success: true; data: T } | { success: false; error: string } {
  try {
    const data = JSON.parse(jsonStr, (key, value) => {
      if (isPrototypePollutionKey(key)) {
        return undefined;
      }
      return value;
    });
    return { success: true, data: sanitizeObject(data) };
  } catch (err: any) {
    return { success: false, error: err.message || "Malformed JSON payload" };
  }
}
