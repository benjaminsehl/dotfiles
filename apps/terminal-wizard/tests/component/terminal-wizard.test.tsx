import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fileSystem = vi.hoisted(() => ({
  supportsFileSystemAccess: vi.fn(),
  connectFolder: vi.fn(),
  restoreFolder: vi.fn(),
  reconnectFolder: vi.fn(),
  forgetFolder: vi.fn(),
}));

const terminal = vi.hoisted(() => ({
  insertCommand: vi.fn(),
  focus: vi.fn(),
  mounts: 0,
  pairing: null as null | {
    version: 1;
    instanceId: string;
    pairingSecret: string;
  },
  consumePairing: undefined as undefined | (() => void),
}));

const liveOrigin = vi.hoisted(() => ({
  consumeLiveMacAccess: vi.fn(),
}));

vi.mock("@/app/lib/file-system", () => fileSystem);
vi.mock("@/app/lib/live-origin", () => liveOrigin);

vi.mock("@/app/components/WizardTerminal", async () => {
  const ReactModule = await import("react");
  return {
    WizardTerminal: ReactModule.forwardRef(function FakeTerminal(
      props: {
        lessonId: string;
        mode: "practice" | "live";
        pairing?: {
          version: 1;
          instanceId: string;
          pairingSecret: string;
        } | null;
        files?: Record<string, string>;
        onPairingConsumed?(): void;
        onCommand(result: {
          lessonId: string;
          command: string;
          mode: "practice" | "live";
          status: "succeeded" | "failed" | "submitted";
          exitCode?: number;
        }): void;
      },
      ref,
    ) {
      terminal.pairing = props.pairing ?? null;
      terminal.consumePairing = props.onPairingConsumed;
      const [instance] = ReactModule.useState(() => {
        terminal.mounts += 1;
        return terminal.mounts;
      });
      ReactModule.useImperativeHandle(ref, () => ({
        insertCommand: terminal.insertCommand,
        focus: terminal.focus,
      }));
      return (
        <div
          data-testid="fake-terminal"
          data-instance={instance}
          data-lesson-id={props.lessonId}
          data-mode={props.mode}
          data-files={Object.keys(props.files ?? {}).sort().join(",")}
        >
          <button
            type="button"
            onClick={() => props.onCommand({
              lessonId: props.lessonId,
              command: "pwd",
              mode: "practice",
              status: "succeeded",
              exitCode: 0,
            })}
          >
            emit pwd success
          </button>
          <button
            type="button"
            onClick={() => props.onCommand({
              lessonId: props.lessonId,
              command: "pwd",
              mode: "practice",
              status: "failed",
              exitCode: 1,
            })}
          >
            emit pwd failure
          </button>
          <button
            type="button"
            onClick={() => props.onCommand({
              lessonId: "maintenance",
              command: "dev-doctor",
              mode: "practice",
              status: "succeeded",
              exitCode: 0,
            })}
          >
            emit delayed maintenance result
          </button>
        </div>
      );
    }),
  };
});

import { TerminalWizard } from "@/app/components/TerminalWizard";

type Snapshot = {
  label: string;
  permission: "granted" | "prompt" | "denied";
  remembered: boolean;
  staleSavedHandle: boolean;
  files: Record<string, string>;
  fileCount: number;
  blockedCount: number;
  truncated: boolean;
};

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    label: "dotfiles",
    permission: "granted",
    remembered: true,
    staleSavedHandle: false,
    files: { "/workspace/README.md": "safe\n" },
    fileCount: 1,
    blockedCount: 0,
    truncated: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const hostedPairing = Object.freeze({
  version: 1 as const,
  instanceId: "a".repeat(22),
  pairingSecret: "b".repeat(43),
});

async function waitForHydration() {
  await screen.findByLabelText("0 of 10 lessons complete");
  return screen.findByRole("button", { name: /^Practice files: (?!checking folder access)/ });
}

async function openFolderDialog(
  user: ReturnType<typeof userEvent.setup>,
) {
  const trigger = await screen.findByRole("button", { name: /^Practice files:/ });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Practice files" });
  return { dialog, trigger };
}

async function openLessonDialog(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole("button", { name: "Choose lesson" });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Jump to a lesson" });
  return { dialog, trigger };
}

beforeEach(() => {
  window.localStorage.clear();
  terminal.insertCommand.mockReset();
  terminal.focus.mockReset();
  terminal.mounts = 0;
  terminal.pairing = null;
  terminal.consumePairing = undefined;
  liveOrigin.consumeLiveMacAccess.mockReturnValue({ kind: "local", pairing: null });
  fileSystem.supportsFileSystemAccess.mockReturnValue(true);
  fileSystem.restoreFolder.mockResolvedValue(null);
  fileSystem.connectFolder.mockResolvedValue(snapshot());
  fileSystem.reconnectFolder.mockResolvedValue(snapshot());
  fileSystem.forgetFolder.mockResolvedValue(undefined);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Terminal Tutor client journey", () => {
  it("keeps product identity and lesson navigation in one banner", async () => {
    render(<TerminalWizard />);
    await waitForHydration();

    const banner = screen.getByRole("banner", { name: "Terminal Tutor controls" });
    expect(within(banner).getByLabelText("Terminal Tutor")).toBeTruthy();
    expect(within(banner).getByRole("navigation", { name: "Lesson navigation" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
  });

  it("explains the Practice model and changes the credit badge in Live mode", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    expect(screen.getByText("Practice models the declared setup; Live verifies this Mac.")).toBeTruthy();
    expect(screen.getByText("Practice model · earns credit")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Live Mac" }));
    await user.type(screen.getByLabelText(/Type LIVE/), "LIVE");
    await user.click(screen.getByRole("button", { name: "Open Live Mac" }));

    expect(screen.getByText("Live mode · no course credit")).toBeTruthy();
  });

  it("gives Chrome recovery guidance when File System Access is unavailable", async () => {
    fileSystem.supportsFileSystemAccess.mockReturnValue(false);
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    const { dialog } = await openFolderDialog(user);
    expect(within(dialog).getByText(/require Chrome’s File System Access API/)).toBeTruthy();
    expect(within(dialog).getByText(/restart or update Chrome/)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Folder access unavailable" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not let a late restore overwrite a newer folder choice", async () => {
    const restore = deferred<Snapshot | null>();
    fileSystem.restoreFolder.mockReturnValue(restore.promise);
    fileSystem.connectFolder.mockResolvedValue(snapshot({ label: "new-project" }));
    const user = userEvent.setup();
    render(<TerminalWizard />);

    await waitForHydration();
    const { dialog } = await openFolderDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Choose project folder" }));
    await within(dialog).findByText(/new-project/);
    restore.resolve(snapshot({ label: "old-project" }));

    await waitFor(() => expect(screen.queryByText(/old-project/)).toBeNull());
    expect(within(dialog).getByText(/new-project/)).toBeTruthy();
  });

  it.each([
    {
      outcome: "picker cancellation",
      error: new DOMException("Picker cancelled.", "AbortError"),
      message: null,
    },
    {
      outcome: "picker failure",
      error: new Error("The picker failed before selecting a folder."),
      message: /picker failed before selecting a folder/i,
    },
  ])("keeps a deferred restore after $outcome", async ({ error, message }) => {
    const restore = deferred<Snapshot | null>();
    const choose = deferred<Snapshot>();
    fileSystem.restoreFolder.mockReturnValue(restore.promise);
    fileSystem.connectFolder.mockReturnValue(choose.promise);
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");

    const { dialog } = await openFolderDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Choose project folder" }));
    restore.resolve(snapshot({
      label: "saved-project",
      files: { "/workspace/saved.md": "saved\n" },
    }));
    choose.reject(error);

    await within(dialog).findByText(/saved-project/);
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("/workspace/saved.md");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).not.toBe(firstInstance);
    if (message) {
      expect(await within(dialog).findByText(message)).toBeTruthy();
    } else {
      expect(screen.queryByText(/Picker cancelled/)).toBeNull();
    }
  });

  it("remounts the terminal when a granted folder restore finishes", async () => {
    const restore = deferred<Snapshot | null>();
    fileSystem.restoreFolder.mockReturnValue(restore.promise);
    render(<TerminalWizard />);
    await waitForHydration();
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");

    restore.resolve(snapshot({
      label: "restored-project",
      files: { "/workspace/restored.md": "restored\n" },
    }));

    await screen.findByRole("button", { name: /^Practice files: restored-project,/ });
    await waitFor(() => {
      expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).not.toBe(firstInstance);
    });
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("/workspace/restored.md");
  });

  it("keeps permission-gated files out of the terminal", async () => {
    fileSystem.restoreFolder.mockResolvedValue(snapshot({
      permission: "prompt",
      files: { "/workspace/should-not-mount.txt": "private\n" },
    }));
    const user = userEvent.setup();
    render(<TerminalWizard />);
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");
    await waitFor(() => {
      expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).not.toBe(firstInstance);
    });

    const { dialog } = await openFolderDialog(user);
    expect(within(dialog).getByRole("button", { name: "Reconnect folder" })).toBeTruthy();
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("");
  });

  it("locks Forget while refresh is pending and replaces the snapshot once", async () => {
    const refresh = deferred<Snapshot>();
    fileSystem.restoreFolder.mockResolvedValue(snapshot());
    fileSystem.reconnectFolder.mockReturnValue(refresh.promise);
    const user = userEvent.setup();
    render(<TerminalWizard />);

    await screen.findByRole("button", { name: /^Practice files: dotfiles,/ });
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");
    const { dialog } = await openFolderDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Refresh Practice snapshot" }));
    expect((within(dialog).getByRole("button", { name: "Forget folder" }) as HTMLButtonElement).disabled).toBe(true);
    refresh.resolve(snapshot({
      label: "refreshed-project",
      files: { "/workspace/new.md": "fresh\n" },
    }));

    await within(dialog).findByText(/refreshed-project/);
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("/workspace/new.md");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).not.toBe(firstInstance);
  });

  it.each([
    ["prompt", /Folder permission is still required/],
    ["denied", /Folder access remains denied/],
  ] as const)("does not describe a %s reconnect as a refreshed snapshot", async (permission, message) => {
    fileSystem.restoreFolder.mockResolvedValue(snapshot({ permission: "prompt", files: {} }));
    fileSystem.reconnectFolder.mockResolvedValue(snapshot({
      permission,
      files: { "/workspace/should-not-mount.txt": "private\n" },
      fileCount: 0,
    }));
    const user = userEvent.setup();
    render(<TerminalWizard />);
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");
    await waitFor(() => {
      expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).not.toBe(firstInstance);
    });

    const { dialog } = await openFolderDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Reconnect folder" }));

    await within(dialog).findByText(message);
    expect(within(dialog).queryByText(/Snapshot refreshed/)).toBeNull();
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("");
    expect(within(dialog).getByRole("button", { name: "Reconnect folder" })).toBeTruthy();
  });

  it("forgets the mounted snapshot and remounts an empty terminal", async () => {
    fileSystem.restoreFolder.mockResolvedValue(snapshot({
      files: { "/workspace/forget-me.md": "temporary\n" },
    }));
    const user = userEvent.setup();
    render(<TerminalWizard />);

    await screen.findByRole("button", { name: /^Practice files: dotfiles,/ });
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("/workspace/forget-me.md");
    const { dialog } = await openFolderDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Forget folder" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Practice files" })).toBeNull());
    const reopened = await openFolderDialog(user);
    await within(reopened.dialog).findByRole("button", { name: "Choose project folder" });
    expect(within(reopened.dialog).getByText(/Folder forgotten here/)).toBeTruthy();
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).not.toBe(firstInstance);
  });

  it("retains the mounted snapshot and warns when Forget fails", async () => {
    fileSystem.restoreFolder.mockResolvedValue(snapshot({
      files: { "/workspace/retained.md": "retained\n" },
    }));
    fileSystem.forgetFolder.mockRejectedValue(new Error("IndexedDB unavailable"));
    const user = userEvent.setup();
    render(<TerminalWizard />);

    await screen.findByRole("button", { name: /^Practice files: dotfiles,/ });
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");
    const { dialog } = await openFolderDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Forget folder" }));

    await within(dialog).findByText(/could not forget the saved folder/);
    expect(within(dialog).getByText(/dotfiles/)).toBeTruthy();
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("/workspace/retained.md");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).toBe(firstInstance);
    expect((within(dialog).getByRole("button", { name: "Forget folder" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    {
      state: "session-only",
      overrides: { remembered: false },
      message: /could not remember this folder.*page reloads or closes/i,
    },
    {
      state: "stale saved handle",
      overrides: { remembered: false, staleSavedHandle: true },
      message: /could not clear an older saved folder/i,
    },
    {
      state: "truncated snapshot",
      overrides: { truncated: true },
      message: /reached a safety limit/i,
    },
  ])("shows the $state disclosure", async ({ overrides, message }) => {
    fileSystem.restoreFolder.mockResolvedValue(snapshot(overrides));
    const user = userEvent.setup();
    render(<TerminalWizard />);

    await screen.findByRole("button", { name: /^Practice files: dotfiles,/ });
    const { dialog } = await openFolderDialog(user);
    expect(await within(dialog).findByText(message)).toBeTruthy();
  });

  it("opens each compact dialog and restores trigger focus on Escape", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    expect(screen.getAllByRole("button", { name: "Choose lesson" })).toHaveLength(1);
    const lesson = await openLessonDialog(user);
    expect(lesson.trigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(lesson.dialog).getByRole("button", { name: /Know what is actually running/ }).getAttribute("aria-current")).toBe("step");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Jump to a lesson" })).toBeNull());
    expect(lesson.trigger.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(lesson.trigger));

    const folder = await openFolderDialog(user);
    expect(folder.trigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(folder.dialog).getByRole("button", { name: "Choose project folder" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Practice files" })).toBeNull());
    expect(folder.trigger.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(folder.trigger));
  });

  it("selects lessons from the picker", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    const { dialog } = await openLessonDialog(user);
    const course = within(dialog).getByRole("navigation", { name: "Course lessons" });
    expect(within(course).getAllByRole("button")).toHaveLength(10);
    await user.click(within(dialog).getByRole("button", { name: /Practice on a real project, safely/ }));

    await screen.findByRole("heading", { level: 1, name: "Practice on a real project, safely" });
    expect(screen.queryByRole("dialog", { name: "Jump to a lesson" })).toBeNull();
    expect(screen.getByTestId("fake-terminal").getAttribute("data-lesson-id")).toBe("real-work");
    expect(screen.getByLabelText("Current lesson: Practice on a real project, safely")).toBeTruthy();
  });

  it("moves through lessons with Previous and Next and respects boundaries", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    const previous = screen.getByRole("button", { name: /^Previous lesson/ }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: /^Next lesson/ }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    expect(screen.getByTestId("fake-terminal").getAttribute("data-lesson-id")).toBe("orientation");
    const terminalInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");

    await user.click(next);
    await screen.findByRole("heading", { level: 1, name: "Navigate at thought speed" });
    expect(previous.disabled).toBe(false);
    expect(screen.getByTestId("fake-terminal").getAttribute("data-lesson-id")).toBe("navigation");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).toBe(terminalInstance);

    const { dialog } = await openLessonDialog(user);
    await user.click(within(dialog).getByRole("button", { name: /Practice the branch-to-PR rhythm/ }));
    await screen.findByRole("heading", { level: 1, name: "Practice the branch-to-PR rhythm" });
    expect(next.disabled).toBe(true);
    expect(previous.disabled).toBe(false);
    expect(screen.getByTestId("fake-terminal").getAttribute("data-lesson-id")).toBe("checkpoint-lab");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).toBe(terminalInstance);
  });

  it("switches mobile panes without remounting and exposes terminal mode state", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();
    const terminalInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");
    const lessonPane = screen.getByRole("button", { name: "Lesson" });
    const terminalPane = screen.getByRole("button", { name: "Terminal" });
    const practice = screen.getByRole("button", { name: "Practice" });
    const live = screen.getByRole("button", { name: "Live Mac" });

    expect(lessonPane.getAttribute("aria-pressed")).toBe("true");
    expect(terminalPane.getAttribute("aria-pressed")).toBe("false");
    expect(practice.getAttribute("aria-pressed")).toBe("true");
    expect(live.getAttribute("aria-pressed")).toBe("false");

    await user.click(terminalPane);
    expect(lessonPane.getAttribute("aria-pressed")).toBe("false");
    expect(terminalPane.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).toBe(terminalInstance);
  });

  it("requires fresh exact Live consent and remounts on each mode change", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");

    await user.click(screen.getByRole("button", { name: /Live Mac/ }));
    const input = screen.getByLabelText(/Type LIVE/);
    await user.type(input, "LIVE");
    await user.click(screen.getByRole("button", { name: "Stay in Practice" }));
    await user.click(screen.getByRole("button", { name: /Live Mac/ }));
    expect((screen.getByRole("button", { name: "Open Live Mac" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Type LIVE/) as HTMLInputElement).value).toBe("");

    await user.type(screen.getByLabelText(/Type LIVE/), "live");
    expect((screen.getByRole("button", { name: "Open Live Mac" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByLabelText(/Type LIVE/));
    await user.type(screen.getByLabelText(/Type LIVE/), "LIVE");
    await user.click(screen.getByRole("button", { name: "Open Live Mac" }));
    expect(screen.getByTestId("fake-terminal").getAttribute("data-mode")).toBe("live");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).not.toBe(firstInstance);
  });

  it("traps Tab focus in the Live warning and restores the Live trigger on Escape", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    const live = screen.getByRole("button", { name: "Live Mac" });
    await user.click(live);
    const dialog = screen.getByRole("dialog", { name: "Live Mac can change your computer." });
    const close = within(dialog).getByRole("button", { name: "Close Live Mac warning" });
    const input = within(dialog).getByLabelText(/Type LIVE/);
    const stay = within(dialog).getByRole("button", { name: "Stay in Practice" });
    await waitFor(() => expect(document.activeElement).toBe(input));

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(stay);
    await user.tab();
    expect(document.activeElement).toBe(close);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Live Mac can change your computer." })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(live));
  });

  it("keeps a hosted pairing inert and requires fresh consent again after cancel", async () => {
    liveOrigin.consumeLiveMacAccess.mockReturnValue({ kind: "hosted", pairing: hostedPairing });
    const loopbackFetch = vi.fn();
    vi.stubGlobal("fetch", loopbackFetch);
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    expect(terminal.pairing).toBeNull();
    expect(screen.getByTestId("fake-terminal").getAttribute("data-mode")).toBe("practice");
    await user.click(screen.getByRole("button", { name: "Live Mac" }));
    expect(screen.getByText(/Terminal traffic stays between this browser and your Mac/)).toBeTruthy();
    expect(screen.getByText(/Chrome will ask for Local Network Access/)).toBeTruthy();
    await user.type(screen.getByLabelText(/Type LIVE/), "LIVE");
    await user.click(screen.getByRole("button", { name: "Stay in Practice" }));

    expect(loopbackFetch).not.toHaveBeenCalled();
    expect(terminal.pairing).toBeNull();
    expect(screen.getByTestId("fake-terminal").getAttribute("data-mode")).toBe("practice");

    await user.click(screen.getByRole("button", { name: "Live Mac" }));
    expect((screen.getByLabelText(/Type LIVE/) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Open Live Mac" }) as HTMLButtonElement).disabled).toBe(true);
    expect(loopbackFetch).not.toHaveBeenCalled();
  });

  it("passes a hosted pairing only after exact consent and spends it for the page", async () => {
    liveOrigin.consumeLiveMacAccess.mockReturnValue({ kind: "hosted", pairing: hostedPairing });
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    await user.click(screen.getByRole("button", { name: "Live Mac" }));
    await user.type(screen.getByLabelText(/Type LIVE/), "live");
    expect((screen.getByRole("button", { name: "Open Live Mac" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByLabelText(/Type LIVE/));
    await user.type(screen.getByLabelText(/Type LIVE/), "LIVE");
    await user.click(screen.getByRole("button", { name: "Open Live Mac" }));

    expect(screen.getByTestId("fake-terminal").getAttribute("data-mode")).toBe("live");
    expect(terminal.pairing).toEqual(hostedPairing);
    expect(terminal.consumePairing).toBeTypeOf("function");

    await act(async () => terminal.consumePairing?.());
    await waitFor(() => expect(terminal.pairing).toBeNull());
    await user.click(screen.getByRole("button", { name: "Practice" }));

    const live = screen.getByRole("button", { name: "Pair Live Mac" }) as HTMLButtonElement;
    expect(live.disabled).toBe(false);
    expect(screen.getByTestId("fake-terminal").getAttribute("data-mode")).toBe("practice");
  });

  it("keeps an unspent hosted pairing available after returning to Practice", async () => {
    liveOrigin.consumeLiveMacAccess.mockReturnValue({ kind: "hosted", pairing: hostedPairing });
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    await user.click(screen.getByRole("button", { name: "Live Mac" }));
    await user.type(screen.getByLabelText(/Type LIVE/), "LIVE");
    await user.click(screen.getByRole("button", { name: "Open Live Mac" }));
    expect(terminal.pairing).toEqual(hostedPairing);

    await user.click(screen.getByRole("button", { name: "Practice" }));
    expect(screen.getByTestId("fake-terminal").getAttribute("data-mode")).toBe("practice");
    expect(screen.getByRole("button", { name: "Live Mac" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Live Mac" }));
    expect((screen.getByLabelText(/Type LIVE/) as HTMLInputElement).value).toBe("");
    await user.type(screen.getByLabelText(/Type LIVE/), "LIVE");
    await user.click(screen.getByRole("button", { name: "Open Live Mac" }));
    expect(terminal.pairing).toEqual(hostedPairing);
  });

  it("explains hosted pairing without probing loopback", async () => {
    liveOrigin.consumeLiveMacAccess.mockReturnValue({ kind: "hosted-unpaired", pairing: null });
    const loopbackFetch = vi.fn();
    vi.stubGlobal("fetch", loopbackFetch);
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    const live = screen.getByRole("button", { name: "Pair Live Mac" }) as HTMLButtonElement;
    expect(live.disabled).toBe(false);
    expect(terminal.pairing).toBeNull();
    expect(screen.getByTestId("fake-terminal").getAttribute("data-mode")).toBe("practice");
    await user.click(live);
    const dialog = screen.getByRole("dialog", { name: "Pair this Mac first." });
    const close = within(dialog).getByRole("button", { name: "Close Live Mac pairing instructions" });
    const back = within(dialog).getByRole("button", { name: "Back to Practice" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(back);
    await user.tab();
    expect(document.activeElement).toBe(close);
    expect(within(dialog).getByText("terminal-wizard --hosted")).toBeTruthy();
    expect(within(dialog).getByText(/Vercel never receives/)).toBeTruthy();
    expect(loopbackFetch).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pair this Mac first." })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(live));
  });

  it("inserts without credit and records only a successful terminal result", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();
    const insert = screen.getByRole("button", { name: "Insert pwd in the terminal without running it" });

    await user.click(insert);
    expect(terminal.insertCommand).toHaveBeenCalledWith("pwd");
    expect(insert.textContent).toContain("Insert");
    fireEvent.click(screen.getByRole("button", { name: "emit pwd failure" }));
    expect(insert.textContent).toContain("Insert");
    fireEvent.click(screen.getByRole("button", { name: "emit pwd success" }));

    await waitFor(() => expect(insert.textContent).toContain("Again"));
    expect(window.localStorage.getItem("terminal-wizard.progress.v3")).toContain("step-");
  });

  it("credits an in-flight result to its submission lesson after navigation", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await waitForHydration();

    const { dialog } = await openLessonDialog(user);
    await user.click(within(dialog).getByRole("button", { name: /Practice on a real project, safely/ }));
    fireEvent.click(screen.getByRole("button", { name: "emit delayed maintenance result" }));

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem("terminal-wizard.progress.v3") ?? "{}",
      ) as Record<string, string[]>;
      expect(stored.maintenance).toHaveLength(1);
      expect(stored["real-work"]).toBeUndefined();
    });
  });
});
