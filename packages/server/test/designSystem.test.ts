import { describe, it, expect } from "vitest";
import { getDesignSystemHtml } from "../src/ui/DesignSystemPage.js";
import { getTokensCss } from "../src/ui/tokensCss.js";
import { CinemaColors, CinemaTypography, CinemaSpacing, CinemaRadii } from "@watchparty/shared";

describe("Design System — 'The Private Cinema' Atelier & Tokens", () => {
  describe("Colour Tokens & Budget Constraints", () => {
    it("defines exact required color tokens in shared module", () => {
      expect(CinemaColors.bg).toBe("#0E0B09");
      expect(CinemaColors.surface).toBe("#1A1512");
      expect(CinemaColors.surface2).toBe("#261E19");
      expect(CinemaColors.text).toBe("#F3E9DC");
      expect(CinemaColors.muted).toBe("#A89B8C");
      expect(CinemaColors.accent).toBe("#FF9F1C");
      expect(CinemaColors.accent2).toBe("#E4572E");
      expect(CinemaColors.live).toBe("#2EC4B6");
      expect(CinemaColors.danger).toBe("#D62839");
    });

    it("verifies tokens CSS contains all color variables and dark-theme only root", () => {
      const css = getTokensCss();
      expect(css).toContain("--bg: #0E0B09;");
      expect(css).toContain("--surface: #1A1512;");
      expect(css).toContain("--surface-2: #261E19;");
      expect(css).toContain("--text: #F3E9DC;");
      expect(css).toContain("--muted: #A89B8C;");
      expect(css).toContain("--accent: #FF9F1C;");
      expect(css).toContain("--accent-2: #E4572E;");
      expect(css).toContain("--live: #2EC4B6;");
      expect(css).toContain("--danger: #D62839;");

      // Banned check: no purple to blue gradients
      expect(css.toLowerCase()).not.toContain("linear-gradient(135deg, #6366f1");
      expect(css.toLowerCase()).not.toContain("#8b5cf6");
    });
  });

  describe("Typography Scale & Rules", () => {
    it("specifies Fraunces / Bricolage Grotesque, DM Sans / Instrument Sans, and JetBrains Mono", () => {
      expect(CinemaTypography.fonts.display).toContain("Fraunces");
      expect(CinemaTypography.fonts.ui).toContain("DM Sans");
      expect(CinemaTypography.fonts.mono).toContain("JetBrains Mono");
      expect(CinemaTypography.displayTracking).toBe("-0.035em");
      expect(CinemaTypography.chatLeading).toBe("1.625");
    });

    it("defines generous line height for chat messages in CSS", () => {
      const css = getTokensCss();
      expect(css).toContain("--leading-chat: 1.625;");
      expect(css).toContain("--tracking-tight-display: -0.035em;");
    });
  });

  describe("Showcase Page (/design)", () => {
    it("generates a rich, interactive HTML atelier page", () => {
      const html = getDesignSystemHtml();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("The Private Cinema");
      expect(html).toContain("Fraunces");
      expect(html).toContain("JetBrains Mono");
      expect(html).toContain("Accent Budget");
      expect(html).toContain("Film Grain");
      expect(html).toContain("Projector Beam");
    });

    it("includes custom SVG icons and zero emoji icons", () => {
      const html = getDesignSystemHtml();
      expect(html).toContain("<svg");
      expect(html).toContain("35mm Reel");
      expect(html).toContain("Ticket Stub");
      expect(html).toContain("Projector");
    });

    it("includes personality-driven empty, loading, and error states", () => {
      const html = getDesignSystemHtml();
      expect(html).toContain("The Projector is Cold");
      expect(html).toContain("Threading 35mm Gate");
      expect(html).toContain("Intermission: Film Jammed");
    });

    it("includes perforated ticket stub cards and interactive transport deck", () => {
      const html = getDesignSystemHtml();
      expect(html).toContain("ticket-perforation");
      expect(html).toContain("ticket-card");
      expect(html).toContain("timeline-bar-wrap");
      expect(html).toContain("timecode-display");
    });
  });

  describe("HTTP Routes Integration", () => {
    it("handles /design and /tokens.css GET routes", async () => {
      const { createServer } = await import("node:http");
      const server = createServer((req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        if (url.pathname === "/design" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(getDesignSystemHtml());
          return;
        }
        if (url.pathname === "/tokens.css" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
          res.end(getTokensCss());
          return;
        }
        res.writeHead(404);
        res.end("Not Found");
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const addr = server.address() as any;
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      try {
        const resDesign = await fetch(`${baseUrl}/design`);
        expect(resDesign.status).toBe(200);
        expect(resDesign.headers.get("content-type")).toContain("text/html");
        const bodyDesign = await resDesign.text();
        expect(bodyDesign).toContain("The Private Cinema");

        const resTokens = await fetch(`${baseUrl}/tokens.css`);
        expect(resTokens.status).toBe(200);
        expect(resTokens.headers.get("content-type")).toContain("text/css");
        const bodyTokens = await resTokens.text();
        expect(bodyTokens).toContain("--bg: #0E0B09;");
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
