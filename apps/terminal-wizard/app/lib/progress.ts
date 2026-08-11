export const PROGRESS_STORAGE_KEY = "terminal-wizard.progress.v1";

export type Progress = Record<string, string[]>;

export type ProgressStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

const MAX_LESSONS = 100;
const MAX_ENTRIES_PER_LESSON = 100;
const VALID_LESSON_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const VALID_PROGRESS_ENTRY = /^(?:__complete__|0|[1-9]\d{0,2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeProgress(value: unknown): Progress {
  if (!isRecord(value)) return {};

  const progress: Progress = {};
  for (const [lessonId, rawEntries] of Object.entries(value).slice(0, MAX_LESSONS)) {
    if (!VALID_LESSON_ID.test(lessonId) || !Array.isArray(rawEntries)) continue;
    const entries = [
      ...new Set(
        rawEntries.filter(
          (entry): entry is string =>
            typeof entry === "string" && VALID_PROGRESS_ENTRY.test(entry),
        ),
      ),
    ].slice(0, MAX_ENTRIES_PER_LESSON);
    if (entries.length > 0) progress[lessonId] = entries;
  }
  return progress;
}

export function readProgress(storage: ProgressStorage): Progress {
  try {
    const raw = storage.getItem(PROGRESS_STORAGE_KEY);
    return normalizeProgress(raw === null ? {} : JSON.parse(raw));
  } catch {
    return {};
  }
}

export function persistProgress(
  storage: ProgressStorage,
  progress: Progress,
): void {
  storage.setItem(
    PROGRESS_STORAGE_KEY,
    JSON.stringify(normalizeProgress(progress)),
  );
}

export function clearProgress(storage: ProgressStorage): void {
  storage.removeItem(PROGRESS_STORAGE_KEY);
}
