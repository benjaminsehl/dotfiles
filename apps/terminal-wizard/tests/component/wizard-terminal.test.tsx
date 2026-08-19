import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ghostty = vi.hoisted(() => ({
  load: vi.fn(),
}));

const liveSession = vi.hoisted(() => ({
  requestLiveTicket: vi.fn(),
}));

vi.mock("@wterm/ghostty", () => ({
  GhosttyCore: { load: ghostty.load },
}));

vi.mock("@wterm/react", async () => {
  const ReactModule = await import("react");
  return {
    Terminal: ReactModule.forwardRef(function FakeTerminal(
      props: { onReady(): void },
      ref,
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        instance: { cols: 100, rows: 28 },
        focus: vi.fn(),
        write: vi.fn(),
      }));
      return <button type="button" onClick={props.onReady}>Start terminal</button>;
    }),
  };
});

vi.mock("@/app/lib/live-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/live-session")>();
  return {
    ...original,
    requestLiveTicket: liveSession.requestLiveTicket,
  };
});

import { WizardTerminal } from "@/app/components/WizardTerminal";
import { LIVE_SOCKET_URL } from "@/app/lib/live-session";

const ticket = `terminal-tutor.${"c".repeat(43)}.${"d".repeat(43)}`;

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly protocol: string;
  readonly url: string;
  readonly readyState = 0;
  readonly close = vi.fn();
  readonly send = vi.fn();
  readonly addEventListener = vi.fn();

  constructor(url: string, protocol: string | string[]) {
    this.url = url;
    this.protocol = Array.isArray(protocol) ? protocol[0] ?? "" : protocol;
    FakeWebSocket.instances.push(this);
  }
}

async function renderLive() {
  render(
    <WizardTerminal
      lessonId="orientation"
      mode="live"
      onCommand={vi.fn()}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return screen.getByRole("button", { name: "Start terminal" });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  ghostty.load.mockReset();
  ghostty.load.mockResolvedValue({});
  liveSession.requestLiveTicket.mockReset();
  liveSession.requestLiveTicket.mockResolvedValue(ticket);
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("local Live Mac lifecycle", () => {
  it("requests one local ticket and opens the loopback WebSocket", async () => {
    const start = await renderLive();

    fireEvent.click(start);

    await waitFor(() => expect(liveSession.requestLiveTicket).toHaveBeenCalledTimes(1));
    expect(liveSession.requestLiveTicket.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(FakeWebSocket.instances[0].url).toBe(LIVE_SOCKET_URL);
    expect(FakeWebSocket.instances[0].protocol).toBe(ticket);
    expect(screen.queryByText(/Local Network Access|hosted|Vercel/i)).toBeNull();
  });

  it("surfaces an actionable local service error", async () => {
    liveSession.requestLiveTicket.mockRejectedValue(
      new Error("The local Live Mac service is unavailable. Restart Terminal Tutor and try again."),
    );
    const start = await renderLive();

    fireEvent.click(start);

    expect(await screen.findByText(
      "The local Live Mac service is unavailable. Restart Terminal Tutor and try again.",
    )).toBeTruthy();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("times out a stalled local ticket request after ten seconds", async () => {
    vi.useFakeTimers();
    liveSession.requestLiveTicket.mockImplementation((signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    }));
    const start = await renderLive();

    fireEvent.click(start);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(screen.getByText(
      "The local Live Mac service did not respond. Restart Terminal Tutor and try again.",
    )).toBeTruthy();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});
