import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
}));

vi.mock("@/app/lib/file-system", () => fileSystem);

vi.mock("@/app/components/WizardTerminal", async () => {
  const ReactModule = await import("react");
  return {
    WizardTerminal: ReactModule.forwardRef(function FakeTerminal(
      props: {
        lessonId: string;
        mode: "practice" | "live";
        files?: Record<string, string>;
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

beforeEach(() => {
  window.localStorage.clear();
  terminal.insertCommand.mockReset();
  terminal.focus.mockReset();
  terminal.mounts = 0;
  fileSystem.supportsFileSystemAccess.mockReturnValue(true);
  fileSystem.restoreFolder.mockResolvedValue(null);
  fileSystem.connectFolder.mockResolvedValue(snapshot());
  fileSystem.reconnectFolder.mockResolvedValue(snapshot());
  fileSystem.forgetFolder.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Terminal Wizard client journey", () => {
  it("does not let a late restore overwrite a newer folder choice", async () => {
    const restore = deferred<Snapshot | null>();
    fileSystem.restoreFolder.mockReturnValue(restore.promise);
    fileSystem.connectFolder.mockResolvedValue(snapshot({ label: "new-project" }));
    const user = userEvent.setup();
    render(<TerminalWizard />);

    await user.click(await screen.findByRole("button", { name: "Choose folder" }));
    await screen.findByText(/new-project/);
    restore.resolve(snapshot({ label: "old-project" }));

    await waitFor(() => expect(screen.queryByText(/old-project/)).toBeNull());
    expect(screen.getByText(/new-project/)).toBeTruthy();
  });

  it("remounts the terminal when a granted folder restore finishes", async () => {
    const restore = deferred<Snapshot | null>();
    fileSystem.restoreFolder.mockReturnValue(restore.promise);
    render(<TerminalWizard />);
    await screen.findByText(/0\/10/);
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");

    restore.resolve(snapshot({
      label: "restored-project",
      files: { "/workspace/restored.md": "restored\n" },
    }));

    await screen.findByText(/restored-project/);
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
    render(<TerminalWizard />);

    await screen.findByRole("button", { name: "Reconnect folder" });
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("");
  });

  it("locks Forget while refresh is pending and replaces the snapshot once", async () => {
    const refresh = deferred<Snapshot>();
    fileSystem.restoreFolder.mockResolvedValue(snapshot());
    fileSystem.reconnectFolder.mockReturnValue(refresh.promise);
    const user = userEvent.setup();
    render(<TerminalWizard />);

    await screen.findByText(/dotfiles/);
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");
    await user.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    expect((screen.getByRole("button", { name: "Forget folder" }) as HTMLButtonElement).disabled).toBe(true);
    refresh.resolve(snapshot({
      label: "refreshed-project",
      files: { "/workspace/new.md": "fresh\n" },
    }));

    await screen.findByText(/refreshed-project/);
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

    await user.click(await screen.findByRole("button", { name: "Reconnect folder" }));

    await screen.findByText(message);
    expect(screen.queryByText(/Snapshot refreshed/)).toBeNull();
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("");
    expect(screen.getByRole("button", { name: "Reconnect folder" })).toBeTruthy();
  });

  it("forgets the mounted snapshot and remounts an empty terminal", async () => {
    fileSystem.restoreFolder.mockResolvedValue(snapshot({
      files: { "/workspace/forget-me.md": "temporary\n" },
    }));
    const user = userEvent.setup();
    render(<TerminalWizard />);

    await screen.findByText(/dotfiles/);
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("/workspace/forget-me.md");
    await user.click(screen.getByRole("button", { name: "Forget folder" }));

    await screen.findByRole("button", { name: "Choose folder" });
    expect(screen.getByText(/Folder forgotten here/)).toBeTruthy();
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

    await screen.findByText(/dotfiles/);
    const firstInstance = screen.getByTestId("fake-terminal").getAttribute("data-instance");
    await user.click(screen.getByRole("button", { name: "Forget folder" }));

    await screen.findByText(/could not forget the saved folder/);
    expect(screen.getByText(/dotfiles/)).toBeTruthy();
    expect(screen.getByTestId("fake-terminal").getAttribute("data-files")).toBe("/workspace/retained.md");
    expect(screen.getByTestId("fake-terminal").getAttribute("data-instance")).toBe(firstInstance);
    expect((screen.getByRole("button", { name: "Forget folder" }) as HTMLButtonElement).disabled).toBe(false);
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
    render(<TerminalWizard />);

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("requires fresh exact Live consent and remounts on each mode change", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await screen.findByText(/0\/10/);
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

  it("inserts without credit and records only a successful terminal result", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await screen.findByText(/0\/10/);
    const insert = screen.getByRole("button", { name: "Insert pwd in the terminal without running it" });
    const row = insert.closest(".command-row");
    expect(row).toBeTruthy();

    await user.click(insert);
    expect(terminal.insertCommand).toHaveBeenCalledWith("pwd");
    expect(row?.textContent).toContain("Insert");
    fireEvent.click(screen.getByRole("button", { name: "emit pwd failure" }));
    expect(row?.textContent).toContain("Insert");
    fireEvent.click(screen.getByRole("button", { name: "emit pwd success" }));

    await waitFor(() => expect(row?.textContent).toContain("Again"));
    expect(window.localStorage.getItem("terminal-wizard.progress.v3")).toContain("step-");
  });

  it("credits an in-flight result to its submission lesson after navigation", async () => {
    const user = userEvent.setup();
    render(<TerminalWizard />);
    await screen.findByText(/0\/10/);

    await user.click(screen.getByRole("button", { name: /Practice on a real project, safely/ }));
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
