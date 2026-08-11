"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commandMatches, lessons } from "@/app/data/lessons";
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
  WizardTerminal,
  type TerminalMode,
  type WizardTerminalHandle,
} from "@/app/components/WizardTerminal";

function isComplete(progress: Progress, lessonId: string, commandCount: number): boolean {
  const entries = progress[lessonId] ?? [];
  return entries.includes("__complete__") || entries.length >= commandCount;
}

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
    void restoreFolder()
      .then((snapshot) => {
        if (active && snapshot) setFolder(snapshot);
      })
      .catch(() => {
        if (active) setFolderMessage("The saved folder could not be restored. Choose it again when you are ready.");
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
    () => lessons.filter((lesson) => isComplete(progress, lesson.id, lesson.commands.length)).length,
    [progress],
  );
  const hasProgress = Object.values(progress).some((entries) => entries.length > 0);

  const resetAllProgress = () => {
    if (!hasProgress) return;
    if (!window.confirm("Reset all Terminal Wizard lesson progress?")) return;
    clearProgress(window.localStorage);
    setProgress({});
  };

  const recordCommand = useCallback((command: string) => {
    setProgress((current) => {
      const next: Progress = { ...current };
      for (const lesson of lessons) {
        lesson.commands.forEach((lessonCommand, index) => {
          if (!commandMatches(command, lessonCommand)) return;
          const entries = new Set(next[lesson.id] ?? []);
          entries.add(String(index));
          next[lesson.id] = [...entries];
        });
      }
      return next;
    });
  }, []);

  const markLessonComplete = () => {
    setProgress((current) => ({
      ...current,
      [selectedLesson.id]: [...new Set([...(current[selectedLesson.id] ?? []), "__complete__"])],
    }));
  };

  const chooseFolder = async () => {
    setFolderMessage("");
    const pending = connectFolder();
    setFolderBusy(true);
    try {
      const snapshot = await pending;
      setFolder(snapshot);
      setFolderRevision((revision) => revision + 1);
      setMode("practice");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFolderMessage(error instanceof Error ? error.message : "That folder could not be connected.");
    } finally {
      setFolderBusy(false);
    }
  };

  const reconnect = async () => {
    setFolderBusy(true);
    setFolderMessage("");
    try {
      const snapshot = await reconnectFolder();
      setFolder(snapshot);
      setFolderRevision((revision) => revision + 1);
      setMode("practice");
    } catch (error) {
      setFolderMessage(error instanceof Error ? error.message : "Chrome did not restore folder access.");
    } finally {
      setFolderBusy(false);
    }
  };

  const forget = async () => {
    await forgetFolder();
    setFolder(null);
    setFolderRevision((revision) => revision + 1);
    setFolderMessage("Folder forgotten here. Persistent browser permission can also be revoked in Chrome site settings.");
  };

  const beginLive = () => {
    if (livePhrase !== "LIVE") return;
    closeLiveDialog();
    setMode("live");
  };

  const lessonEntries = progress[selectedLesson.id] ?? [];
  const lessonComplete = isComplete(progress, selectedLesson.id, selectedLesson.commands.length);
  const practicedCount = selectedLesson.commands.filter((_, index) => lessonEntries.includes(String(index))).length;
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
          <span className="progress-copy" aria-label={`${completedLessons} of ${lessons.length} lessons complete`}><strong>{completedLessons}/{lessons.length}</strong> mastered</span>
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
              const complete = isComplete(progress, lesson.id, lesson.commands.length);
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
                    <span className="folder-state"><i /> Read-only snapshot ready</span>
                  ) : (
                    <button className="text-button" onClick={() => void reconnect()} disabled={folderBusy}>Reconnect in Chrome</button>
                  )}
                  <button className="text-button muted" onClick={() => void forget()}>Forget folder</button>
                </>
              ) : (
                <>
                  <p>Choose a narrow project or dotfiles folder—never your home directory. Common secrets are blocked or redacted; heuristics cannot guarantee every secret.</p>
                  <button className="folder-button" onClick={() => void chooseFolder()} disabled={!pickerSupported || folderBusy}>
                    {folderBusy ? "Reading safe files…" : pickerSupported ? "Choose folder" : "Chrome required"}
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
                <strong>Live Mac is real.</strong> Commands have your full user permissions. Lesson buttons still insert text only; press Return yourself.
              </div>
            ) : null}
            <WizardTerminal
              key={`${mode}:${folderRevision}`}
              ref={terminalRef}
              mode={mode}
              files={folder?.permission === "granted" ? folder.files : {}}
              onCommand={recordCommand}
            />
          </div>

          <article className="lesson-content">
            <div className="lesson-intro">
              <div>
                <p className="eyebrow">Lesson {selectedLesson.number} · {selectedLesson.kicker}</p>
                <h2>{selectedLesson.title}</h2>
                <p>{selectedLesson.summary}</p>
              </div>
              <div className={`lesson-score ${lessonComplete ? "complete" : ""}`}>
                <strong>{lessonComplete ? "Mastered" : `${practicedCount}/${selectedLesson.commands.length}`}</strong>
                <span>{lessonComplete ? "Nice. Keep using it." : "commands practiced"}</span>
              </div>
            </div>

            <div className="lesson-body">
              <section aria-labelledby="try-title">
                <div className="section-heading">
                  <div><span className="section-number">A</span><h3 id="try-title">Try these moves</h3></div>
                  <span>Insert ≠ run</span>
                </div>
                <div className="command-list">
                  {selectedLesson.commands.map((item, index) => {
                    const practiced = lessonEntries.includes(String(index));
                    return (
                      <div className={`command-row ${practiced ? "practiced" : ""}`} key={item.command}>
                        <div>
                          <code>{item.command}</code>
                          <p><strong>{item.label}</strong> — {item.detail}</p>
                        </div>
                        <button
                          onClick={() => {
                            terminalRef.current?.insertCommand(item.command);
                            terminalRef.current?.focus();
                          }}
                          aria-label={`Insert ${item.command} in the terminal without running it`}
                        >
                          {practiced ? "Again" : "Insert"}<span aria-hidden="true"> ↗</span>
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
                <button className={`master-button ${lessonComplete ? "complete" : ""}`} onClick={markLessonComplete} disabled={lessonComplete}>
                  {lessonComplete ? "✓ Lesson mastered" : "Mark as understood"}
                </button>
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
