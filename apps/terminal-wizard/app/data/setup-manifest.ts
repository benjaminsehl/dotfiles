import setupManifestJson from "../../../../manifest/setup.json";

export type SetupTool = {
  id: string;
  name: string;
  command: string;
  version: string;
  category: string;
  purpose: string;
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
  shortcuts: Array<Record<string, unknown>>;
  aliases: Array<Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
  learningPaths: Array<Record<string, unknown>>;
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

// This import is deliberately outside the app directory: the checked-in
// workstation manifest is the source for every setup fact shown in the app.
export const setupManifest: SetupManifest = setupManifestJson;

const toolsById = new Map(setupManifest.tools.map((tool) => [tool.id, tool]));

export const declaredToolCount = setupManifest.tools.length;
export const setupStack = setupManifest.profile.stack;
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
