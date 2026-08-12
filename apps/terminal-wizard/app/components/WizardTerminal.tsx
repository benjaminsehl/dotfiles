"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, type TerminalHandle } from "@wterm/react";
import { sanitizeTerminalText } from "@/app/lib/file-system";
import { basePracticeFiles, PRACTICE_ROOT, promptFor, registerPracticeCommands } from "@/app/lib/practice";
import { PracticeShell } from "@/app/lib/practice-shell";
import type { LessonCommandResult } from "@/app/lib/lesson-progress";
import type { HostedPairing } from "@/app/lib/live-origin";
import {
  LIVE_SOCKET_URL,
  LiveTicketError,
  parseLiveServerMessage,
  requestLiveHealth,
  requestLiveTicket,
} from "@/app/lib/live-session";

export type TerminalMode = "practice" | "live";

export type WizardTerminalHandle = {
  insertCommand(command: string): void;
  focus(): void;
};

type WizardTerminalProps = {
  lessonId: string;
  mode: TerminalMode;
  pairing?: HostedPairing | null;
  files?: Record<string, string>;
  onCommand(result: LessonCommandResult): void;
  onPairingConsumed?(): void;
};

function safeWorkspaceFiles(files: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [inputPath, inputContent] of Object.entries(files)) {
    const relative = inputPath.startsWith("/workspace/")
      ? inputPath.slice("/workspace/".length)
      : inputPath.startsWith("/")
        ? ""
        : inputPath;
    const segments = relative.split("/").filter(Boolean);
    if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) continue;
    const path = `/workspace/${segments.join("/")}`;
    safe[path] = sanitizeTerminalText(inputContent);
  }
  return safe;
}

function dimensions(instance: TerminalHandle | null): { cols: number; rows: number } {
  const terminal = instance?.instance;
  return {
    cols: terminal?.cols ?? 100,
    rows: terminal?.rows ?? 28,
  };
}

export const WizardTerminal = forwardRef<WizardTerminalHandle, WizardTerminalProps>(
  function WizardTerminal(
    { lessonId, mode, pairing = null, files = {}, onCommand, onPairingConsumed },
    forwardedRef,
  ) {
    const terminalRef = useRef<TerminalHandle>(null);
    const shellRef = useRef<PracticeShell | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const liveAbortRef = useRef<AbortController | null>(null);
    const liveGenerationRef = useRef(0);
    const onCommandRef = useRef(onCommand);
    const onPairingConsumedRef = useRef(onPairingConsumed);
    const lessonIdRef = useRef(lessonId);
    const [core, setCore] = useState<GhosttyCore | null>(null);
    const [status, setStatus] = useState<"loading" | "connecting" | "ready" | "error">("loading");
    const [statusMessage, setStatusMessage] = useState("Loading libghostty…");

    useEffect(() => {
      onCommandRef.current = onCommand;
    }, [onCommand]);

    useEffect(() => {
      onPairingConsumedRef.current = onPairingConsumed;
    }, [onPairingConsumed]);

    useEffect(() => {
      lessonIdRef.current = lessonId;
    }, [lessonId]);

    useEffect(() => {
      let active = true;
      GhosttyCore.load({ wasmPath: "/ghostty-vt.wasm", scrollbackLimit: 5_000 })
        .then((loadedCore) => {
          if (!active) return;
          setCore(loadedCore);
          setStatus("connecting");
          setStatusMessage(mode === "practice" ? "Preparing the practice shell…" : "Requesting a one-time Live Mac ticket…");
        })
        .catch((error: unknown) => {
          if (!active) return;
          setStatus("error");
          setStatusMessage(error instanceof Error ? error.message : "libghostty could not be loaded");
        });
      return () => {
        active = false;
      };
    }, [mode]);

    useEffect(
      () => () => {
        liveGenerationRef.current += 1;
        liveAbortRef.current?.abort();
        liveAbortRef.current = null;
        const socket = socketRef.current;
        if (socketRef.current === socket) socketRef.current = null;
        socket?.close(1000, "terminal changed");
        shellRef.current = null;
      },
      [],
    );

    const sendInput = useCallback(
      (data: string) => {
        if (mode === "practice") {
          void shellRef.current?.handleInput(data);
          return;
        }
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", data }));
        }
      },
      [mode],
    );

    useImperativeHandle(
      forwardedRef,
      () => ({
        insertCommand(command: string) {
          sendInput(command);
          terminalRef.current?.focus();
        },
        focus() {
          terminalRef.current?.focus();
        },
      }),
      [sendInput],
    );

    const connectLive = useCallback(async () => {
      const generation = liveGenerationRef.current + 1;
      liveGenerationRef.current = generation;
      liveAbortRef.current?.abort();
      const controller = new AbortController();
      liveAbortRef.current = controller;
      let timedOut = false;
      let timeoutPhase: "permission" | "session" = pairing ? "permission" : "session";
      let timeout = 0;
      const armTimeout = (phase: "permission" | "session", durationMs: number) => {
        window.clearTimeout(timeout);
        timeoutPhase = phase;
        timeout = window.setTimeout(() => {
          timedOut = true;
          controller.abort(`Live Mac ${phase} timed out`);
        }, durationMs);
      };
      armTimeout(timeoutPhase, pairing ? 120_000 : 10_000);
      setStatus("connecting");
      setStatusMessage(
        pairing
          ? "Allow Local Network Access in Chrome to connect to this Mac…"
          : "Requesting a one-time Live Mac ticket…",
      );
      try {
        if (pairing) {
          await requestLiveHealth(pairing, controller.signal);
          if (controller.signal.aborted || liveGenerationRef.current !== generation) return;
          setStatusMessage("Requesting a one-time Live Mac ticket…");
          armTimeout("session", 10_000);
        }
        const protocol = await requestLiveTicket(pairing, controller.signal);
        if (pairing) onPairingConsumedRef.current?.();
        if (controller.signal.aborted || liveGenerationRef.current !== generation) return;
        const socket = new WebSocket(LIVE_SOCKET_URL, protocol);
        if (controller.signal.aborted || liveGenerationRef.current !== generation) {
          socket.close(1000, "terminal changed");
          return;
        }
        socketRef.current = socket;
        socket.addEventListener("open", () => {
          if (socketRef.current !== socket || liveGenerationRef.current !== generation) {
            socket.close(1000, "stale session");
            return;
          }
          if (socket.protocol !== protocol) {
            socket.close(1002, "session protocol mismatch");
            setStatus("error");
            setStatusMessage("The local companion returned an invalid connection protocol.");
            return;
          }
          const size = dimensions(terminalRef.current);
          socket.send(JSON.stringify({ type: "start", ...size }));
        });
        socket.addEventListener("message", (event) => {
          if (socketRef.current !== socket || liveGenerationRef.current !== generation) return;
          const message = parseLiveServerMessage(event.data);
          if (message) {
            if (message.type === "output") terminalRef.current?.write(message.data);
            if (message.type === "ready") {
              setStatus("ready");
              setStatusMessage("Live Mac connected");
              terminalRef.current?.focus();
            }
            if (message.type === "error") {
              setStatus("error");
              setStatusMessage("The local companion closed Live Mac safely.");
            }
            if (message.type === "exit") {
              setStatus("error");
              setStatusMessage(`Shell exited with code ${message.code}`);
            }
          } else {
            setStatus("error");
            setStatusMessage("Live Mac sent an unreadable response.");
            socket.close(1002, "invalid server message");
          }
        });
        socket.addEventListener("error", () => {
          if (socketRef.current !== socket || liveGenerationRef.current !== generation) return;
          setStatus("error");
          setStatusMessage("Could not connect to the loopback-only Live Mac service.");
        });
        socket.addEventListener("close", (event) => {
          if (socketRef.current !== socket || liveGenerationRef.current !== generation) return;
          socketRef.current = null;
          if (event.code !== 1000) {
            setStatus("error");
            setStatusMessage("Live Mac disconnected. Return to Practice or reconnect deliberately.");
          }
        });
      } catch (error) {
        if (liveGenerationRef.current !== generation || (controller.signal.aborted && !timedOut)) return;
        if (pairing && error instanceof LiveTicketError && error.pairingFinal) {
          onPairingConsumedRef.current?.();
        }
        setStatus("error");
        setStatusMessage(
          timedOut
            ? pairing && timeoutPhase === "permission"
              ? "Chrome did not grant Local Network Access in time. In Chrome site controls, allow Local Network Access for Terminal Tutor, then return to Practice and try again."
              : "The local companion did not respond. Run terminal-wizard --hosted again."
            : pairing && error instanceof TypeError
              ? "Chrome blocked access to this Mac. In Chrome site controls, allow Local Network Access for Terminal Tutor, then return to Practice and try again."
            : error instanceof Error
              ? error.message
              : "Could not start Live Mac",
        );
      } finally {
        window.clearTimeout(timeout);
      }
    }, [pairing]);

    const handleReady = useCallback(async () => {
      if (mode === "live") {
        await connectLive();
        return;
      }
      if (shellRef.current) return;
      const connectedFiles = safeWorkspaceFiles(files);
      const hasWorkspace = Object.keys(connectedFiles).some((path) => path.startsWith("/workspace/"));
      const shell = new PracticeShell({
        files: { ...basePracticeFiles, ...connectedFiles },
        cwd: PRACTICE_ROOT,
        env: {
          HOME: "/home/benjamin",
          SHELL: "/bin/zsh",
          PATH: "/usr/local/bin:/usr/bin:/bin",
          TERM: "xterm-ghostty",
          TERM_PROGRAM: "ghostty",
        },
        greeting: [
          "\u001b[38;2;202;211;245mTerminal Tutor · safe practice\u001b[0m",
          "\u001b[38;2;166;173;200mIn-memory shell · network off · changes vanish on reload\u001b[0m",
          hasWorkspace ? "\u001b[38;2;166;227;161mRead-only folder snapshot mounted at /workspace\u001b[0m" : "Type help, or insert a command from the lesson below.",
        ],
        prompt: promptFor,
        getLessonId: () => lessonIdRef.current,
        onCommandResult(result) {
          if (!result.lessonId) return;
          onCommandRef.current({
            lessonId: result.lessonId,
            command: result.command,
            mode: "practice",
            status: result.exitCode === 0 ? "succeeded" : "failed",
            exitCode: result.exitCode,
          });
        },
      });
      shellRef.current = shell;
      await shell.attach((data) => terminalRef.current?.write(data));
      registerPracticeCommands(shell);
      setStatus("ready");
      setStatusMessage("Safe practice ready");
    }, [connectLive, files, mode]);

    const handleResize = useCallback((cols: number, rows: number) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    }, []);

    return (
      <div className="terminal-stage" data-mode={mode}>
        {!core ? (
          <div className="terminal-loading" role="status">
            <span className="terminal-loading-mark">❯</span>
            <span>{statusMessage}</span>
          </div>
        ) : (
          <Terminal
            ref={terminalRef}
            core={core}
            className="wizard-wterm"
            autoResize
            debug={false}
            onReady={() => void handleReady()}
            onData={sendInput}
            onResize={handleResize}
            onError={(error) => {
              setStatus("error");
              setStatusMessage(error instanceof Error ? error.message : "Terminal renderer error");
            }}
            aria-label={mode === "practice" ? "Safe practice terminal" : "Live Mac terminal"}
          />
        )}
        {status !== "ready" && core ? (
          <div className={`terminal-status terminal-status-${status}`} role="status">
            <span className="status-pulse" aria-hidden="true" />
            {statusMessage}
          </div>
        ) : null}
      </div>
    );
  },
);
