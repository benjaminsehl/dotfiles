import { chmod, lstat, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

if (process.platform !== "darwin") process.exit(0);

const require = createRequire(import.meta.url);
let packageRoot = dirname(require.resolve("node-pty"));

for (let depth = 0; depth < 6; depth += 1) {
  try {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (manifest.name === "node-pty") break;
  } catch {
    // Keep walking toward the package root.
  }
  const parent = dirname(packageRoot);
  if (parent === packageRoot) throw new Error("Could not locate the node-pty package root");
  packageRoot = parent;
}

const helper = resolve(packageRoot, "prebuilds", `darwin-${process.arch}`, "spawn-helper");
if (!helper.startsWith(`${resolve(packageRoot)}/`)) throw new Error("Refusing an unsafe node-pty helper path");

const metadata = await lstat(helper);
if (!metadata.isFile() || metadata.isSymbolicLink()) {
  throw new Error(`Expected a regular node-pty spawn helper at ${helper}`);
}

await chmod(helper, 0o755);
console.log(`Prepared node-pty spawn helper for darwin-${process.arch}`);
