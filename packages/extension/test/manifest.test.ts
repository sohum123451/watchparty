import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, "..");

describe("Extension Manifest & Assets Validation", () => {
  it("should have a valid Manifest V3 json file", () => {
    const manifestPath = path.join(extensionRoot, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(content.manifest_version).toBe(3);
    expect(content.name).toBeTruthy();
    expect(content.version).toBeTruthy();
    expect(content.description).toBeTruthy();
  });

  it("should verify all referenced icon files exist on disk", () => {
    const manifestPath = path.join(extensionRoot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.icons).toBeDefined();
    for (const [size, iconRelPath] of Object.entries(manifest.icons)) {
      const fullPath = path.join(extensionRoot, iconRelPath as string);
      expect(fs.existsSync(fullPath)).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it("should define background service worker as module", () => {
    const manifestPath = path.join(extensionRoot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.background).toBeDefined();
    expect(manifest.background.service_worker).toBeTruthy();
    expect(manifest.background.type).toBe("module");
  });

  it("should declare only scoped host permissions and avoid broad <all_urls>", () => {
    const manifestPath = path.join(extensionRoot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.host_permissions).toBeInstanceOf(Array);
    expect(manifest.host_permissions).not.toContain("<all_urls>");

    // Check key streaming services
    const hosts = manifest.host_permissions.join(" ");
    expect(hosts).toContain("netflix.com");
    expect(hosts).toContain("disneyplus.com");
    expect(hosts).toContain("primevideo.com");
    expect(hosts).toContain("youtube.com");
  });
});
