import assert from "node:assert/strict";
import test from "node:test";
import {
  clearProgress,
  normalizeProgress,
  persistProgress,
  PROGRESS_STORAGE_KEY,
  readProgress,
  type ProgressStorage,
} from "../app/lib/progress";

class MemoryStorage implements ProgressStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("normalizes persisted lesson progress conservatively", () => {
  assert.deepEqual(
    normalizeProgress({
      orientation: ["step-alpha", "step-alpha", "step-beta", "__complete__", 3, "1000"],
      search: "not-an-array",
      "../prototype": ["0"],
      __proto__: ["0"],
    }),
    {
      orientation: ["step-alpha", "step-beta"],
    },
  );
  assert.deepEqual(normalizeProgress(null), {});
  assert.deepEqual(normalizeProgress([]), {});
});

test("round-trips and clears browser progress persistence", () => {
  const storage = new MemoryStorage();
  storage.values.set("terminal-wizard.progress.v1", JSON.stringify({ orientation: ["5"] }));
  storage.values.set("terminal-wizard.progress.v2", JSON.stringify({ orientation: ["0"] }));
  persistProgress(storage, {
    orientation: ["step-alpha", "step-beta"],
    git: ["step-gamma", "step-delta"],
  });

  assert.deepEqual(readProgress(storage), {
    orientation: ["step-alpha", "step-beta"],
    git: ["step-gamma", "step-delta"],
  });
  assert.ok(storage.values.has(PROGRESS_STORAGE_KEY));
  assert.equal(storage.values.has("terminal-wizard.progress.v1"), false);
  assert.equal(storage.values.has("terminal-wizard.progress.v2"), false);

  clearProgress(storage);
  assert.equal(storage.values.has(PROGRESS_STORAGE_KEY), false);
  assert.equal(storage.values.has("terminal-wizard.progress.v1"), false);
  assert.equal(storage.values.has("terminal-wizard.progress.v2"), false);
  assert.deepEqual(readProgress(storage), {});
});

test("fails closed when persisted progress is malformed", () => {
  const storage = new MemoryStorage();
  storage.values.set(PROGRESS_STORAGE_KEY, "{broken-json");
  assert.deepEqual(readProgress(storage), {});
});
