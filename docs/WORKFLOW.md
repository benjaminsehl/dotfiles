# Workstation workflow

The setup has one reconciliation command:

```bash
apply
```

This deliberately gives the user-level command precedence over macOS's rarely
used `/usr/bin/apply` utility. The system utility remains available by its full
path.

It installs missing declared packages, restores explicit configuration links,
installs pinned runtimes and OMP, refreshes OMP's generated completion cache,
and reapplies the OMP/Codex Herdr integrations. It does not pull Git changes or
upgrade every package implicitly.

## Apply modes

```bash
apply --dry-run  # preview changes
apply            # reconcile missing or drifted state
apply --check    # test the repository and inspect the live workstation
apply --update   # reconcile, then update declared packages and runtime pins
```

Pull and review repository changes separately:

```bash
git -C ~/Sites/dotfiles pull --ff-only
git -C ~/Sites/dotfiles diff
apply --dry-run
apply
```

Keeping the pull explicit makes remote code reviewable before it can change the
machine. Updating runtime pins intentionally leaves a Git diff so the new
versions can be tested and committed.

## OMP ownership and updates

OMP is installed by mise from the official `can1357/oh-my-pi` GitHub release,
not by Homebrew. `config/mise/config.toml` pins the version and
`config/mise/mise.lock` pins the Intel and Apple Silicon download URLs and
SHA-256 checksums. OMP is exempt from the general seven-day release-age gate so
an intentionally reviewed security or compatibility update can be adopted
immediately; the version and lockfile remain exact and reviewable.

Zsh reads OMP completion data from
`~/.cache/zsh/site-functions/_omp`. The shell never invokes OMP to generate it:
bootstrap and `dev-update` refresh the file atomically, while `dev-doctor`
compares the cache with the active mise-managed executable. Credentials,
sessions, plugins, and agent state remain under `~/.omp` and are never moved or
tracked during an OMP binary migration.

On a Mac that previously installed OMP with Homebrew, apply the repository,
confirm `command -v omp` is the mise shim and `omp --version` is the declared
version, and only then remove the old Homebrew formula. `dev-doctor` reports a
duplicate installation until that one-time cleanup is complete; it never
removes either copy itself.

## Mole ownership and safe use

Mole is installed and updated only through the Brewfile. The dotfiles do not
invoke `mo update`, install a separate shell hook, or run maintenance during
startup or bootstrap. Homebrew already provides completions for both `mole`
and `mo`.

Read the current health summary without changing anything:

```bash
mo status
mo status --json | jq '.health_score'
```

`mo analyze` is interactive and lower-risk than direct cleanup, but confirmed
selections are moved to Trash. Review every selection before confirming it.

Cleanup, uninstall, optimize, purge, installer cleanup, and removal can change
or delete local data. Preview supported actions first—for example,
`mo clean --dry-run`—then review the targets and confirmation before
proceeding. `mo history` shows Mole's local operation log.

## Fast shell vocabulary

These short aliases are enabled only when their underlying tool exists:

| Command | Meaning |
| --- | --- |
| `e`, `n` | Open Neovim |
| `lg` | Open Lazygit |
| `sg` | Run structural search with ast-grep |
| `gs` | Concise Git status |
| `gd` | Current Git diff |
| `gl` | Recent Git history graph |
| `z name` | Jump to a frequently used directory |
| `Control-T` | Find a file with fzf |
| `Option-C` | Find and enter a directory with fzf |
| `Control-R` | Search command history with fzf |

The shell never downloads tools. Homebrew and mise work happens only when
`apply`, `apply --update`, or another explicit package command is run.

## Learn the setup

`manifest/setup.json` is the machine-readable teaching catalog. It describes
the installed tools, aliases, workflows, keyboard shortcuts, safety model, and
ordered practice paths. Terminal Tutor can use it directly instead of keeping
a second hard-coded description of the workstation.

The first suggested sequence is:

1. Know where you are.
2. Find anything and move quickly.
3. Work confidently with Git.
4. Use project runtimes without drift.
5. Run coding agents safely.
6. Keep the setup healthy.

Run `scripts/check-manifest` after editing the catalog. It rejects duplicate
identifiers and lesson references to tools that do not exist.

After `apply`, launch the local course with:

```bash
terminal-tutor
```

The command starts the interface and real-shell bridge on fixed loopback ports,
waits until both are healthy, and opens Chrome. Keep that terminal window open
while using Live Mac; `Control-C` stops both owned services cleanly.
