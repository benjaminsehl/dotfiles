import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  __fileSystemTesting,
  connectFolder,
  FILE_SYSTEM_LIMITS,
  forgetFolder,
  isBlockedWorkspacePath,
  isTextFileName,
  reconnectFolder,
  redactLikelySecrets,
  restoreFolder,
  sanitizeTerminalText,
  supportsFileSystemAccess,
} from "../app/lib/file-system";

type FakeEntry = FakeDirectory | FakeTextFile;

class FakeTextFile {
  readonly kind = "file" as const;

  constructor(
    readonly name: string,
    private readonly contents: string | Uint8Array,
    private readonly type = "text/plain",
  ) {}

  async getFile(): Promise<File> {
    const contents =
      typeof this.contents === "string"
        ? this.contents
        : (Uint8Array.from(this.contents).buffer as ArrayBuffer);
    return new File([contents], this.name, { type: this.type });
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === (this as unknown as FileSystemHandle);
  }
}

class FakeDirectory {
  readonly kind = "directory" as const;
  queryModes: string[] = [];
  requestModes: string[] = [];

  constructor(
    readonly name: string,
    readonly children: FakeEntry[] = [],
    public permission: PermissionState = "granted",
  ) {}

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const child of this.children) {
      yield [child.name, child as unknown as FileSystemHandle];
    }
  }

  async queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState> {
    this.queryModes.push(descriptor?.mode ?? "read");
    return this.permission;
  }

  async requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState> {
    this.requestModes.push(descriptor?.mode ?? "read");
    this.permission = "granted";
    return this.permission;
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === (this as unknown as FileSystemHandle);
  }
}

class MemoryHandleStore {
  value: FileSystemDirectoryHandle | null = null;
  deletes = 0;

  async get(): Promise<FileSystemDirectoryHandle | null> {
    return this.value;
  }

  async put(handle: FileSystemDirectoryHandle): Promise<void> {
    this.value = handle;
  }

  async delete(): Promise<void> {
    this.value = null;
    this.deletes += 1;
  }
}

afterEach(() => {
  __fileSystemTesting.reset();
  Reflect.deleteProperty(globalThis, "window");
});

test("sanitizes terminal controls and likely secret assignments", () => {
  assert.equal(
    sanitizeTerminalText("hello\r\n\u001b]52;c;payload\u0007world\u202E"),
    "hello\n]52;c;payloadworld",
  );
  assert.equal(
    redactLikelySecrets(
      "export GITHUB_TOKEN=ghp_real\nsecrets.enabled=true\nAPI_KEY=${API_KEY}\nauthToken=real\nbearer: real\nclient_secret = real\n",
    ),
    "export GITHUB_TOKEN= [redacted]\nsecrets.enabled=true\nAPI_KEY=${API_KEY}\nauthToken= [redacted]\nbearer: [redacted]\nclient_secret = [redacted]\n",
  );
});

test("applies conservative path and text-file policy", () => {
  for (const blocked of [
    "/workspace/.env",
    "/workspace/.env.local",
    "/workspace/.envrc",
    "/workspace/.npmrc",
    "/workspace/.pypirc",
    "/workspace/.git-credentials",
    "/workspace/.yarnrc.yml",
    "/workspace/.ssh/config",
    "/workspace/.gnupg/pubring.kbx",
    "/workspace/.aws/credentials",
    "/workspace/.azure/config",
    "/workspace/.docker/config.json",
    "/workspace/.git/config",
    "/workspace/.kube/config",
    "/workspace/.config/gh/hosts.yml",
    "/workspace/.cargo/credentials.toml",
    "/workspace/node_modules/pkg/index.js",
    "/workspace/authtoken.txt",
    "/workspace/bearer.txt",
    "/workspace/client_secret.txt",
    "/workspace/credentials.json",
    "/workspace/github-token.txt",
    "/workspace/private-key.pem",
    "/workspace/id_ed25519",
  ]) {
    assert.equal(isBlockedWorkspacePath(blocked), true, blocked);
  }

  assert.equal(isBlockedWorkspacePath("/workspace/src/tokenizer.ts"), false);
  assert.equal(isTextFileName(".zshrc"), true);
  assert.equal(isTextFileName("config.ghostty"), true);
  assert.equal(isTextFileName("component.tsx"), true);
  assert.equal(isTextFileName("image.png"), false);
  assert.equal(isTextFileName("archive.zip"), false);
  assert.equal(isTextFileName("unknown.custom-binary"), false);
});

test("connectFolder invokes a read-only picker immediately and returns DTOs", async () => {
  const store = new MemoryHandleStore();
  __fileSystemTesting.useHandleStore(store);

  const folder = new FakeDirectory("demo\u001b-project", [
    new FakeTextFile(
      "README.md",
      "# Demo\n\u001b[31mred\u001b[0m\nTOKEN=actual-value\n",
    ),
    new FakeTextFile(".env", "SECRET=hidden\n"),
    new FakeTextFile("photo.png", new Uint8Array([0, 1, 2]), "image/png"),
  ]);
  let pickerCalled = false;
  let pickerOptions: DirectoryPickerOptions | undefined;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      isSecureContext: true,
      showDirectoryPicker(options?: DirectoryPickerOptions) {
        pickerCalled = true;
        pickerOptions = options;
        return Promise.resolve(folder as unknown as FileSystemDirectoryHandle);
      },
    },
  });

  assert.equal(supportsFileSystemAccess(), true);
  const pending = connectFolder();
  assert.equal(pickerCalled, true, "picker must run before connectFolder returns");
  assert.deepEqual(pickerOptions, {
    id: "terminal-wizard-workspace",
    mode: "read",
  });

  const snapshot = await pending;
  assert.equal(snapshot.label, "demo-project");
  assert.equal(snapshot.permission, "granted");
  assert.equal(snapshot.fileCount, 1);
  assert.equal(snapshot.blockedCount, 2);
  assert.deepEqual(Object.keys(snapshot.files), ["/workspace/README.md"]);
  assert.equal(
    snapshot.files["/workspace/README.md"],
    "# Demo\n[31mred[0m\nTOKEN= [redacted]\n",
  );
  assert.equal(store.value, folder);
  assert.deepEqual(folder.queryModes, ["read"]);
  assert.equal("entries" in snapshot.files, false);
});

test("restore queries permission and reconnect requests read permission directly", async () => {
  const store = new MemoryHandleStore();
  const folder = new FakeDirectory(
    "project",
    [new FakeTextFile("notes.md", "safe\n")],
    "prompt",
  );
  store.value = folder as unknown as FileSystemDirectoryHandle;
  __fileSystemTesting.useHandleStore(store);

  const restored = await restoreFolder();
  assert.ok(restored);
  assert.equal(restored.permission, "prompt");
  assert.deepEqual(restored.files, {});
  assert.deepEqual(folder.queryModes, ["read"]);

  const pending = reconnectFolder();
  assert.deepEqual(
    folder.requestModes,
    ["read"],
    "permission request must happen before reconnectFolder returns",
  );
  const reconnected = await pending;
  assert.equal(reconnected.permission, "granted");
  assert.deepEqual(reconnected.files, { "/workspace/notes.md": "safe\n" });
});

test("enforces depth, entry, binary, and file-size limits", async () => {
  const privateKeyHeader = ["-----BEGIN OPENSSH ", "PRIVATE KEY-----"].join("");
  const tooLarge = "x".repeat(FILE_SYSTEM_LIMITS.maxFileBytes + 1);
  const tooDeep = new FakeDirectory("one", [
    new FakeDirectory("two", [
      new FakeDirectory("three", [
        new FakeDirectory("four", [
          new FakeTextFile("five.md", "not visible"),
        ]),
      ]),
    ]),
  ]);
  const manyFiles = Array.from(
    { length: FILE_SYSTEM_LIMITS.maxEntries + 20 },
    (_, index) => new FakeTextFile(`file-${index}.txt`, `${index}`),
  );
  const folder = new FakeDirectory("limits", [
    new FakeTextFile("large.txt", tooLarge),
    new FakeTextFile("bad.txt", new Uint8Array([65, 0, 66])),
    new FakeTextFile(
      "pem-example.md",
      `${privateKeyHeader}\nsecret\n-----END OPENSSH PRIVATE KEY-----\n`,
    ),
    tooDeep,
    ...manyFiles,
  ]);
  const store = new MemoryHandleStore();
  store.value = folder as unknown as FileSystemDirectoryHandle;
  __fileSystemTesting.useHandleStore(store);

  const snapshot = await restoreFolder();
  assert.ok(snapshot);
  assert.equal(snapshot.truncated, true);
  assert.ok(snapshot.fileCount < FILE_SYSTEM_LIMITS.maxEntries);
  assert.equal("/workspace/one/two/three/four/five.md" in snapshot.files, false);
  assert.equal("/workspace/large.txt" in snapshot.files, false);
  assert.equal("/workspace/bad.txt" in snapshot.files, false);
  assert.equal("/workspace/pem-example.md" in snapshot.files, false);
  assert.ok(snapshot.blockedCount >= 4);
});

test("caps aggregate decoded snapshot content at eight MiB", async () => {
  const fullFile = "x".repeat(FILE_SYSTEM_LIMITS.maxFileBytes);
  const fileCount =
    FILE_SYSTEM_LIMITS.maxSnapshotBytes / FILE_SYSTEM_LIMITS.maxFileBytes + 1;
  const folder = new FakeDirectory(
    "aggregate-limit",
    Array.from(
      { length: fileCount },
      (_, index) => new FakeTextFile(`chunk-${index}.txt`, fullFile),
    ),
  );
  const store = new MemoryHandleStore();
  store.value = folder as unknown as FileSystemDirectoryHandle;
  __fileSystemTesting.useHandleStore(store);

  const snapshot = await restoreFolder();
  assert.ok(snapshot);
  assert.equal(snapshot.fileCount, fileCount - 1);
  assert.equal(snapshot.blockedCount, 1);
  assert.equal(snapshot.truncated, true);
  const decodedBytes = Object.values(snapshot.files).reduce(
    (sum, value) => sum + new TextEncoder().encode(value).byteLength,
    0,
  );
  assert.equal(decodedBytes, FILE_SYSTEM_LIMITS.maxSnapshotBytes);
});

test("forgetFolder removes persisted capability state", async () => {
  const store = new MemoryHandleStore();
  store.value = new FakeDirectory(
    "project",
  ) as unknown as FileSystemDirectoryHandle;
  __fileSystemTesting.useHandleStore(store);

  await restoreFolder();
  await forgetFolder();
  assert.equal(store.value, null);
  assert.equal(store.deletes, 1);
  assert.equal(await restoreFolder(), null);
});
