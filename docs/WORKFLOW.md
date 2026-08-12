# Workstation workflow

The setup has one reconciliation command:

```bash
apply
```

This deliberately gives the user-level command precedence over macOS's rarely
used `/usr/bin/apply` utility. The system utility remains available by its full
path.

It installs missing declared packages, restores explicit configuration links,
installs pinned runtimes, and reapplies the OMP/Codex Herdr integrations. It does
not pull Git changes or upgrade every package implicitly.

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
