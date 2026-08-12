"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lessons } from "@/app/data/lessons";
import { declaredToolCount, setupStack } from "@/app/data/setup-manifest";
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
  WizardTerminal,
  type TerminalMode,
  type WizardTerminalHandle,
} from "@/app/components/WizardTerminal";

export function TerminalWizard() {
  const [selectedId, setSelectedId] = useState(lessons[0].id);
  const [progress, setProgress] = useState<Progress>({});
  const [progressHydrated, setProgressHydrated] = useState(false);
  const [mode, setMode] = useState<TerminalMode>("practice");
  const [liveDialogOpen, setLiveDialogOpen] = useState(false);
  const [livePhrase, setLivePhrase] = useState("");
  const [folder, setFolder] = useState<FolderSnapshot | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderMessage, setFolderMessage] = useState("");
  const [folderRevision, setFolderRevision] = useState(0);
  const [pickerSupported, setPickerSupported] = useState(false);
  const terminalRef = useRef<WizardTerminalHandle>(null);
  const liveInputRef = useRef<HTMLInputElement>(null);
  const folderOperationRef = useRef(0);
  const selectedLesson = lessons.find((lesson) => lesson.id === selectedId) ?? lessons[0];
  const closeLiveDialog = useCallback(() => {
    setLiveDialogOpen(false);
    setLivePhrase("");
  }, []);

  useEffect(() => {
    let active = true;
    const supported = supportsFileSystemAccess();
    const progressTimer = window.setTimeout(() => {
      if (!active) return;
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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLiveDialog();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeLiveDialog, liveDialogOpen]);

  const completedLessons = useMemo(
    () => lessons.filter((lesson) => isLessonComplete(progress, lesson)).length,
    [progress],
  );
  const hasProgress = Object.values(progress).some((entries) => entries.length > 0);

  const resetAllProgress = () => {
    if (!hasProgress) return;
    if (!window.confirm("Reset all Terminal Wizard lesson progress?")) return;
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
    } catch (error) {
      if (folderOperationRef.current !== restoreOperation) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
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
    try {
      const snapshot = await reconnectFolder();
      if (folderOperationRef.current !== folderOperation) return;
      setFolder(snapshot);
      setFolderRevision((revision) => revision + 1);
      setMode("practice");
      if (snapshot.permission === "granted") {
        setFolderMessage(`Snapshot refreshed: ${snapshot.fileCount} safe text files are available under /workspace.`);
      } else if (snapshot.permission === "denied") {
        setFolderMessage("Folder access remains denied. No files are available under /workspace.");
      } else {
        setFolderMessage("Folder permission is still required. No files are available under /workspace.");
      }
    } catch (error) {
      if (folderOperationRef.current !== folderOperation) return;
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
    try {
      await forgetFolder();
      if (folderOperationRef.current !== folderOperation) return;
      setFolder(null);
      setFolderRevision((revision) => revision + 1);
      setFolderMessage("Folder forgotten here. Persistent browser permission can also be revoked in browser site settings.");
    } catch {
      if (folderOperationRef.current !== folderOperation) return;
      setFolderMessage("The browser could not forget the saved folder. Clear this site's stored data before relying on a reload to remove it.");
    } finally {
      if (folderOperationRef.current === folderOperation) setFolderBusy(false);
    }
  };

  const beginLive = () => {
    if (livePhrase !== "LIVE") return;
    closeLiveDialog();
    setMode("live");
  };

  const lessonEntries = progress[selectedLesson.id] ?? [];
  const requiredCommands = requiredLessonCommands(selectedLesson);
  const lessonComplete = isLessonComplete(progress, selectedLesson);
  const practicedCount = requiredCommands.filter((command) => lessonEntries.includes(command.id)).length;
  return (
    <main className="wizard-app">
      <a className="skip-link" href="#lesson-content">
        Skip to lesson
      </a>

      <header className="topbar">
        <a className="brand" href="#top" aria-label="Terminal Wizard home">
          <span className="brand-mark" aria-hidden="true">❯_</span>
          <span>Terminal Wizard</span>
        </a>
        <div className="stack-line" aria-label="Your terminal stack">
          {setupStack.map((tool, index) => (
            <Fragment key={tool}>
              {index > 0 ? <b>→</b> : null}
              <span>{tool}</span>
            </Fragment>
          ))}
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

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">A field guide to Benjamin’s real Mac</p>
          <h1>Own your terminal.</h1>
          <p className="hero-copy">
            Learn the small set of moves that makes a modern development machine feel like an extension of your hands—inside a safe shell that invites experiments.
          </p>
        </div>
        <div className="hero-facts" aria-label="Setup facts">
          <div><strong>{declaredToolCount}</strong><span>declared tools</span></div>
          <div><strong>0</strong><span>Fig hooks</span></div>
          <div><strong>1</strong><span>source of truth</span></div>
        </div>
      </section>

      <div className="learning-grid">
        <aside className="lesson-rail" aria-label="Lessons">
          <div className="rail-heading">
            <span>Course</span>
            <span>{Math.round((completedLessons / lessons.length) * 100)}%</span>
          </div>
          <nav>
            {lessons.map((lesson) => {
              const complete = isLessonComplete(progress, lesson);
              return (
                <button
                  className={`lesson-nav-item ${lesson.id === selectedLesson.id ? "active" : ""}`}
                  key={lesson.id}
                  onClick={() => setSelectedId(lesson.id)}
                  aria-current={lesson.id === selectedLesson.id ? "step" : undefined}
                >
                  <span className={`lesson-check ${complete ? "complete" : ""}`} aria-hidden="true">
                    {complete ? "✓" : lesson.number}
                  </span>
                  <span><small>{lesson.kicker}</small>{lesson.title}</span>
                </button>
              );
            })}
          </nav>

          <section className="folder-card" aria-labelledby="folder-title">
            <div className="folder-icon" aria-hidden="true">⌁</div>
            <div>
              <h2 id="folder-title">Real files, safe shell</h2>
              {folder ? (
                <>
                  <p><strong>{folder.label}</strong> · {folder.fileCount} text files · {folder.blockedCount} protected</p>
                  {folder.permission === "granted" ? (
                    <>
                      <span className="folder-state"><i /> Read-only snapshot ready{folder.remembered ? "" : " · session only"}</span>
                      <button className="text-button" onClick={() => void reconnect()} disabled={folderBusy}>
                        {folderBusy ? "Refreshing snapshot…" : "Refresh snapshot"}
                      </button>
                    </>
                  ) : (
                    <button className="text-button" onClick={() => void reconnect()} disabled={folderBusy}>Reconnect folder</button>
                  )}
                  <button className="text-button muted" onClick={() => void forget()} disabled={folderBusy}>Forget folder</button>
                  {folder.staleSavedHandle ? (
                    <p className="folder-message" role="alert">This snapshot is session-only, but the browser could not clear an older saved folder. Use Forget folder, or clear this site’s stored data.</p>
                  ) : !folder.remembered ? (
                    <p className="folder-message" role="status">The browser could not remember this folder. This snapshot lasts until the page reloads or closes.</p>
                  ) : null}
                  {folder.truncated ? (
                    <p className="folder-message" role="status">This snapshot reached a safety limit. Choose a narrower folder if you need a complete project view.</p>
                  ) : null}
                </>
              ) : (
                <>
                  <p>Choose a narrow project or dotfiles folder—never your home directory. Common secrets are blocked or redacted; heuristics cannot guarantee every secret.</p>
                  <button className="folder-button" onClick={() => void chooseFolder()} disabled={!pickerSupported || folderBusy}>
                    {folderBusy ? "Reading safe files…" : pickerSupported ? "Choose folder" : "Folder access unavailable"}
                  </button>
                </>
              )}
              {folderMessage ? <p className="folder-message" role="status">{folderMessage}</p> : null}
            </div>
          </section>
        </aside>

        <section className="workspace" id="lesson-content">
          <div className="terminal-card">
            <div className="terminal-toolbar">
              <div className="window-dots" aria-hidden="true"><span /><span /><span /></div>
              <div className="mode-switch" aria-label="Terminal access mode">
                <button className={mode === "practice" ? "active" : ""} onClick={() => setMode("practice")}>
                  <span className="shield-mark" aria-hidden="true">◇</span> Practice
                </button>
                <button className={mode === "live" ? "live-active" : ""} onClick={() => mode === "live" ? undefined : setLiveDialogOpen(true)}>
                  <span aria-hidden="true">●</span> Live Mac
                </button>
              </div>
              <span className={`terminal-mode-label ${mode}`}>
                {mode === "practice" ? "IN-MEMORY · NETWORK OFF" : "LIVE · FULL MAC ACCESS"}
              </span>
            </div>
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
              files={folder?.permission === "granted" ? folder.files : {}}
              onCommand={recordCommand}
            />
          </div>

          <article className="lesson-content">
            <div className="lesson-intro">
              <div>
                <p className="eyebrow">Lesson {selectedLesson.number} · {selectedLesson.kicker} · {selectedLesson.level} · {selectedLesson.minutes} min</p>
                <h2>{selectedLesson.title}</h2>
                <p>{selectedLesson.summary}</p>
              </div>
              <div className={`lesson-score ${lessonComplete ? "complete" : ""}`}>
                <strong>{lessonComplete ? "Complete" : `${practicedCount}/${requiredCommands.length}`}</strong>
                <span>{lessonComplete ? "All required moves completed." : "successful required commands"}</span>
              </div>
            </div>

            <div className="lesson-body">
              <section aria-labelledby="try-title">
                <div className="section-heading">
                  <div><span className="section-number">A</span><h3 id="try-title">Try these moves</h3></div>
                  <span>Practice success earns progress</span>
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
                          : "Practice for credit · Live to explore";
                    return (
                      <div className={`command-row ${practiced ? "practiced" : ""} ${available ? "" : "unavailable"}`} key={item.command}>
                        <div>
                          <div className="command-heading"><code>{item.command}</code><span className={`command-access ${requiredMode}`}>{accessLabel}</span></div>
                          <p><strong>{item.label}</strong> — {item.detail}</p>
                        </div>
                        <button
                          disabled={!available}
                          onClick={() => {
                            if (!available) return;
                            terminalRef.current?.insertCommand(item.command);
                            terminalRef.current?.focus();
                          }}
                          aria-label={available ? `Insert ${item.command} in the terminal without running it` : `Switch to ${requiredMode} mode to use ${item.command}`}
                        >
                          {available ? (practiced ? "Again" : "Insert") : requiredMode === "live" ? "Use Live" : "Use Practice"}{available ? <span aria-hidden="true"> ↗</span> : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <aside className="field-notes" aria-labelledby="notes-title">
                <div className="section-heading"><div><span className="section-number">B</span><h3 id="notes-title">Field notes</h3></div></div>
                <p className="outcome"><span aria-hidden="true">◎</span><strong>Outcome</strong>{selectedLesson.outcome}</p>
                <ul>{selectedLesson.fieldNotes.map((note) => <li key={note}>{note}</li>)}</ul>
                <div className={`master-status ${lessonComplete ? "complete" : ""}`} role="status">
                  {lessonComplete
                    ? "✓ Every required Practice command succeeded"
                    : `${requiredCommands.length - practicedCount} required command${requiredCommands.length - practicedCount === 1 ? "" : "s"} left to complete this lesson`}
                </div>
              </aside>
            </div>
          </article>
        </section>
      </div>

      <footer>
        <p>Built around your declared setup · Progress stays in this browser · No analytics, cloud sync, or hidden network calls</p>
        <a href="https://github.com/vercel-labs/wterm">Powered by wterm</a>
      </footer>

      {liveDialogOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeLiveDialog()}>
          <section className="live-dialog" role="dialog" aria-modal="true" aria-labelledby="live-dialog-title">
            <button className="dialog-close" onClick={closeLiveDialog} aria-label="Close Live Mac warning">×</button>
            <span className="danger-orbit" aria-hidden="true">●</span>
            <p className="eyebrow">Power with a boundary</p>
            <h2 id="live-dialog-title">Live Mac can change your computer.</h2>
            <p>
              This opens a real zsh login shell with your user permissions. It can read, write, install, delete, authenticate, and contact the network exactly like Ghostty.
            </p>
            <ul>
              <li>Bound to 127.0.0.1 only</li>
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
    </main>
  );
}
