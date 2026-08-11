import setupManifestJson from "../../../../manifest/setup.json";

export type SetupTool = {
  id: string;
  name: string;
  command: string;
  version: string;
  category: string;
  purpose: string;
};

export type SetupShortcut = {
  scope: string;
  keys: string;
  action: string;
};

export type SetupAlias = {
  scope: string;
  name: string;
  expandsTo: string;
  purpose: string;
};

export type SetupWorkflow = {
  id: string;
  title: string;
  command: string;
  mutates: boolean;
  network: string;
  purpose: string;
};

export type SetupLearningPath = {
  id: string;
  title: string;
  level: "beginner" | "intermediate" | "advanced";
  minutes: number;
  tools: string[];
  outcomes: string[];
  practice: Array<{ prompt: string; command: string }>;
};

export type SetupManifest = {
  schemaVersion: number;
  profile: {
    name: string;
    platform: string;
    architectures: string[];
    shell: string;
    stack: string[];
  };
  releasePolicy: {
    packageStrategy: string;
    runtimePinning: string;
    minimumRuntimeReleaseAge: string;
    automaticShellInstalls: boolean;
  };
  tools: SetupTool[];
  shortcuts: SetupShortcut[];
  aliases: SetupAlias[];
  workflows: SetupWorkflow[];
  learningPaths: SetupLearningPath[];
  safety: {
    ompApprovalMode: string;
    ompSecretsEnabled: boolean;
    herdrPaneHistory: boolean;
    dotfilesAllowlistOnly: boolean;
    networkAtShellStartup: boolean;
    automaticGitPulls: boolean;
    localOverrides: string[];
    neverTrack: string[];
  };
  sources: Record<string, string>;
};

function normalizeLearningLevel(level: string): SetupLearningPath["level"] {
  if (level === "beginner" || level === "intermediate" || level === "advanced") {
    return level;
  }
  throw new Error(`Unsupported learning-path level “${level}” in manifest/setup.json`);
}

// This import is deliberately outside the app directory: the checked-in
// workstation manifest is the source for every setup fact shown in the app.
// Normalize the JSON boundary so an invalid level fails clearly at startup.
export const setupManifest: SetupManifest = {
  ...setupManifestJson,
  learningPaths: setupManifestJson.learningPaths.map((path) => ({
    ...path,
    level: normalizeLearningLevel(path.level),
  })),
};

const toolsById = new Map(setupManifest.tools.map((tool) => [tool.id, tool]));
const aliasesByName = new Map(setupManifest.aliases.map((alias) => [alias.name, alias]));
const workflowsById = new Map(setupManifest.workflows.map((workflow) => [workflow.id, workflow]));
const learningPathsById = new Map(setupManifest.learningPaths.map((path) => [path.id, path]));

export const declaredToolCount = setupManifest.tools.length;
export const setupStack = setupManifest.profile.stack;
export const setupShortcuts = setupManifest.shortcuts;
export const setupSafety = {
  approvalMode: setupManifest.safety.ompApprovalMode,
  secretsEnabled: setupManifest.safety.ompSecretsEnabled,
} as const;

export function getSetupTool(id: string): SetupTool {
  const tool = toolsById.get(id);
  if (!tool) throw new Error(`Tool “${id}” is missing from manifest/setup.json`);
  return tool;
}

export function getSetupToolVersion(id: string): string {
  return getSetupTool(id).version;
}

export function getSetupAlias(name: string): SetupAlias {
  const alias = aliasesByName.get(name);
  if (!alias) throw new Error(`Alias “${name}” is missing from manifest/setup.json`);
  return alias;
}

export function getSetupWorkflow(id: string): SetupWorkflow {
  const workflow = workflowsById.get(id);
  if (!workflow) throw new Error(`Workflow “${id}” is missing from manifest/setup.json`);
  return workflow;
}

export function getSetupLearningPath(id: string): SetupLearningPath {
  const path = learningPathsById.get(id);
  if (!path) throw new Error(`Learning path “${id}” is missing from manifest/setup.json`);
  return path;
}
