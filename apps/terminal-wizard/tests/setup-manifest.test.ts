import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  declaredToolCount,
  getSetupToolVersion,
  setupManifest,
  setupSafety,
  setupStack,
} from "../app/data/setup-manifest";
import { lessons } from "../app/data/lessons";
import {
  basePracticeFiles,
  practiceDoctorOutput,
  practiceVersionLines,
} from "../app/lib/practice";

const manifestPath = fileURLToPath(
  new URL("../../../manifest/setup.json", import.meta.url),
);
const manifestOnDisk = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof setupManifest;

test("loads the checked-in workstation manifest as the app source of truth", () => {
  assert.deepEqual(setupManifest, manifestOnDisk);
  assert.equal(declaredToolCount, manifestOnDisk.tools.length);
  assert.deepEqual(setupStack, manifestOnDisk.profile.stack);
  assert.deepEqual(setupSafety, {
    approvalMode: manifestOnDisk.safety.ompApprovalMode,
    secretsEnabled: manifestOnDisk.safety.ompSecretsEnabled,
  });
});

test("mounts the complete current manifest in the practice filesystem", () => {
  const practiceManifest = JSON.parse(
    basePracticeFiles["/home/benjamin/Developer/terminal-wizard/setup.json"],
  );
  assert.deepEqual(practiceManifest, manifestOnDisk);
  assert.match(
    basePracticeFiles["/home/benjamin/Developer/terminal-wizard/config/omp.yml"],
    new RegExp(`approvalMode: ${manifestOnDisk.safety.ompApprovalMode}`),
  );
  assert.match(
    basePracticeFiles["/home/benjamin/Developer/terminal-wizard/config/omp.yml"],
    new RegExp(`enabled: ${manifestOnDisk.safety.ompSecretsEnabled}`),
  );
});

test("derives every simulated version and safety status from the manifest", () => {
  const commandToId: Record<string, string> = {
    ghostty: "ghostty",
    starship: "starship",
    herdr: "herdr",
    omp: "omp",
    codex: "codex",
    gh: "gh",
    node: "node",
    npm: "npm",
    pnpm: "pnpm",
    bun: "bun",
    go: "go",
    python3: "python",
    uv: "uv",
    nvim: "nvim",
    mise: "mise",
  };

  for (const [command, id] of Object.entries(commandToId)) {
    assert.match(
      practiceVersionLines[command],
      new RegExp(getSetupToolVersion(id).replaceAll(".", "\\.")),
      `${command} should expose the manifest version`,
    );
  }

  assert.match(
    practiceDoctorOutput,
    new RegExp(`OMP approval mode target: ${manifestOnDisk.safety.ompApprovalMode}`),
  );
  assert.match(
    practiceDoctorOutput,
    new RegExp(
      `OMP secret masking target: ${manifestOnDisk.safety.ompSecretsEnabled ? "enabled" : "disabled"}`,
    ),
  );
});

test("keeps lesson version and approval copy aligned with the manifest", () => {
  const runtimes = lessons.find((lesson) => lesson.id === "runtimes");
  const agents = lessons.find((lesson) => lesson.id === "agents");
  assert.ok(runtimes);
  assert.ok(agents);

  for (const id of ["node", "pnpm", "python", "uv"]) {
    assert.match(
      runtimes.commands.map((command) => command.detail).join("\n"),
      new RegExp(getSetupToolVersion(id).replaceAll(".", "\\.")),
    );
  }
  for (const id of ["herdr", "omp"]) {
    assert.match(
      agents.commands.map((command) => command.detail).join("\n"),
      new RegExp(getSetupToolVersion(id).replaceAll(".", "\\.")),
    );
  }
  assert.match(
    `${agents.summary}\n${agents.commands.map((command) => command.detail).join("\n")}`,
    new RegExp(manifestOnDisk.safety.ompApprovalMode, "i"),
  );
});

test("turns every declared learning path, shortcut, alias, and workflow into curriculum", () => {
  assert.deepEqual(
    [...new Set(lessons.flatMap((lesson) => lesson.manifestPathId ? [lesson.manifestPathId] : []))].sort(),
    manifestOnDisk.learningPaths.map((path) => path.id).sort(),
  );

  const curriculum = JSON.stringify(lessons);
  for (const shortcut of manifestOnDisk.shortcuts) assert.match(curriculum, new RegExp(shortcut.keys.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const alias of manifestOnDisk.aliases) {
    assert.match(curriculum, new RegExp(`\\b${alias.name}\\b`));
    assert.match(curriculum, new RegExp(alias.expandsTo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const workflow of manifestOnDisk.workflows) {
    assert.match(curriculum, new RegExp(workflow.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("does not reintroduce version literals beside the manifest adapter", () => {
  const sourcePaths = [
    new URL("../app/data/lessons.ts", import.meta.url),
    new URL("../app/lib/practice.ts", import.meta.url),
    new URL("../app/components/TerminalWizard.tsx", import.meta.url),
  ];
  const source = sourcePaths
    .map((url) => readFileSync(fileURLToPath(url), "utf8"))
    .join("\n");

  const pinnedVersions = new Set(
    manifestOnDisk.tools
      .map((tool) => tool.version)
      .filter((version) => !["system", "dotfiles"].includes(version)),
  );
  for (const version of pinnedVersions) {
    assert.equal(
      source.includes(version),
      false,
      `version ${version} must come from manifest/setup.json`,
    );
  }
  assert.match(source, /\{declaredToolCount\}/);
});
