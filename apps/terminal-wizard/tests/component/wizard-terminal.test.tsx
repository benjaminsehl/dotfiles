import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ghostty = vi.hoisted(() => ({
  load: vi.fn(),
}));

const liveSession = vi.hoisted(() => ({
  requestLiveHealth: vi.fn(),
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
    requestLiveHealth: liveSession.requestLiveHealth,
    requestLiveTicket: liveSession.requestLiveTicket,
  };
});

import { WizardTerminal } from "@/app/components/WizardTerminal";
import { LiveTicketError } from "@/app/lib/live-session";

const pairing = Object.freeze({
  version: 1 as const,
  instanceId: "a".repeat(22),
  pairingSecret: "b".repeat(43),
});

const ticket = `terminal-wizard.${"c".repeat(43)}.${"d".repeat(43)}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly protocol: string;
  readonly readyState = 0;
  readonly close = vi.fn();
  readonly send = vi.fn();
  readonly addEventListener = vi.fn();

  constructor(_url: string, protocol: string | string[]) {
    this.protocol = Array.isArray(protocol) ? protocol[0] ?? "" : protocol;
  }
}

async function renderLive(onPairingConsumed = vi.fn()) {
  render(
    <WizardTerminal
      lessonId="orientation"
      mode="live"
      pairing={pairing}
      onCommand={vi.fn()}
      onPairingConsumed={onPairingConsumed}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return {
    onPairingConsumed,
    start: screen.getByRole("button", { name: "Start terminal" }),
  };
}

beforeEach(() => {
  ghostty.load.mockResolvedValue({});
  liveSession.requestLiveHealth.mockResolvedValue(undefined);
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hosted Live Mac permission and pairing lifecycle", () => {
  it("keeps the one-time pairing while Chrome permission is pending and consumes it only after ticket success", async () => {
    const exchange = deferred<string>();
    liveSession.requestLiveTicket.mockReturnValue(exchange.promise);
    const { onPairingConsumed, start } = await renderLive();

    fireEvent.click(start);
    expect(await screen.findByText("Allow Local Network Access in Chrome to connect to this Mac…")).toBeTruthy();
    expect(onPairingConsumed).not.toHaveBeenCalled();

    exchange.resolve(ticket);
    await waitFor(() => expect(onPairingConsumed).toHaveBeenCalledTimes(1));
  });

  it("retains the pairing and gives an actionable retry message when Chrome blocks loopback access", async () => {
    liveSession.requestLiveTicket.mockRejectedValue(new TypeError("Failed to fetch"));
    const { onPairingConsumed, start } = await renderLive();

    fireEvent.click(start);

    expect(await screen.findByText(
      "Chrome blocked access to this Mac. Allow Local Network Access, then return to Practice and try again.",
    )).toBeTruthy();
    expect(onPairingConsumed).not.toHaveBeenCalled();
  });

  it("clears a pairing the companion has definitively rejected", async () => {
    liveSession.requestLiveTicket.mockRejectedValue(
      new LiveTicketError("This pairing expired. Run terminal-wizard --hosted again.", true),
    );
    const { onPairingConsumed, start } = await renderLive();

    fireEvent.click(start);

    expect(await screen.findByText("This pairing expired. Run terminal-wizard --hosted again.")).toBeTruthy();
    expect(onPairingConsumed).toHaveBeenCalledTimes(1);
  });

  it("allows two minutes for the Chrome permission prompt instead of failing after ten seconds", async () => {
    vi.useFakeTimers();
    liveSession.requestLiveHealth.mockImplementation((_pairing, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const { onPairingConsumed, start } = await renderLive();

    fireEvent.click(start);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Allow Local Network Access in Chrome to connect to this Mac…")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(screen.queryByText(/did not grant Local Network Access in time/)).toBeNull();
    expect(onPairingConsumed).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(110_000);
      await Promise.resolve();
    });
    expect(screen.getByText(
      "Chrome did not grant Local Network Access in time. Return to Practice and try again.",
    )).toBeTruthy();
    expect(onPairingConsumed).not.toHaveBeenCalled();
  });
});
