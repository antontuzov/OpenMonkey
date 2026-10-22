import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import * as path from "node:path";

export default defineConfig({
  main: {
    build: {
      lib: { entry: path.resolve(__dirname, "src/main/main.ts"), formats: ["cjs"] },
      outDir: "dist/main",
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  },
  preload: {
    build: {
      lib: { entry: path.resolve(__dirname, "src/main/preload.ts"), formats: ["cjs"] },
      outDir: "dist/preload",
    },
  },
  renderer: {
    root: "src/renderer",
    // assets/ holds the 12 mood PNGs: served to the renderer at /logos/*.* and read
    // from disk by the main process for the tray and dock icons.
    publicDir: path.resolve(__dirname, "assets"),
    build: {
      outDir: path.resolve(__dirname, "dist/renderer"),
      emptyOutDir: true,
      rollupOptions: {
        input: { index: path.resolve(__dirname, "src/renderer/index.html") },
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      port: 5173,
    },
  },
});
