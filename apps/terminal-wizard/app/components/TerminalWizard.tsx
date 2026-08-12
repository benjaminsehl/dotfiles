"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lessons } from "@/app/data/lessons";
import {
  connectFolder,
  forgetFolder,
  reconnectFolder,
  restoreFolder,
  supportsFileSystemAccess,
  type FolderSnapshot,
} from "@/app/lib/file-system";
import {
  clearProgress,
  persistProgress,
  readProgress,
  type Progress,
} from "@/app/lib/progress";
import {
  isLessonComplete,
  recordLessonResult,
  requiredLessonCommands,
  type LessonCommandResult,
} from "@/app/lib/lesson-progress";
import {
  consumeLiveMacAccess,
  type HostedPairing,
  type LiveMacAccess,
} from "@/app/lib/live-origin";
import {
  WizardTerminal,
  type TerminalMode,
  type WizardTerminalHandle,
} from "@/app/components/WizardTerminal";

const DIALOG_FOCUSABLE = "button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

function trapDialogFocus(event: KeyboardEvent, dialog: HTMLElement | null) {
  if (event.key !== "Tab" || !dialog) return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (!dialog.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function TerminalWizard() {
  const [selectedId, setSelectedId] = useState(lessons[0].id);
  const [progress, setProgress] = useState<Progress>({});
  const [progressHydrated, setProgressHydrated] = useState(false);
  const [mode, setMode] = useState<TerminalMode>("practice");
  const [liveAccess, setLiveAccess] = useState<LiveMacAccess>({ kind: "unavailable", pairing: null });
  const [activePairing, setActivePairing] = useState<HostedPairing | null>(null);
  const [liveDialogOpen, setLiveDialogOpen] = useState(false);
  const [pairingHelpOpen, setPairingHelpOpen] = useState(false);
  const [livePhrase, setLivePhrase] = useState("");
  const [folder, setFolder] = useState<FolderSnapshot | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderMessage, setFolderMessage] = useState("");
  const [folderMessageTone, setFolderMessageTone] = useState<"status" | "error">("status");
  const [folderRevision, setFolderRevision] = useState(0);
  const [pickerSupported, setPickerSupported] = useState(false);
  const [lessonMenuOpen, setLessonMenuOpen] = useState(false);
  const [folderPanelOpen, setFolderPanelOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"lesson" | "terminal">("lesson");
  const terminalRef = useRef<WizardTerminalHandle>(null);
  const liveInputRef = useRef<HTMLInputElement>(null);
  const liveTriggerRef = useRef<HTMLButtonElement>(null);
  const liveDialogRef = useRef<HTMLElement>(null);
  const pairingHelpDialogRef = useRef<HTMLElement>(null);
  const pairingHelpCloseRef = useRef<HTMLButtonElement>(null);
  const lessonMenuRef = useRef<HTMLElement>(null);
  const lessonTriggerRef = useRef<HTMLButtonElement>(null);
  const folderPanelRef = useRef<HTMLElement>(null);
  const folderTriggerRef = useRef<HTMLButtonElement>(null);
  const lessonPanelRef = useRef<HTMLElement>(null);
  const folderOperationRef = useRef(0);
  const selectedLesson = lessons.find((lesson) => lesson.id === selectedId) ?? lessons[0];
  const closeLessonMenu = useCallback((restoreFocus = true) => {
    setLessonMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => lessonTriggerRef.current?.focus());
    }
  }, []);
  const closeFolderPanel = useCallback((restoreFocus = true) => {
    setFolderPanelOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => folderTriggerRef.current?.focus());
    }
  }, []);
  const closeLiveDialog = useCallback(() => {
    setLiveDialogOpen(false);
    setLivePhrase("");
    window.requestAnimationFrame(() => liveTriggerRef.current?.focus());
  }, []);
  const closePairingHelp = useCallback(() => {
    setPairingHelpOpen(false);
    window.requestAnimationFrame(() => liveTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    let active = true;
    const supported = supportsFileSystemAccess();
    const detectedLiveAccess = consumeLiveMacAccess(window.location, window.history);
    const progressTimer = window.setTimeout(() => {
      if (!active) return;
      setLiveAccess(detectedLiveAccess);
      setProgress(readProgress(window.localStorage));
      setProgressHydrated(true);
      setPickerSupported(supported);
    }, 0);
    if (!supported) {
      return () => {
        active = false;
        window.clearTimeout(progressTimer);
      };
    }
    const folderOperation = folderOperationRef.current;
    void restoreFolder()
      .then((snapshot) => {
        if (active && folderOperationRef.current === folderOperation && snapshot) {
          setFolder(snapshot);
          setFolderRevision((revision) => revision + 1);
        }
      })
      .catch(() => {
        if (active && folderOperationRef.current === folderOperation) {
          setFolderMessageTone("error");
          setFolderMessage("The saved folder could not be restored. Choose it again when you are ready.");
        }
      });
    return () => {
      active = false;
      window.clearTimeout(progressTimer);
    };
  }, []);

  useEffect(() => {
    if (!progressHydrated) return;
    if (Object.keys(progress).length === 0) {
      clearProgress(window.localStorage);
    } else {
      persistProgress(window.localStorage, progress);
    }
  }, [progress, progressHydrated]);

  useEffect(() => {
    if (!liveDialogOpen) return;
    const focusFrame = window.requestAnimationFrame(() => liveInputRef.current?.focus());
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeLiveDialog();
        return;
      }
      trapDialogFocus(event, liveDialogRef.current);
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleDialogKeys);
    };
  }, [closeLiveDialog, liveDialogOpen]);

  useEffect(() => {
    if (!pairingHelpOpen) return;
    const focusFrame = window.requestAnimationFrame(() => pairingHelpCloseRef.current?.focus());
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePairingHelp();
        return;
      }
      trapDialogFocus(event, pairingHelpDialogRef.current);
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleDialogKeys);
    };
  }, [closePairingHelp, pairingHelpOpen]);

  useEffect(() => {
    if (!lessonMenuOpen && !folderPanelOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (lessonMenuOpen) {
        closeLessonMenu();
      }
      if (folderPanelOpen) {
        closeFolderPanel();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeFolderPanel, closeLessonMenu, folderPanelOpen, lessonMenuOpen]);

  useEffect(() => {
    if (!lessonMenuOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      lessonMenuRef.current
        ?.querySelector<HTMLButtonElement>('[aria-current="step"]')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [lessonMenuOpen]);

  useEffect(() => {
    if (!folderPanelOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      folderPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [folderPanelOpen]);

  const completedLessons = useMemo(
    () => lessons.filter((lesson) => isLessonComplete(progress, lesson)).length,
    [progress],
  );
  const hasProgress = Object.values(progress).some((entries) => entries.length > 0);

  const resetAllProgress = () => {
    if (!hasProgress) return;
    if (!window.confirm("Reset all Terminal Tutor lesson progress?")) return;
    clearProgress(window.localStorage);
    setProgress({});
  };

  const recordCommand = useCallback((result: LessonCommandResult) => {
    setProgress((current) => {
      const lesson = lessons.find((candidate) => candidate.id === result.lessonId);
      if (!lesson) return current;
      return recordLessonResult(current, lesson, result);
    });
  }, []);

  const chooseFolder = async () => {
    const restoreOperation = folderOperationRef.current;
    let folderOperation = restoreOperation;
    setFolderMessage("");
    setFolderMessageTone("status");
    const pending = connectFolder();
    setFolderBusy(true);
    try {
      const snapshot = await pending;
      if (folderOperationRef.current !== restoreOperation) return;
      folderOperation = restoreOperation + 1;
      folderOperationRef.current = folderOperation;
      setFolder(snapshot);
      setFolderRevision((revision) => revision + 1);
      setMode("practice");
      setMobilePane("terminal");
    } catch (error) {
      if (folderOperationRef.current !== restoreOperation) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFolderMessageTone("error");
      setFolderMessage(error instanceof Error ? error.message : "That folder could not be connected.");
    } finally {
      if (folderOperationRef.current === folderOperation) setFolderBusy(false);
    }
  };

  const reconnect = async () => {
    const folderOperation = folderOperationRef.current + 1;
    folderOperationRef.current = folderOperation;
    setFolderBusy(true);
    setFolderMessage("");
    setFolderMessageTone("status");
    try {
      const snapshot = await reconnectFolder();
      if (folderOperationRef.current !== folderOperation) return;
      setFolder(snapshot);
      setFolderRevision((revision) => revision + 1);
      setMode("practice");
      setMobilePane("terminal");
      if (snapshot.permission === "granted") {
        setFolderMessage(`Snapshot refreshed: ${snapshot.fileCount} safe text files are available under /workspace.`);
      } else if (snapshot.permission === "denied") {
        setFolderMessageTone("error");
        setFolderMessage("Folder access remains denied. No files are available under /workspace.");
      } else {
        setFolderMessage("Folder permission is still required. No files are available under /workspace.");
      }
    } catch (error) {
      if (folderOperationRef.current !== folderOperation) return;
      setFolderMessageTone("error");
      setFolderMessage(error instanceof Error ? error.message : "The browser did not restore folder access.");
    } finally {
      if (folderOperationRef.current === folderOperation) setFolderBusy(false);
    }
  };

  const forget = async () => {
    const folderOperation = folderOperationRef.current + 1;
    folderOperationRef.current = folderOperation;
    setFolderBusy(true);
    setFolderMessage("");
    setFolderMessageTone("status");
    try {
      await forgetFolder();
      if (folderOperationRef.current !== folderOperation) return;
      setFolder(null);
      setFolderRevision((revision) => revision + 1);
      setFolderMessage("Folder forgotten here. Persistent browser permission can also be revoked in browser site settings.");
      closeFolderPanel();
    } catch {
      if (folderOperationRef.current !== folderOperation) return;
      setFolderMessageTone("error");
      setFolderMessage("The browser could not forget the saved folder. Clear this site's stored data before relying on a reload to remove it.");
    } finally {
      if (folderOperationRef.current === folderOperation) setFolderBusy(false);
    }
  };

  const beginLive = () => {
    if (!liveAvailable || livePhrase !== "LIVE") return;
    if (liveAccess.kind === "hosted") {
      setActivePairing(liveAccess.pairing);
      setLiveAccess({ kind: "hosted-unpaired", pairing: null });
    } else if (liveAccess.kind === "local") {
      setActivePairing(null);
    }
    setLiveDialogOpen(false);
    setLivePhrase("");
    setMode("live");
    setMobilePane("terminal");
  };

  const returnToPractice = () => {
    setMode("practice");
  };

  const liveAvailable = liveAccess.kind === "local" || liveAccess.kind === "hosted" || activePairing !== null || mode === "live";
  const pairedFromHostedPage = liveAccess.kind === "hosted" || activePairing !== null;

  const lessonEntries = progress[selectedLesson.id] ?? [];
  const selectedIndex = lessons.findIndex((lesson) => lesson.id === selectedLesson.id);
  const requiredCommands = requiredLessonCommands(selectedLesson);
  const lessonComplete = isLessonComplete(progress, selectedLesson);
  const practicedCount = requiredCommands.filter((command) => lessonEntries.includes(command.id)).length;

  const selectLesson = (index: number, restorePickerFocus = false) => {
    const lesson = lessons[index];
    if (!lesson) return;
    setSelectedId(lesson.id);
    setLessonMenuOpen(false);
    setMobilePane("lesson");
    window.requestAnimationFrame(() => lessonPanelRef.current?.scrollTo({ top: 0 }));
    if (restorePickerFocus) {
      window.requestAnimationFrame(() => lessonTriggerRef.current?.focus());
    }
  };

  const toggleLessonMenu = () => {
    setFolderPanelOpen(false);
    setLessonMenuOpen((open) => !open);
  };

  const toggleFolderPanel = () => {
    setLessonMenuOpen(false);
    setFolderPanelOpen((open) => !open);
  };

  const folderNeedsAttention = Boolean(
    (folderMessage && folderMessageTone === "error")
      || (folder && folder.permission !== "granted")
      || folder?.staleSavedHandle
      || folder?.truncated
      || (folder && !folder.remembered),
  );
  const folderTriggerValue = folderBusy
    ? "Reading…"
    : !progressHydrated
      ? "Loading…"
      : !pickerSupported
        ? "Unavailable"
        : folder?.permission === "granted"
          ? folder.label
          : folder?.permission === "denied"
            ? "Denied"
            : folder
              ? "Reconnect"
              : "Add";
  const folderTriggerLabel = folderBusy
    ? "Practice files: reading folder"
    : !progressHydrated
      ? "Practice files: checking folder access"
      : !pickerSupported
        ? "Practice files: folder access unavailable in this browser"
        : folder?.permission === "granted"
          ? `Practice files: ${folder.label}, ${folder.fileCount} safe text files ready${folderNeedsAttention ? ", attention needed" : ""}`
          : folder?.permission === "denied"
            ? `Practice files: ${folder.label}, access denied`
            : folder
              ? `Practice files: ${folder.label}, permission required`
              : `Practice files: no folder connected${folderNeedsAttention ? ", attention needed" : ""}`;

  const openLiveDialog = () => {
    if (liveAccess.kind === "hosted-unpaired" && activePairing === null) {
      closeFolderPanel(false);
      closeLessonMenu(false);
      setPairingHelpOpen(true);
      return;
    }
    if (!liveAvailable) return;
    closeFolderPanel(false);
    closeLessonMenu(false);
    setLiveDialogOpen(true);
  };

  return (
    <div className="wizard-app">
      <a className="skip-link" href="#lesson-content">
        Skip to lesson
      </a>
      <a className="skip-link skip-terminal" href="#terminal-workspace">
        Skip to terminal
      </a>

      <header className="tutorial-chrome" aria-label="Terminal Tutor controls">
        <a className="brand" href="#lesson-content" aria-label="Terminal Tutor">
          <span className="brand-mark" aria-hidden="true">&gt;_</span>
          <span>terminal tutor</span>
        </a>
        <nav className="course-controls" aria-label="Lesson navigation">
          <button
            ref={lessonTriggerRef}
            className="lesson-menu-trigger"
            type="button"
            onClick={toggleLessonMenu}
            aria-expanded={lessonMenuOpen}
            aria-controls="lesson-picker"
            aria-haspopup="dialog"
          >
            <span aria-hidden="true">≡</span>
            <span className="sr-only">Choose lesson</span>
          </button>
          <button
            className="lesson-arrow"
            type="button"
            onClick={() => selectLesson(selectedIndex - 1)}
            disabled={selectedIndex <= 0}
            aria-label={selectedIndex > 0 ? `Previous lesson: ${lessons[selectedIndex - 1].title}` : "Previous lesson"}
          >
            ←
          </button>
          <button
            className="lesson-arrow"
            type="button"
            onClick={() => selectLesson(selectedIndex + 1)}
            disabled={selectedIndex >= lessons.length - 1}
            aria-label={selectedIndex < lessons.length - 1 ? `Next lesson: ${lessons[selectedIndex + 1].title}` : "Next lesson"}
          >
            →
          </button>
          <div className="lesson-breadcrumb" aria-label={`Current lesson: ${selectedLesson.title}`}>
            <span>{selectedLesson.number} / {lessons.length}</span>
            <strong>{selectedLesson.kicker}</strong>
            <b aria-hidden="true">/</b>
            <span>{selectedLesson.title}</span>
          </div>
          <span className="course-meta">{selectedLesson.level} · {selectedLesson.minutes} min</span>
        </nav>
        <div className="mobile-pane-switch" role="group" aria-label="Workspace pane">
          <button type="button" aria-pressed={mobilePane === "lesson"} onClick={() => setMobilePane("lesson")}>Lesson</button>
          <button type="button" aria-pressed={mobilePane === "terminal"} onClick={() => setMobilePane("terminal")}>Terminal</button>
        </div>
        <div className="progress-summary">
          <span className="progress-ring" aria-hidden="true" style={{ "--progress": `${(completedLessons / lessons.length) * 360}deg` } as React.CSSProperties} />
          <span className="progress-copy" aria-label={`${completedLessons} of ${lessons.length} lessons complete`}><strong>{completedLessons}/{lessons.length}</strong> complete</span>
          <button
            className="progress-reset"
            type="button"
            onClick={resetAllProgress}
            disabled={!progressHydrated || !hasProgress}
            aria-label="Reset all lesson progress"
          >
            Reset
          </button>
        </div>
      </header>
      <p className="sr-only" role="status" aria-live="polite">
        Lesson {selectedIndex + 1} of {lessons.length}: {selectedLesson.title}
      </p>

      <main className={`tutorial-workspace show-${mobilePane}`}>
        <article className="lesson-pane" id="lesson-content" ref={lessonPanelRef} tabIndex={-1}>
          <div className="pane-titlebar" aria-hidden="true">
            <span><b>lesson</b> / {selectedLesson.number.padStart(2, "0")}</span>
            <span>{selectedLesson.level} · {selectedLesson.minutes}m</span>
          </div>
          <div className="lesson-pane-inner">
            <header className="lesson-intro">
              <p className="eyebrow">Lesson {selectedLesson.number} · {selectedLesson.kicker}</p>
              <h1>{selectedLesson.title}</h1>
              <p className="lesson-summary">{selectedLesson.summary}</p>
              <div className="lesson-progress-line">
                <span className={`lesson-progress-count ${lessonComplete ? "complete" : ""}`}>
                  {lessonComplete ? "Complete" : `${practicedCount}/${requiredCommands.length} complete`}
                </span>
                <span>{lessonComplete ? "Every required Practice command succeeded." : "Practice success earns progress."}</span>
              </div>
            </header>

            <section className="lesson-outcome" aria-labelledby="outcome-title">
              <span aria-hidden="true">◎</span>
              <div><h2 id="outcome-title">What you’ll be able to do</h2><p>{selectedLesson.outcome}</p></div>
            </section>

            <section className="lesson-moves" aria-labelledby="try-title">
              <div className="section-heading">
                <h2 id="try-title">Try these moves</h2>
                <span>Insert, then press Return</span>
              </div>
              <div className="command-list">
                {selectedLesson.commands.map((item) => {
                  const practiced = lessonEntries.includes(item.id);
                  const requiredMode = item.mode ?? "either";
                  const available = requiredMode === "either" || requiredMode === mode;
                  const accessLabel = item.required === false
                    ? "Optional Live"
                    : requiredMode === "practice"
                      ? "Practice lab"
                      : requiredMode === "live"
                        ? "Live only"
                        : "Practice credit";
                  return (
                    <div className={`command-row ${practiced ? "practiced" : ""} ${available ? "" : "unavailable"}`} key={item.id}>
                      <div className="command-copy">
                        <div className="command-heading">
                          <code>{item.command}</code>
                          <span className={`command-access ${requiredMode}`}>{accessLabel}</span>
                        </div>
                        <p><strong>{item.label}</strong> — {item.detail}</p>
                      </div>
                      <button
                        disabled={!available}
                        onClick={() => {
                          if (!available) return;
                          terminalRef.current?.insertCommand(item.command);
                          terminalRef.current?.focus();
                          setMobilePane("terminal");
                        }}
                        aria-label={available ? `Insert ${item.command} in the terminal without running it` : `Switch to ${requiredMode} mode to use ${item.command}`}
                      >
                        {available ? (practiced ? "Again" : "Insert") : requiredMode === "live" ? "Use Live" : "Use Practice"}
                        {available ? <span aria-hidden="true"> ↗</span> : null}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="field-notes" aria-labelledby="notes-title">
              <div className="section-heading"><h2 id="notes-title">Keep in mind</h2></div>
              <ul>{selectedLesson.fieldNotes.map((note) => <li key={note}>{note}</li>)}</ul>
            </section>

            <div className={`master-status ${lessonComplete ? "complete" : ""}`} role="status">
              {lessonComplete
                ? "✓ Lesson complete"
                : `${requiredCommands.length - practicedCount} required command${requiredCommands.length - practicedCount === 1 ? "" : "s"} left`}
            </div>
          </div>
        </article>

        <section className="terminal-pane" id="terminal-workspace" aria-label="Terminal workspace" tabIndex={-1}>
          <div className="terminal-card">
            <div className="terminal-toolbar">
              <div className="terminal-pane-title" aria-hidden="true">
                <b>shell</b> / {mode === "practice" ? "sandbox" : "benjamin@mac"}
              </div>
              <div className="mode-switch" role="group" aria-label="Terminal access mode">
                <button className={mode === "practice" ? "active" : ""} aria-pressed={mode === "practice"} onClick={returnToPractice}>
                  <span className="shield-mark" aria-hidden="true">◇</span> Practice
                </button>
                <button
                  ref={liveTriggerRef}
                  className={mode === "live" ? "live-active" : ""}
                  aria-pressed={mode === "live"}
                  aria-label={liveAvailable ? "Live Mac" : liveAccess.kind === "hosted-unpaired" ? "Pair Live Mac" : "Live Mac (unavailable)"}
                  title={liveAvailable || liveAccess.kind === "hosted-unpaired" ? undefined : "Live Mac is available from the local app or a paired production page"}
                  disabled={!liveAvailable && liveAccess.kind !== "hosted-unpaired"}
                  onClick={() => mode === "live" ? undefined : openLiveDialog()}
                >
                  <span aria-hidden="true">●</span> Live Mac{liveAvailable ? "" : liveAccess.kind === "hosted-unpaired" ? " · Pair first" : " · Unavailable"}
                </button>
              </div>
              <div className="terminal-tools">
                {mode === "practice" ? (
                  <button
                    ref={folderTriggerRef}
                    className={`folder-trigger ${folder?.permission === "granted" ? "connected" : ""}`}
                    type="button"
                    onClick={toggleFolderPanel}
                    aria-expanded={folderPanelOpen}
                    aria-controls="folder-panel"
                    aria-haspopup="dialog"
                    aria-label={folderTriggerLabel}
                  >
                    <span aria-hidden="true">{folder?.permission === "granted" && !folderNeedsAttention ? "●" : folderNeedsAttention ? "!" : "⌁"}</span>
                    <span><b>Files</b> · {folderTriggerValue}</span>
                  </button>
                ) : null}
                <span className={`terminal-mode-label ${mode}`}>
                  {mode === "practice" ? "SAFE" : "LIVE"}
                </span>
              </div>
            </div>
            <div className={`mode-truth ${mode}`}>
              <span className="mode-truth-copy">Practice models the declared setup; Live verifies this Mac.</span>
              <strong aria-live="polite">{mode === "practice" ? "Practice model · earns credit" : "Live mode · no course credit"}</strong>
            </div>
            <p
              className="sr-only"
              role={folderMessageTone === "error" ? "alert" : "status"}
              aria-live={folderMessageTone === "error" ? "assertive" : "polite"}
            >
              {folderMessage}
            </p>
            {mode === "live" ? (
              <div className="live-warning" role="alert">
                <strong>Live Mac is real.</strong> It starts in <code>~/Sites/dotfiles</code>, and commands have your full user permissions. Lesson buttons still insert text only; press Return yourself.
              </div>
            ) : null}
            <WizardTerminal
              key={`${mode}:${folderRevision}`}
              ref={terminalRef}
              lessonId={selectedLesson.id}
              mode={mode}
              pairing={activePairing}
              onPairingConsumed={() => setActivePairing(null)}
              files={folder?.permission === "granted" ? folder.files : {}}
              onCommand={recordCommand}
            />

            {folderPanelOpen ? (
              <>
                <div className="popover-dismiss-layer" role="presentation" onMouseDown={() => closeFolderPanel()} />
                <section
                  id="folder-panel"
                  ref={folderPanelRef}
                  className="folder-popover"
                  role="dialog"
                  aria-labelledby="folder-title"
                  aria-describedby="folder-description"
                >
                  <div className="popover-heading">
                    <div><span className="popover-icon" aria-hidden="true">⌁</span><div><p>Read-only workspace</p><h2 id="folder-title">Practice files</h2></div></div>
                    <button type="button" onClick={() => closeFolderPanel()} aria-label="Close Practice files">×</button>
                  </div>
                  <p className="folder-description" id="folder-description">A point-in-time copy is mounted at <code>/workspace</code> in Practice. Files are processed only in this browser and never uploaded. Live Mac never uses this snapshot.</p>
                  {folder ? (
                    <div className="folder-details">
                      <p><strong>{folder.label}</strong><span>{folder.fileCount} safe text files · {folder.blockedCount} excluded or protected</span></p>
                      {folder.permission === "granted" ? (
                        <>
                          <span className="folder-state"><i /> {folder.remembered ? "Ready · remembered by this browser" : "Ready for this page only"}</span>
                          <button className="folder-action primary" type="button" onClick={() => void reconnect()} disabled={folderBusy}>
                            {folderBusy ? "Refreshing Practice snapshot…" : "Refresh Practice snapshot"}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="folder-state warning">{folder.permission === "denied" ? "Access denied · no files mounted" : "Permission required · no files mounted"}</span>
                          <button className="folder-action primary" type="button" onClick={() => void reconnect()} disabled={folderBusy}>Reconnect folder</button>
                        </>
                      )}
                      <button className="folder-action" type="button" onClick={() => void forget()} disabled={folderBusy}>Forget folder</button>
                      {folder.staleSavedHandle ? (
                        <p className="folder-message" role="alert">This snapshot is session-only, but the browser could not clear an older saved folder. Use Forget folder, or clear this site’s stored data.</p>
                      ) : !folder.remembered ? (
                        <p className="folder-message" role="status">The browser could not remember this folder. This snapshot lasts until the page reloads or closes.</p>
                      ) : null}
                      {folder.truncated ? (
                        <p className="folder-message" role="status">This snapshot reached a safety limit. Choose a narrower folder if you need a complete project view.</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="folder-empty">
                      <p>Choose a narrow project folder, never your home folder.</p>
                      {progressHydrated && !pickerSupported ? (
                        <p className="folder-recovery" role="status">
                          Folder snapshots require Chrome’s File System Access API. Open this page in an up-to-date desktop Chrome window and reload. If you’re already in Chrome, restart or update Chrome, or try a standard profile where the API is enabled.
                        </p>
                      ) : null}
                      <button className="folder-action primary" type="button" onClick={() => void chooseFolder()} disabled={!pickerSupported || folderBusy}>
                        {folderBusy ? "Reading safe files…" : pickerSupported ? "Choose project folder" : "Folder access unavailable"}
                      </button>
                    </div>
                  )}
                  {folderMessage ? <p className="folder-message">{folderMessage}</p> : null}
                  <p className="folder-privacy">Common secrets are blocked or redacted; heuristics cannot guarantee every secret.</p>
                </section>
              </>
            ) : null}
          </div>
        </section>
      </main>

      {lessonMenuOpen ? (
        <>
          <div className="lesson-popover-backdrop" role="presentation" onMouseDown={() => closeLessonMenu()} />
          <section
            id="lesson-picker"
            ref={lessonMenuRef}
            className="lesson-popover"
            role="dialog"
            aria-labelledby="lesson-picker-title"
          >
            <div className="popover-heading">
              <div><span className="popover-icon" aria-hidden="true">↯</span><div><p>{completedLessons}/{lessons.length} complete</p><h2 id="lesson-picker-title">Jump to a lesson</h2></div></div>
              <button type="button" onClick={() => closeLessonMenu()} aria-label="Close lesson picker">×</button>
            </div>
            <nav aria-label="Course lessons">
              {lessons.map((lesson, index) => {
                const complete = isLessonComplete(progress, lesson);
                const active = lesson.id === selectedLesson.id;
                return (
                  <button
                    className={`lesson-picker-item ${active ? "active" : ""}`}
                    key={lesson.id}
                    type="button"
                    onClick={() => selectLesson(index, true)}
                    aria-current={active ? "step" : undefined}
                  >
                    <span className={`lesson-check ${complete ? "complete" : ""}`} aria-hidden="true">{complete ? "✓" : lesson.number}</span>
                    <span><small>{lesson.kicker}</small><strong>{lesson.title}</strong></span>
                  </button>
                );
              })}
            </nav>
            <div className="lesson-picker-actions">
              <button
                type="button"
                onClick={resetAllProgress}
                disabled={!progressHydrated || !hasProgress}
              >
                Reset course progress
              </button>
            </div>
          </section>
        </>
      ) : null}

      {liveDialogOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeLiveDialog()}>
          <section ref={liveDialogRef} className="live-dialog" role="dialog" aria-modal="true" aria-labelledby="live-dialog-title">
            <button className="dialog-close" onClick={closeLiveDialog} aria-label="Close Live Mac warning">×</button>
            <span className="danger-orbit" aria-hidden="true">●</span>
            <p className="eyebrow">Power with a boundary</p>
            <h2 id="live-dialog-title">Live Mac can change your computer.</h2>
            <p>
              This opens a real zsh login shell with your user permissions. It can read, write, install, delete, authenticate, and contact the network exactly like Ghostty.
            </p>
            <ul>
              <li>Bound to 127.0.0.1 only</li>
              {pairedFromHostedPage ? <li>Terminal traffic stays between this browser and your Mac; Vercel never receives it</li> : null}
              {pairedFromHostedPage ? <li>Chrome will ask for Local Network Access after you continue; choose Allow in the address-bar prompt</li> : null}
              <li>One browser session and one-time 30-second ticket</li>
              <li>No automatic command execution from lessons</li>
              <li>Closes after 20 minutes without keyboard activity</li>
            </ul>
            <label htmlFor="live-phrase">Type <code>LIVE</code> to continue</label>
            <input
              id="live-phrase"
              ref={liveInputRef}
              value={livePhrase}
              onChange={(event) => setLivePhrase(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="dialog-actions">
              <button className="secondary-button" onClick={closeLiveDialog}>Stay in Practice</button>
              <button className="danger-button" disabled={livePhrase !== "LIVE"} onClick={beginLive}>Open Live Mac</button>
            </div>
          </section>
        </div>
      ) : null}

      {pairingHelpOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closePairingHelp()}>
          <section ref={pairingHelpDialogRef} className="live-dialog pairing-dialog" role="dialog" aria-modal="true" aria-labelledby="pairing-dialog-title">
            <button ref={pairingHelpCloseRef} className="dialog-close" onClick={closePairingHelp} aria-label="Close Live Mac pairing instructions">×</button>
            <span className="danger-orbit pairing-orbit" aria-hidden="true">↯</span>
            <p className="eyebrow">Vercel UI · local shell</p>
            <h2 id="pairing-dialog-title">Pair this Mac first.</h2>
            <p>Run this in Ghostty. It starts a five-minute, one-shot companion and opens a fresh paired page in Chrome:</p>
            <pre className="pairing-command"><code>terminal-wizard --hosted</code></pre>
            <p>Your terminal traffic stays between Chrome and <code>127.0.0.1</code>. Vercel never receives the pairing secret, keystrokes, or shell output.</p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={closePairingHelp}>Back to Practice</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
