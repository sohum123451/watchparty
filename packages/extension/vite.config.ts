import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        "background/serviceWorker": resolve(__dirname, "src/background/serviceWorker.ts"),
        "content/content": resolve(__dirname, "src/content/content.ts"),
        "popup/popup": resolve(__dirname, "src/popup/popup.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        format: "esm",
      },
    },
  },
});
