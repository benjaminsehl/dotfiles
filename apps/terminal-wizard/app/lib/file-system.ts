import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type PermissionState = "granted" | "prompt" | "denied";

export type FolderSnapshot = Readonly<{
  label: string;
  permission: PermissionState;
  remembered: boolean;
  staleSavedHandle: boolean;
  files: Record<string, string>;
  fileCount: number;
  blockedCount: number;
  truncated: boolean;
}>;

export const FILE_SYSTEM_LIMITS = Object.freeze({
  maxDepth: 4,
  maxEntries: 300,
  maxFileBytes: 256 * 1024,
  maxSnapshotBytes: 8 * 1024 * 1024,
});

const DATABASE_NAME = "terminal-wizard-file-system";
const DATABASE_VERSION = 1;
const HANDLE_STORE_NAME = "handles";
const WORKSPACE_HANDLE_KEY = "workspace";
const WORKSPACE_ROOT = "/workspace";
const PICKER_ID = "terminal-wizard-workspace";

const BLOCKED_DIRECTORY_NAMES = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".docker",
  ".git",
  ".kube",
  "node_modules",
]);

const TEXT_EXTENSIONS = new Set([
  "astro",
  "bash",
  "c",
  "cjs",
  "conf",
  "config",
  "cpp",
  "css",
  "csv",
  "diff",
  "editorconfig",
  "fish",
  "gitattributes",
  "gitconfig",
  "gitignore",
  "go",
  "graphql",
  "gql",
  "ghostty",
  "h",
  "hcl",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "lock",
  "lua",
  "mjs",
  "md",
  "mdx",
  "mts",
  "nix",
  "npmrc",
  "patch",
  "php",
  "properties",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svg",
  "svelte",
  "swift",
  "tf",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "yarnrc",
  "zsh",
]);

const BLOCKED_EXACT_FILE_NAMES = new Set([
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "authorized_keys",
  "credentials",
  "hosts.yml",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "known_hosts",
]);

const SENSITIVE_NAME_TOKEN =
  /(?:^|[._-])(?:access[._-]?key|api[._-]?key|auth|authorization|auth[._-]?token|authtoken|bearer|bearer[._-]?token|client[._-]?secret|credential|credentials|oauth|oauth[._-]?token|password|passwd|private[._-]?key|secret|secrets|token|tokens)(?:[._-]|$)/i;
const PRIVATE_KEY_EXTENSION = /\.(?:jks|key|keystore|p12|pfx|pem)$/i;
const ENV_FILE_NAME = /^\.env/i;
const YARN_RC_FILE_NAME = /^\.yarnrc/i;
const SECRET_KEY =
  /(?:^|[._-])(?:access[._-]?key|api[._-]?key|auth|authorization|auth[._-]?token|authtoken|bearer|bearer[._-]?token|client[._-]?secret|credential|credentials|oauth|oauth[._-]?token|password|passwd|private[._-]?key|secret|token)(?:[._-]|$)/i;
const SAFE_SECRET_VALUE =
  /^(?:["']?(?:\$\{?[A-Z_][A-Z0-9_]*\}?|\[?redacted\]?|<[^>]+>|change[_-]?me|example|replace[_-]?me)["']?[,;]?)$/i;
const PRIVATE_KEY_HEADER = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/;

interface FileSystemDatabase extends DBSchema {
  handles: {
    key: string;
    value: FileSystemDirectoryHandle;
  };
}

interface HandleStore {
  get(): Promise<FileSystemDirectoryHandle | null>;
  put(handle: FileSystemDirectoryHandle): Promise<void>;
  delete(): Promise<void>;
}

type ScanState = {
  files: Record<string, string>;
  visitedEntries: number;
  decodedBytes: number;
  blockedCount: number;
  truncated: boolean;
};

type TextReadResult =
  | { allowed: true; text: string; byteLength: number }
  | { allowed: false };

let databasePromise: Promise<IDBPDatabase<FileSystemDatabase>> | null = null;
let currentHandle: FileSystemDirectoryHandle | null = null;
let currentHandleRemembered = false;
let staleSavedHandle = false;

const indexedDbHandleStore: HandleStore = {
  async get() {
    const database = await getDatabase();
    return (await database.get(HANDLE_STORE_NAME, WORKSPACE_HANDLE_KEY)) ?? null;
  },
  async put(handle) {
    const database = await getDatabase();
    await database.put(HANDLE_STORE_NAME, handle, WORKSPACE_HANDLE_KEY);
  },
  async delete() {
    const database = await getDatabase();
    await database.delete(HANDLE_STORE_NAME, WORKSPACE_HANDLE_KEY);
  },
};

let handleStore: HandleStore = indexedDbHandleStore;

export class FileSystemCapabilityError extends Error {
  readonly code: "UNSUPPORTED" | "NOT_RESTORED" | "STORAGE_UNAVAILABLE";

  constructor(
    code: "UNSUPPORTED" | "NOT_RESTORED" | "STORAGE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "FileSystemCapabilityError";
    this.code = code;
  }
}

export function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    typeof window.showDirectoryPicker === "function"
  );
}

/**
 * Call this function directly from a click or key activation handler. The
 * native picker is invoked synchronously, before any other asynchronous work.
 */
export function connectFolder(): Promise<FolderSnapshot> {
  if (!supportsFileSystemAccess()) {
    return Promise.reject(
      new FileSystemCapabilityError(
        "UNSUPPORTED",
        "Folder access requires a secure Chromium context.",
      ),
    );
  }

  let pickerResult: Promise<FileSystemDirectoryHandle>;
  try {
    pickerResult = window.showDirectoryPicker({ id: PICKER_ID, mode: "read" });
  } catch (error) {
    return Promise.reject(error);
  }

  return pickerResult.then(async (handle) => {
    currentHandle = handle;
    try {
      await handleStore.put(handle);
      currentHandleRemembered = true;
      staleSavedHandle = false;
    } catch {
      currentHandleRemembered = false;
      try {
        await handleStore.delete();
        staleSavedHandle = false;
      } catch {
        staleSavedHandle = true;
      }
    }
    const permission = normalizePermission(
      await handle.queryPermission({ mode: "read" }),
    );
    return snapshotFor(
      handle,
      permission,
      currentHandleRemembered,
      staleSavedHandle,
    );
  });
}

export async function restoreFolder(): Promise<FolderSnapshot | null> {
  const handle = await handleStore.get();
  if (!handle) {
    currentHandle = null;
    currentHandleRemembered = false;
    staleSavedHandle = false;
    return null;
  }

  currentHandle = handle;
  currentHandleRemembered = true;
  staleSavedHandle = false;
  const permission = normalizePermission(
    await handle.queryPermission({ mode: "read" }),
  );
  return snapshotFor(handle, permission, currentHandleRemembered, false);
}

/**
 * Reconnect after restoreFolder() reports `prompt`. Call directly from a user
 * gesture so requestPermission() retains transient browser activation.
 */
export function reconnectFolder(): Promise<FolderSnapshot> {
  const handle = currentHandle;
  if (!handle) {
    return Promise.reject(
      new FileSystemCapabilityError(
        "NOT_RESTORED",
        "Restore the saved folder before requesting permission again.",
      ),
    );
  }

  let permissionResult: Promise<globalThis.PermissionState>;
  try {
    permissionResult = handle.requestPermission({ mode: "read" });
  } catch (error) {
    return Promise.reject(error);
  }

  return permissionResult.then((permission) =>
    snapshotFor(
      handle,
      normalizePermission(permission),
      currentHandleRemembered,
      staleSavedHandle,
    ),
  );
}

export async function forgetFolder(): Promise<void> {
  await handleStore.delete();
  currentHandle = null;
  currentHandleRemembered = false;
  staleSavedHandle = false;
}

export function sanitizeTerminalText(value: string): string {
  let sanitized = "";
  for (const character of value.replace(/\r\n?/g, "\n")) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && !isUnsafeTerminalCodePoint(codePoint)) {
      sanitized += character;
    }
  }
  return sanitized;
}

export function redactLikelySecrets(value: string): string {
  return value
    .split("\n")
    .map((line) => redactSecretLine(line))
    .join("\n");
}

export function isBlockedWorkspacePath(path: string): boolean {
  const segments = path.split(/[\\/]+/).filter(Boolean);

  return segments.some((segment) => {
    const lowerName = segment.toLowerCase();
    return (
      lowerName === "workspace" ? false : isBlockedEntryName(lowerName)
    );
  });
}

export function isTextFileName(name: string): boolean {
  const baseName = name.split(/[\\/]/).at(-1) ?? "";
  const finalDot = baseName.lastIndexOf(".");

  if (!baseName || isBlockedEntryName(baseName.toLowerCase())) return false;
  if (finalDot <= 0) return true;
  if (finalDot === baseName.length - 1) return false;

  return TEXT_EXTENSIONS.has(baseName.slice(finalDot + 1).toLowerCase());
}

async function getDatabase(): Promise<IDBPDatabase<FileSystemDatabase>> {
  if (typeof indexedDB === "undefined") {
    throw new FileSystemCapabilityError(
      "STORAGE_UNAVAILABLE",
      "IndexedDB is unavailable, so the selected folder cannot be remembered.",
    );
  }

  databasePromise ??= openDB<FileSystemDatabase>(
    DATABASE_NAME,
    DATABASE_VERSION,
    {
      upgrade(database) {
        if (!database.objectStoreNames.contains(HANDLE_STORE_NAME)) {
          database.createObjectStore(HANDLE_STORE_NAME);
        }
      },
    },
  );
  return databasePromise;
}

function normalizePermission(value: globalThis.PermissionState): PermissionState {
  if (value === "granted" || value === "prompt") return value;
  return "denied";
}

async function snapshotFor(
  handle: FileSystemDirectoryHandle,
  permission: PermissionState,
  remembered: boolean,
  staleHandle: boolean,
): Promise<FolderSnapshot> {
  const label = sanitizeLabel(handle.name);
  if (permission !== "granted") {
    return freezeSnapshot({
      label,
      permission,
      remembered,
      staleSavedHandle: staleHandle,
      files: {},
      fileCount: 0,
      blockedCount: 0,
      truncated: false,
    });
  }
  if (isBlockedEntryName(handle.name.toLowerCase())) {
    return freezeSnapshot({
      label,
      permission,
      remembered,
      staleSavedHandle: staleHandle,
      files: {},
      fileCount: 0,
      blockedCount: 1,
      truncated: false,
    });
  }

  const state: ScanState = {
    files: {},
    visitedEntries: 0,
    decodedBytes: 0,
    blockedCount: 0,
    truncated: false,
  };
  await scanDirectory(handle, [], state);

  return freezeSnapshot({
    label,
    permission,
    remembered,
    staleSavedHandle: staleHandle,
    files: state.files,
    fileCount: Object.keys(state.files).length,
    blockedCount: state.blockedCount,
    truncated: state.truncated,
  });
}

async function scanDirectory(
  directory: FileSystemDirectoryHandle,
  parentSegments: string[],
  state: ScanState,
): Promise<boolean> {
  let iterator: AsyncIterator<[string, FileSystemHandle]>;
  try {
    iterator = directory.entries()[Symbol.asyncIterator]();
  } catch {
    state.blockedCount += 1;
    return true;
  }

  while (true) {
    let iteration: IteratorResult<[string, FileSystemHandle]>;
    try {
      iteration = await iterator.next();
    } catch {
      state.blockedCount += 1;
      return true;
    }
    if (iteration.done) return true;

    const [rawName, entry] = iteration.value;
    if (state.visitedEntries >= FILE_SYSTEM_LIMITS.maxEntries) {
      state.truncated = true;
      return false;
    }
    state.visitedEntries += 1;

    const name = sanitizeEntryName(rawName);
    const segments = [...parentSegments, name];
    if (
      !name ||
      name !== rawName ||
      segments.length > FILE_SYSTEM_LIMITS.maxDepth ||
      isBlockedWorkspacePath(`${WORKSPACE_ROOT}/${segments.join("/")}`)
    ) {
      state.blockedCount += 1;
      if (segments.length > FILE_SYSTEM_LIMITS.maxDepth) {
        state.truncated = true;
      }
      continue;
    }

    if (entry.kind === "directory") {
      if (segments.length >= FILE_SYSTEM_LIMITS.maxDepth) {
        state.blockedCount += 1;
        state.truncated = true;
        continue;
      }
      const completed = await scanDirectory(
        entry as FileSystemDirectoryHandle,
        segments,
        state,
      );
      if (!completed) return false;
      continue;
    }

    if (entry.kind !== "file" || !isTextFileName(name)) {
      state.blockedCount += 1;
      continue;
    }

    let result: TextReadResult;
    try {
      result = await readTextFile(entry as FileSystemFileHandle, name);
    } catch {
      state.blockedCount += 1;
      continue;
    }
    if (!result.allowed) {
      state.blockedCount += 1;
      continue;
    }
    if (
      state.decodedBytes + result.byteLength >
      FILE_SYSTEM_LIMITS.maxSnapshotBytes
    ) {
      state.blockedCount += 1;
      state.truncated = true;
      return false;
    }

    const path = `${WORKSPACE_ROOT}/${segments.join("/")}`;
    state.files[path] = result.text;
    state.decodedBytes += result.byteLength;
  }
}

async function readTextFile(
  handle: FileSystemFileHandle,
  name: string,
): Promise<TextReadResult> {
  if (!isTextFileName(name)) return { allowed: false };

  const file = await handle.getFile();
  if (file.size > FILE_SYSTEM_LIMITS.maxFileBytes) {
    return { allowed: false };
  }
  if (isBinaryMimeType(file.type)) return { allowed: false };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) return { allowed: false };

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { allowed: false };
  }
  if (PRIVATE_KEY_HEADER.test(decoded)) return { allowed: false };

  const text = redactLikelySecrets(sanitizeTerminalText(decoded));

  return {
    allowed: true,
    text,
    byteLength: new TextEncoder().encode(text).byteLength,
  };
}

function isBinaryMimeType(value: string): boolean {
  const mime = value.toLowerCase();
  return (
    mime.startsWith("audio/") ||
    mime.startsWith("font/") ||
    (mime.startsWith("image/") && mime !== "image/svg+xml") ||
    mime.startsWith("video/") ||
    mime === "application/octet-stream" ||
    mime === "application/pdf" ||
    mime === "application/zip"
  );
}

function isBlockedEntryName(lowerName: string): boolean {
  return (
    BLOCKED_DIRECTORY_NAMES.has(lowerName) ||
    BLOCKED_EXACT_FILE_NAMES.has(lowerName) ||
    ENV_FILE_NAME.test(lowerName) ||
    YARN_RC_FILE_NAME.test(lowerName) ||
    PRIVATE_KEY_EXTENSION.test(lowerName) ||
    SENSITIVE_NAME_TOKEN.test(lowerName)
  );
}

function isUnsafeTerminalCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x08 ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    codePoint === 0x2060 ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

function redactSecretLine(line: string): string {
  const separatorIndex = firstAssignmentSeparator(line);
  if (separatorIndex < 0) return line;

  const left = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1).trim();
  const key = left
    .replace(/^\s*export\s+/i, "")
    .replace(/["'\s]/g, "")
    .split(".")
    .at(-1) ?? "";

  if (!SECRET_KEY.test(key) || !value || SAFE_SECRET_VALUE.test(value)) {
    return line;
  }

  const trailingPunctuation = /[,;]\s*$/.exec(value)?.[0] ?? "";
  return `${line.slice(0, separatorIndex + 1)} [redacted]${trailingPunctuation}`;
}

function firstAssignmentSeparator(line: string): number {
  const equals = line.indexOf("=");
  const colon = line.indexOf(":");
  if (equals < 0) return colon;
  if (colon < 0) return equals;
  return Math.min(equals, colon);
}

function sanitizeEntryName(value: string): string {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029)
    ) {
      return "";
    }
  }
  return sanitizeTerminalText(value).replace(/[\\/]/g, "");
}

function sanitizeLabel(value: string): string {
  const label = sanitizeTerminalText(value)
    .replace(/[\\/]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return label.slice(0, 80) || "Selected folder";
}

function freezeSnapshot(snapshot: FolderSnapshot): FolderSnapshot {
  Object.freeze(snapshot.files);
  return Object.freeze(snapshot);
}

export const __fileSystemTesting = Object.freeze({
  useHandleStore(store: HandleStore): void {
    currentHandle = null;
    currentHandleRemembered = false;
    staleSavedHandle = false;
    handleStore = store;
  },
  reset(): void {
    currentHandle = null;
    currentHandleRemembered = false;
    staleSavedHandle = false;
    handleStore = indexedDbHandleStore;
    databasePromise = null;
  },
});
