// Line-editing behavior is adapted from @wterm/just-bash 0.3.3 (Apache-2.0).
import { Bash, type NetworkConfig } from "just-bash";

const graphemeSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

function graphemes(value: string): string[] {
  if (!graphemeSegmenter) return [...value];
  return [...graphemeSegmenter.segment(value)].map((entry) => entry.segment);
}

function graphemeWidth(value: string): number {
  if (!value || /^[\p{Mark}\p{Cf}]+$/u.test(value)) return 0;
  if (
    /\p{Extended_Pictographic}|\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|[\uFF01-\uFF60\uFFE0-\uFFE6]/u.test(value)
  ) return 2;
  return 1;
}

function terminalWidth(value: string): number {
  return graphemes(value).reduce((width, item) => width + graphemeWidth(item), 0);
}

function containsControl(value: string): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 0x1f || point === 0x7f;
  });
}

export type PracticeCommandResult = Readonly<{
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  cwdBefore: string;
  cwdAfter: string;
  lessonId: string | null;
}>;

export type PracticeShellOptions = {
  files?: Record<string, string>;
  env?: Record<string, string>;
  cwd?: string;
  greeting?: string | string[];
  prompt?: (cwd: string) => string;
  network?: NetworkConfig;
  getLessonId?: () => string;
  onCommandResult?: (result: PracticeCommandResult) => void;
};

const defaultPrompt = (cwd: string) => `\x1b[1;32mpractice\x1b[0m:\x1b[1;34m${cwd}\x1b[0m$ `;

/**
 * A result-aware wterm shell adapter.
 *
 * @wterm/just-bash currently executes each command a second time to discover
 * the resulting directory. just-bash already returns the final PWD, so this
 * adapter executes exactly once and reports the real exit status to lessons.
 */
export class PracticeShell {
  bash: Bash | null = null;
  cwd: string;

  private readonly files: Record<string, string>;
  private readonly environment: Record<string, string>;
  private readonly greeting: string[];
  private readonly prompt: (cwd: string) => string;
  private readonly network?: NetworkConfig;
  private readonly getLessonId?: () => string;
  private readonly onCommandResult?: (result: PracticeCommandResult) => void;
  private sessionEnvironment: Record<string, string>;
  private write: ((data: string) => void) | null = null;
  private line = "";
  private cursor = 0;
  private continuation = "";
  private history: string[] = [];
  private historyPosition = -1;
  private busy = false;
  private bracketedPaste: string | null = null;

  constructor(options: PracticeShellOptions = {}) {
    this.files = options.files ?? {};
    this.environment = options.env ?? { SHELL: "/bin/bash", TERM: "xterm-256color" };
    this.cwd = options.cwd ?? "/home/user";
    this.greeting = options.greeting === undefined
      ? []
      : typeof options.greeting === "string"
        ? [options.greeting]
        : options.greeting;
    this.prompt = options.prompt ?? defaultPrompt;
    this.network = options.network;
    this.getLessonId = options.getLessonId;
    this.onCommandResult = options.onCommandResult;
    this.sessionEnvironment = { ...this.environment };
  }

  async attach(write: (data: string) => void): Promise<void> {
    this.write = write;
    this.bash = new Bash({
      files: this.files,
      env: this.sessionEnvironment,
      network: this.network,
    });
    if (this.greeting.length) write(`${this.greeting.join("\r\n")}\r\n`);
    write(this.prompt(this.cwd));
  }

  async handleInput(data: string): Promise<void> {
    const write = this.write;
    if (!write || this.busy) return;

    const pasteStart = "\x1b[200~";
    const pasteEnd = "\x1b[201~";
    if (this.bracketedPaste !== null) {
      const endIndex = data.indexOf(pasteEnd);
      if (endIndex < 0) {
        this.bracketedPaste += data;
        return;
      }
      const pasted = `${this.bracketedPaste}${data.slice(0, endIndex)}`;
      this.bracketedPaste = null;
      this.insertText(pasted.replace(/[\r\n]+/g, " "));
      return;
    }
    if (data.startsWith(pasteStart)) {
      const remainder = data.slice(pasteStart.length);
      const endIndex = remainder.indexOf(pasteEnd);
      if (endIndex < 0) {
        this.bracketedPaste = remainder;
        return;
      }
      this.insertText(remainder.slice(0, endIndex).replace(/[\r\n]+/g, " "));
      return;
    }

    if (data === "\t") {
      await this.tabComplete();
      return;
    }
    if (data === "\r" || data === "\n") {
      await this.submitLine();
      return;
    }
    if (data === "\x7f" || data === "\b") {
      if (this.cursor <= 0) return;
      const items = graphemes(this.line);
      items.splice(this.cursor - 1, 1);
      this.cursor -= 1;
      this.redrawLine(items.join(""));
      return;
    }
    if (data === "\x1b[A" || data === "\x1b[B") {
      this.moveHistory(data === "\x1b[A" ? -1 : 1);
      return;
    }
    if (data === "\x1b[D" || data === "\x1b[C") {
      const direction = data === "\x1b[D" ? -1 : 1;
      const next = this.cursor + direction;
      if (next < 0 || next > graphemes(this.line).length) return;
      this.cursor = next;
      this.redrawLine();
      return;
    }
    if (["\x1b[H", "\x1bOH", "\x1b[F", "\x1bOF"].includes(data)) {
      this.cursor = data.endsWith("H") ? 0 : graphemes(this.line).length;
      this.redrawLine();
      return;
    }
    if (data === "\x1b[3~") {
      const items = graphemes(this.line);
      if (this.cursor >= items.length) return;
      items.splice(this.cursor, 1);
      this.redrawLine(items.join(""));
      return;
    }
    if (data.startsWith("\x1b")) return;
    if (data === "\x15" || data === "\x03") {
      if (data === "\x03") write("^C\r\n");
      this.line = "";
      this.cursor = 0;
      this.continuation = "";
      if (data === "\x03") write(this.prompt(this.cwd));
      else this.redrawLine();
      return;
    }
    if (data === "\x01" || data === "\x05") {
      const target = data === "\x01" ? 0 : graphemes(this.line).length;
      this.cursor = target;
      this.redrawLine();
      return;
    }
    if (data === "\x0c") {
      write("\x1b[2J\x1b[H");
      this.redrawLine();
      return;
    }
    const input = graphemes(data);
    if (input.length > 1) {
      for (const character of input) await this.handleInput(character);
      return;
    }
    const character = input[0] ?? "";
    if (!character || containsControl(character)) return;

    this.insertText(character);
  }

  private async submitLine(): Promise<void> {
    const write = this.write;
    if (!write) return;
    const current = this.line;
    this.line = "";
    this.cursor = 0;
    write("\r\n");

    if (current.endsWith("\\")) {
      this.continuation += `${current}\n`;
      write("> ");
      return;
    }

    const command = `${this.continuation}${current}`;
    this.continuation = "";
    if (!command.trim() || !this.bash) {
      write(this.prompt(this.cwd));
      return;
    }

    this.history.push(command);
    this.historyPosition = -1;
    this.busy = true;
    const cwdBefore = this.cwd;
    const lessonId = this.getLessonId?.() ?? null;
    try {
      const result = await this.bash.exec(command, {
        cwd: cwdBefore,
        env: this.sessionEnvironment,
        replaceEnv: true,
      });
      this.writeResult(result.stdout, result.stderr);
      this.sessionEnvironment = { ...result.env };
      const nextDirectory = result.env.PWD;
      if (nextDirectory?.startsWith("/")) this.cwd = nextDirectory;
      this.onCommandResult?.({
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        cwdBefore,
        cwdAfter: this.cwd,
        lessonId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown practice-shell error";
      this.writeResult("", `${message}\n`);
      this.onCommandResult?.({
        command,
        stdout: "",
        stderr: message,
        exitCode: 1,
        cwdBefore,
        cwdAfter: this.cwd,
        lessonId,
      });
    } finally {
      this.busy = false;
    }
    write(this.prompt(this.cwd));
  }

  private writeResult(stdout: string, stderr: string): void {
    const write = this.write;
    if (!write) return;
    if (stdout) {
      write(stdout.replace(/\n/g, "\r\n"));
      if (!stdout.endsWith("\n")) write("\r\n");
    }
    if (stderr) {
      write(`\x1b[31m${stderr.replace(/\n/g, "\r\n")}\x1b[0m`);
      if (!stderr.endsWith("\n")) write("\r\n");
    }
  }

  private moveHistory(direction: -1 | 1): void {
    const write = this.write;
    if (!write || !this.history.length) return;
    if (this.historyPosition < 0) this.historyPosition = this.history.length;
    this.historyPosition += direction;
    if (this.historyPosition >= this.history.length) {
      this.historyPosition = -1;
      this.line = "";
    } else {
      this.historyPosition = Math.max(0, this.historyPosition);
      this.line = this.history[this.historyPosition] ?? "";
    }
    this.cursor = graphemes(this.line).length;
    this.redrawLine();
  }

  private async tabComplete(): Promise<void> {
    const bash = this.bash;
    const write = this.write;
    if (!bash || !write) return;
    const beforeCursor = graphemes(this.line).slice(0, this.cursor).join("");
    const parts = beforeCursor.split(/\s+/);
    const word = parts.at(-1) ?? "";
    const slash = word.lastIndexOf("/");
    const prefix = slash >= 0 ? word.slice(slash + 1) : word;
    const rawDirectory = slash >= 0 ? word.slice(0, slash + 1) : "";
    const home = this.sessionEnvironment.HOME ?? "/home/user";
    const directory = rawDirectory.startsWith("/")
      ? rawDirectory
      : rawDirectory.startsWith("~/")
        ? `${home}/${rawDirectory.slice(2)}`
        : `${this.cwd}/${rawDirectory}`;

    try {
      const result = await bash.exec(`ls -1a ${JSON.stringify(directory)}`, { cwd: this.cwd });
      const candidates = result.stdout
        .split("\n")
        .filter((entry) => entry && entry !== "." && entry !== ".." && entry.startsWith(prefix));
      if (!candidates.length) return;

      let common = candidates[0];
      for (const candidate of candidates.slice(1)) {
        while (common && !candidate.startsWith(common)) common = common.slice(0, -1);
      }
      const completion = common.slice(prefix.length);
      if (completion) {
        const items = graphemes(this.line);
        const completionItems = graphemes(completion);
        items.splice(this.cursor, 0, ...completionItems);
        this.cursor += completionItems.length;
        this.redrawLine(items.join(""));
        return;
      }
      write(`\r\n${candidates.join("  ")}\r\n`);
      this.redrawLine();
    } catch {
      // Completion is a convenience; an unreadable directory should not alter input.
    }
  }

  private redrawLine(nextLine = this.line): void {
    const write = this.write;
    if (!write) return;
    this.line = nextLine;
    const items = graphemes(this.line);
    this.cursor = Math.min(this.cursor, items.length);
    write(`\r${this.prompt(this.cwd)}${this.line}\x1b[K`);
    const tailWidth = terminalWidth(items.slice(this.cursor).join(""));
    if (tailWidth > 0) write(`\x1b[${tailWidth}D`);
  }

  private insertText(value: string): void {
    const inserted = graphemes(value).filter(
      (character) => !containsControl(character),
    );
    if (!inserted.length) return;
    const items = graphemes(this.line);
    items.splice(this.cursor, 0, ...inserted);
    this.cursor += inserted.length;
    this.redrawLine(items.join(""));
  }
}
