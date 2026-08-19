import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DOCUMENT_HEADERS } from "./scripts/run-local.mjs";

const DOTFILES_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4317,
    strictPort: true,
    fs: { allow: [DOTFILES_ROOT] },
    headers: DOCUMENT_HEADERS,
    ...(isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : {}),
  },
  preview: {
    host: "127.0.0.1",
    port: 4317,
    strictPort: true,
    headers: DOCUMENT_HEADERS,
  },
  build: {
    target: "es2022",
  },
});
