# Terminal Tutor

A local, interactive field guide to Benjamin’s real developer setup:

```text
Ghostty → zsh + Starship → Herdr → OMP / Codex
                    └── mise → OMP, Codex, Node, pnpm, Bun, Go, Python
```

The terminal UI uses
[`wterm`](https://github.com/vercel-labs/wterm), its libghostty WASM core, and
`just-bash`. The app teaches the manifest-declared workstation in ten lessons
without requiring an account, deployment, pairing service, or remote server.

## Launch it

Apply the dotfiles, then run:

```bash
terminal-tutor
```

The installed launcher:

1. installs dependencies from `package-lock.json` only when the lock changes;
2. rebuilds only when the app or dotfiles revision changes;
3. trims build and test packages after a successful build, leaving only the
   63 MiB native PTY/WebSocket runtime;
4. starts the UI on `127.0.0.1:4317` and the PTY bridge on `127.0.0.1:4318`;
5. waits until both services are healthy; and
6. opens the fixed local URL in Chrome.

Keep the launching terminal window open. `Control-C` stops both services.

For app development:

```bash
terminal-tutor --dev
```

Use `terminal-tutor --production` to force a clean production build or
`terminal-tutor --check` to run the full release gate.

## Three levels of access

### Practice (default)

- An in-memory Bash-compatible model of the dotfiles repository; changes
  disappear on reload.
- No network configuration, native process access, or Mac credentials.
- The terminal parser is libghostty, so color, Unicode, and escape handling
  closely match Ghostty even though the shell itself is simulated.
- Lesson buttons insert commands but never press Return.
- Each submitted command executes exactly once. Only an exact required command
  that exits successfully in the active lesson earns progress.

Practice models the declared setup. It does not claim to prove the live Mac’s
current state; use Live Mac for deliberate verification.

### Read-only folder snapshot

Chrome can optionally expose a user-selected project through the File System
Access API. Raw handles remain module-private; React and wterm receive only
frozen text records mounted below `/workspace`.

The scanner requests read access only, bounds depth, entries, individual files,
and total decoded bytes, rejects binary or invalid UTF-8, strips terminal
controls, and blocks or redacts common credential patterns. Heuristics cannot
recognize every secret, so choose a narrow project or dotfiles directory—never
your home directory. The browser uses a point-in-time copy; choose **Refresh
Practice snapshot** after files change on disk.

### Live Mac (explicit opt-in)

Live Mac opens a real `/bin/zsh -l` PTY with the user’s full permissions. You
must freshly type `LIVE` before each activation. The shell starts at the
dotfiles root so course paths match Practice. Live exploration intentionally
does not earn course credit until command outcomes can be authenticated.

The local bridge:

- binds only to `127.0.0.1:4318`;
- checks the exact local Origin, Host, WebSocket path, and loopback peer;
- mints a single-use 256-bit protocol ticket that expires after 30 seconds;
- allows one active session, disables compression, and caps messages and
  buffered output;
- closes after 20 minutes without keyboard activity and has start and absolute
  session deadlines;
- passes an explicit environment allowlist rather than server or developer
  secrets; and
- never reconnects or executes lesson commands automatically.

Treat Live Mac exactly like a Ghostty window. The browser UI is not a sandbox
once it is connected.

## Local state

Course progress stays in `localStorage`. A selected folder handle may be stored
in IndexedDB and still requires Chrome’s browser permission. Use **Forget
folder** in the app and Chrome site settings to remove both the remembered
handle and browser-level permission.

There is no analytics, cloud sync, hosted Tutor, or remote terminal endpoint.
The only network capability in the UI is the loopback connection to the owned
local PTY service; commands entered in Live Mac retain their normal shell
network access.

## Verification

```bash
npm run check
```

The gate runs TypeScript, ESLint, launcher and policy tests, unit and component
tests for folder races, consent, and progress, adversarial PTY boundary tests,
a production Vite build, local HTML/security-header and WASM checks, and both
runtime and full dependency audits. Lifecycle-script policy fails closed on
malformed npm output or an unreviewed package.

## Key dependencies

- `@wterm/*` 0.3.3
- libghostty core built from Ghostty 1.3.1
- `just-bash` 2.14.5
- React 19.2.8
- Vite 8.2.1
- `node-pty` 1.1.0 / `ws` 8.21.3

Runtime fonts, WASM, CSS, and scripts are all served from the loopback-only
local app. Redistributed WASM attribution and complete license texts are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
