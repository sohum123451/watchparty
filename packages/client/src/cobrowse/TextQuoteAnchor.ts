import { RelativeReadingPosition, W3CTextQuoteSelector } from "@watchparty/shared";

export class TextQuoteAnchor {
  /**
   * Computes the relative reading position based on the nearest visible heading or paragraph.
   * Survives different viewport widths, font sizes, and screen layouts.
   */
  public static computeRelativePosition(
    viewportScrollY: number,
    doc: Document = typeof document !== "undefined" ? document : ({} as any)
  ): RelativeReadingPosition {
    if (!doc.querySelectorAll) {
      return {
        anchorSelector: "body",
        offsetPx: Math.round(viewportScrollY),
        percentageWithinAnchor: 0,
      };
    }

    const candidateElements = Array.from(
      doc.querySelectorAll("h1, h2, h3, h4, h5, h6, p, section, article, blockquote, [data-anchor]")
    ) as HTMLElement[];

    if (candidateElements.length === 0) {
      return {
        anchorSelector: "body",
        offsetPx: Math.round(viewportScrollY),
        percentageWithinAnchor: 0,
      };
    }

    // Find the element nearest to the top of the viewport (either above or slightly below)
    let bestEl: HTMLElement = candidateElements[0];
    let smallestDistance = Infinity;

    for (const el of candidateElements) {
      const rectTop = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect().top + viewportScrollY : 0;
      const top = typeof el.offsetTop === "number" ? el.offsetTop : rectTop;
      const height = el.offsetHeight || 30;

      // Distance from top of viewport to the element
      const diff = top - viewportScrollY;

      // Prioritize elements whose top is just at or above the viewport scroll line
      if (diff <= 100 && diff >= -height) {
        bestEl = el;
        break;
      }

      const absDist = Math.abs(diff);
      if (absDist < smallestDistance) {
        smallestDistance = absDist;
        bestEl = el;
      }
    }

    const elementTop = bestEl.offsetTop ?? 0;
    const elementHeight = Math.max(1, bestEl.offsetHeight || 30);
    const offsetPx = Math.max(0, viewportScrollY - elementTop);
    const percentageWithinAnchor = Math.min(1.0, Math.max(0.0, offsetPx / elementHeight));

    const selector = this.generateAnchorSelector(bestEl);
    const snippet = (bestEl.textContent || "").trim().slice(0, 60);

    return {
      anchorSelector: selector,
      anchorTextSnippet: snippet.length > 0 ? snippet : undefined,
      offsetPx: Math.round(offsetPx),
      percentageWithinAnchor: Number(percentageWithinAnchor.toFixed(3)),
    };
  }

  /**
   * Generates a stable CSS selector for an element (prioritizing ID, then heading/tag index).
   */
  public static generateAnchorSelector(el: HTMLElement): string {
    if (el.id) {
      return `#${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(el.id) : el.id}`;
    }

    const tagName = el.tagName.toLowerCase();
    if (el.parentElement) {
      const siblings = Array.from(el.parentElement.children).filter(
        (c) => c.tagName.toLowerCase() === tagName
      );
      const index = siblings.indexOf(el) + 1;
      return `${tagName}:nth-of-type(${index})`;
    }

    return tagName;
  }

  /**
   * Resolves a target anchor element in the document, falling back to text snippet search.
   */
  public static resolveAnchorElement(
    selector: string,
    snippet?: string,
    doc: Document = typeof document !== "undefined" ? document : ({} as any)
  ): HTMLElement | null {
    if (!doc.querySelector) return null;

    try {
      const direct = doc.querySelector(selector) as HTMLElement | null;
      if (direct) return direct;
    } catch {}

    // Fallback: search by text snippet
    if (snippet && snippet.length > 5 && doc.querySelectorAll) {
      const candidates = Array.from(
        doc.querySelectorAll("h1, h2, h3, h4, h5, h6, p, section, article")
      ) as HTMLElement[];

      const cleanSnippet = snippet.toLowerCase().trim();
      for (const el of candidates) {
        const text = (el.textContent || "").toLowerCase();
        if (text.includes(cleanSnippet) || cleanSnippet.includes(text.slice(0, 30))) {
          return el;
        }
      }
    }

    return null;
  }

  /**
   * Translates a relative reading position back to an absolute pixel scroll target
   * for the current device/viewport.
   */
  public static calculateTargetScrollTop(
    position: RelativeReadingPosition,
    doc: Document = typeof document !== "undefined" ? document : ({} as any)
  ): number {
    const el = this.resolveAnchorElement(position.anchorSelector, position.anchorTextSnippet, doc);
    if (!el) {
      return position.offsetPx || 0;
    }

    const elTop = el.offsetTop ?? 0;
    const elHeight = el.offsetHeight || 30;

    // Use percentage within anchor if available to adapt to different screen aspect ratios
    if (typeof position.percentageWithinAnchor === "number" && position.percentageWithinAnchor > 0) {
      return Math.round(elTop + position.percentageWithinAnchor * elHeight);
    }

    return Math.round(elTop + (position.offsetPx || 0));
  }

  // ==========================================
  // W3C TEXT QUOTE SELECTOR (HIGHLIGHTS & COMMENTS)
  // ==========================================

  /**
   * Generates a W3C Web Annotation TextQuoteSelector with exact, prefix, and suffix context.
   */
  public static createTextQuoteSelector(
    exact: string,
    fullContent: string,
    matchIndex: number,
    prefixLength = 32,
    suffixLength = 32
  ): W3CTextQuoteSelector {
    const safeStart = Math.max(0, matchIndex - prefixLength);
    const prefix = fullContent.slice(safeStart, matchIndex);
    const suffixEnd = Math.min(fullContent.length, matchIndex + exact.length + suffixLength);
    const suffix = fullContent.slice(matchIndex + exact.length, suffixEnd);

    return {
      exact,
      prefix: prefix.length > 0 ? prefix : undefined,
      suffix: suffix.length > 0 ? suffix : undefined,
    };
  }

  /**
   * Resolves a W3C TextQuoteSelector against full text content, disambiguating duplicates
   * using prefix and suffix matches.
   */
  public static findTextQuoteMatch(
    fullContent: string,
    selector: W3CTextQuoteSelector
  ): { startIndex: number; endIndex: number } | null {
    if (!fullContent || !selector || !selector.exact) return null;

    const exact = selector.exact;
    let fromIndex = 0;
    let bestIndex = -1;
    let highestScore = -1;

    while (true) {
      const idx = fullContent.indexOf(exact, fromIndex);
      if (idx === -1) break;

      let score = 1; // Base exact match score

      if (selector.prefix) {
        const precedingText = fullContent.slice(Math.max(0, idx - selector.prefix.length), idx);
        if (precedingText === selector.prefix) {
          score += 5;
        } else if (precedingText.endsWith(selector.prefix.slice(-10))) {
          score += 2;
        }
      }

      if (selector.suffix) {
        const trailingText = fullContent.slice(
          idx + exact.length,
          idx + exact.length + selector.suffix.length
        );
        if (trailingText === selector.suffix) {
          score += 5;
        } else if (trailingText.startsWith(selector.suffix.slice(0, 10))) {
          score += 2;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestIndex = idx;
      }

      fromIndex = idx + 1;
    }

    if (bestIndex !== -1) {
      return {
        startIndex: bestIndex,
        endIndex: bestIndex + exact.length,
      };
    }

    return null;
  }
}
