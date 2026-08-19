import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  configFile: false,
  root: projectRoot,
  publicDir: false,
  logLevel: "info",
  build: {
    ssr: join(projectRoot, "server", "pty-server.ts"),
    outDir: join(projectRoot, "dist", "server"),
    emptyOutDir: false,
    target: "node22",
    sourcemap: false,
    minify: false,
    rolldownOptions: {
      output: { entryFileNames: "pty-server.mjs" },
    },
  },
});
