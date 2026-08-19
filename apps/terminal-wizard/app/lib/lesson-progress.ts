import { commandMatches, type Lesson } from "@/app/data/lessons";
import type { Progress } from "@/app/lib/progress";

export type LessonCommandResult = Readonly<{
  lessonId: string;
  command: string;
  mode: "practice" | "live";
  status: "succeeded" | "failed" | "submitted";
  exitCode?: number;
}>;

export function recordLessonResult(
  progress: Progress,
  lesson: Lesson,
  result: LessonCommandResult,
): Progress {
  if (result.status !== "succeeded" || result.lessonId !== lesson.id) return progress;

  const existing = new Set(progress[lesson.id] ?? []);
  for (const lessonCommand of lesson.commands) {
    if (!commandMatches(result.command, lessonCommand, result.mode)) continue;
    existing.add(lessonCommand.id);
  }

  if (existing.size === (progress[lesson.id]?.length ?? 0)) return progress;
  return { ...progress, [lesson.id]: [...existing] };
}

export function isLessonComplete(
  progress: Progress,
  lesson: Lesson,
): boolean {
  const entries = progress[lesson.id] ?? [];
  return requiredLessonCommands(lesson).every((command) => entries.includes(command.id));
}

export function requiredLessonCommands(lesson: Lesson) {
  return lesson.commands.filter((command) => command.required !== false);
}
