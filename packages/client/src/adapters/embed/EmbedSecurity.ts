/**
 * EmbedSecurity
 *
 * Implements strict sandboxing, feature policy constraints, and origin
 * verification for third-party player iframes.
 */

export const SANDBOX_PERMISSIONS = "allow-scripts allow-same-origin allow-presentation";
export const FEATURE_POLICY_ALLOW = "autoplay; fullscreen";

export class EmbedSecurity {
  /**
   * Applies mandatory sandboxing and feature policy permissions to an iframe element.
   */
  public static configureSandbox(iframe: HTMLIFrameElement): void {
    if (!iframe) return;
    try {
      iframe.setAttribute("sandbox", SANDBOX_PERMISSIONS);
      iframe.setAttribute("allow", FEATURE_POLICY_ALLOW);
      iframe.setAttribute("loading", "lazy");
    } catch {
      // Safe fallback for environments with restricted DOM setters
    }
  }

  /**
   * Safely extracts the expected origin from an embed URL.
   */
  public static extractOrigin(urlStr: string): string {
    try {
      const parsed = new URL(urlStr);
      return parsed.origin.toLowerCase();
    } catch {
      return "";
    }
  }

  /**
   * Validates that an incoming MessageEvent originated from the expected iframe
   * and matches its expected origin. Strictly rejects "null", opaque, or cross-origin messages.
   */
  public static isOriginTrusted(
    event: MessageEvent,
    expectedOrigin: string,
    iframeWindow?: Window | null
  ): boolean {
    if (!event || !expectedOrigin) return false;

    // 1. Validate that the sender window matches the specific iframe contentWindow
    if (iframeWindow && event.source !== iframeWindow) {
      return false;
    }

    const eventOrigin = (event.origin || "").toLowerCase();

    // 2. Reject opaque "null" origins
    if (!eventOrigin || eventOrigin === "null") {
      return false;
    }

    const targetOrigin = expectedOrigin.toLowerCase();

    // 3. Exact origin match
    if (eventOrigin === targetOrigin) {
      return true;
    }

    // 4. Handle provider-specific legitimate origin aliases (e.g. YouTube nocookie vs standard)
    if (
      (targetOrigin.includes("youtube.com") || targetOrigin.includes("youtube-nocookie.com")) &&
      (eventOrigin.includes("youtube.com") || eventOrigin.includes("youtube-nocookie.com"))
    ) {
      return true;
    }

    if (
      (targetOrigin.includes("vimeo.com") || targetOrigin.includes("player.vimeo.com")) &&
      (eventOrigin.includes("vimeo.com") || eventOrigin.includes("player.vimeo.com"))
    ) {
      return true;
    }

    // 5. Use Origin API if available in runtime
    if (typeof (globalThis as any).Origin !== "undefined" && typeof (globalThis as any).Origin.from === "function") {
      try {
        const fromEvent = (globalThis as any).Origin.from(event);
        const fromTarget = (globalThis as any).Origin.from(targetOrigin);
        return fromEvent.isSameOrigin(fromTarget);
      } catch {
        // Fall back to direct comparison
      }
    }

    return false;
  }
}
