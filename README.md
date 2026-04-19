# Claude Code TUI

An open-source terminal UI for **Claude Code**, built on Anthropic's
official **[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)**.

> **Status: bare-bones starter, initial push.** This is a working
> foundation — not a finished product. Everything you need for a daily
> chat-driven coding session is here, but there's plenty of room to
> improve. **Help wanted!** PRs, issues, ideas, and design feedback
> are all welcome.

---

## Why this exists

Claude Code's bundled TUI is great, but it's a black box. This project
gives you:

- A small, hackable TUI written entirely in TypeScript on top of the
  same agent runtime Anthropic ships, via the public Agent SDK.
- A starting point you can fork, theme, restyle, or extend without
  reverse-engineering anything.
- Direct, transparent control over the UX patterns: command menu,
  session switching, mode toggling, copy/paste, status display,
  keyboard layout. Tweak any of it.

---

## Marquee features

### Select-to-copy

Highlight any text in the terminal with the mouse — release the button
and it's already in your clipboard. Implemented via OSC 52 (works over
SSH and inside tmux) plus a native fallback (`pbcopy` / `wl-copy` /
`xclip` / `xsel` / `powershell`) for local terminals.

### Full session scrollback with resume

Every Claude Code conversation in your project is on disk at
`~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. Type
`/sessions` to open the picker — newest first, with first-message
preview and relative timestamp. Pick one and the SDK replays the
entire prior history into the scrollback. You can scroll all the way
back through every turn before continuing.

---

## Other things it does

- **Slash-command menu** with reactive registry (`Ctrl+K`). Built-in:
  `/menu`, `/models`, `/sessions`, `/help`. Adding a new one takes
  ~30 lines — see the playbook in `CLAUDE.md`.
- **Slash autocomplete** — typing `/` opens an inline overlay with
  matching commands; Tab to complete, Enter to fire.
- **Mode toggling** — `Tab` cycles between Default and Plan modes
  (the Agent SDK's `permissionMode`). Each assistant turn is stamped
  with the model + mode that produced it, so a mid-session switch
  never relabels older bubbles.
- **Per-message model attribution** — each completed assistant bubble
  shows `<mode> • <model>` underneath, so when you switch models the
  history stays accurate.
- **Inline permission prompts** (`y` / `n`) when a tool needs approval.
- **Mouse-wheel scrolling**, PageUp/PageDown, Ctrl+Home/End jumps.
- **Ctrl+O** to expand or collapse all tool output blocks.
- **Clean shutdown** via opentui's `renderer.destroy()` so the terminal
  isn't left in raw mode.

---

## Auth — uses your Claude subscription

The Agent SDK spawns Claude Code's `claude` binary, which inherits
credentials from `~/.claude/`. So:

- Already logged in via `claude /login` with a **Pro/Max subscription**?
  Usage bills against your subscription. No API key needed.
- `ANTHROPIC_API_KEY` set? Usage bills as pay-per-token API.
- Bedrock / Vertex / Foundry? Set the corresponding `CLAUDE_CODE_USE_*`
  env var.

If `claude` isn't on your `$PATH` and isn't at `~/.local/bin/claude`,
override with `--bin /path/to/claude` or set `CLAUDE_TUI_BIN`.

---

## Install

```bash
make install
```

That copies the source to `~/.local/share/claude-tui/`, runs `bun install`
there, and writes a launcher to `~/.local/bin/claude-tui`. Make sure
`~/.local/bin` is on your `PATH`.

```bash
make uninstall   # remove
make reinstall   # rebuild
PREFIX=/usr/local make install   # system-wide
```

### Run from a checkout (no install)

```bash
git clone git@github.com:gignit/claude-tui.git
cd claude-tui
bun install
bun start
```

Bun ≥ 1.2 is required.

---

## Hotkeys

| Key                  | Action                                                    |
| -------------------- | --------------------------------------------------------- |
| `Enter`              | Submit message                                            |
| `Ctrl+J`             | Insert a newline in the prompt                            |
| `Shift+Enter`        | Insert a newline (terminal-permitting fallback)           |
| `Tab`                | Cycle agent mode (Default ↔ Plan)                         |
| `Ctrl+K`             | Open the command menu                                     |
| `/`                  | Slash-command autocomplete in the prompt                  |
| `Ctrl+O`             | Toggle expand/collapse all tool output                    |
| `Ctrl+C`             | Clear the prompt; if empty, quit                          |
| `Ctrl+D`             | Quit                                                      |
| `Esc`                | Close the topmost dialog                                  |
| `PageUp` / `PageDown`| Scroll the message log                                    |
| `Ctrl+Home` / `End`  | Jump to top / bottom                                      |
| `y` / `n`            | Allow / deny when a permission prompt is showing          |
| Mouse wheel          | Scroll the message log                                    |
| Mouse drag           | Select text; release auto-copies to clipboard             |

## Slash commands

| Slash       | Action                                                            |
| ----------- | ----------------------------------------------------------------- |
| `/menu`     | Open the command menu (also `/commands`, `/palette` as aliases)   |
| `/models`   | Pick a model from your account's available list                   |
| `/sessions` | Resume a previous conversation in the current project             |
| `/help`     | Local-command reference                                           |

Anything else starting with `/` is forwarded as plain text to claude, so
its built-in slash commands continue to work.

---

## Stack

| Layer       | Library                                | Why |
| ----------- | -------------------------------------- | --- |
| Renderer    | `@opentui/core` + `@opentui/solid`     | Terminal UI primitives, mouse + keyboard |
| Reactivity  | `solid-js`                             | Fine-grained signals + JSX |
| Agent       | `@anthropic-ai/claude-agent-sdk`       | Spawns Claude Code, streams turns |
| Runtime     | [Bun](https://bun.sh) ≥ 1.2            | TS without a build step, fast IO |

Total: ~2.5k lines of TypeScript. Easy to read end-to-end.

---

## Contributing

This is an early starter — there's a lot of low-hanging fruit. Some
things I'd love to see PRs for:

- **Themes** — currently one hard-coded dark palette in `theme.tsx`.
  JSON theme loader + selector would be welcome.
- **Syntax highlighting** in tool output (opentui has `<code>` and
  `<markdown>` intrinsics waiting to be wired in).
- **Command history** in the prompt (Up/Down for previous submissions).
- **Filename / @-mention autocomplete** in the prompt.
- **Pasted content summarization** (long pastes → `[Pasted N lines]`).
- **Image paste** support.
- **`/diff`, `/redo`, `/fork`** — opencode-style session navigation.
- **Status bar polish** — context window usage, token count, cost.
- **Multi-workspace support** — list and switch between project dirs.
- **Tests** — currently none.

The architecture is documented in `CLAUDE.md`. New commands are
~30 lines; new dialogs use the shared `DialogSelect` primitive.

Open an issue first for big design changes; small fixes can go straight
to a PR.

---

## Layout

```
src/
  index.tsx                # CLI flag parsing + entry
  agent/
    client.ts              # createAgentClient() — wraps SDK query()
    types.ts               # display-layer message types
    modes.ts               # Default/Plan mode mapping
  tui/
    app.tsx                # render() + provider tree
    routes/
      chat.tsx             # main view: scrollback + prompt + status line
      commands.tsx         # built-in command registrations
    component/
      message.tsx          # per-DisplayItem rendering
      prompt.tsx           # textarea + slash autocomplete
      prompt-autocomplete  # inline `/` overlay
      status-line.tsx      # footer: mode, status, model, hints
      dialog-overlay.tsx   # modal stack renderer + breadcrumbs + [close]
      dialog-select.tsx    # reusable filter+list picker
      dialog-command.tsx   # the Ctrl+K menu
      dialog-model.tsx     # /models dialog
      dialog-session.tsx   # /sessions dialog
    context/
      theme.tsx            # static dark palette
      keybind.tsx          # action registry + matcher
      expand.tsx           # global expand-state (Ctrl+O)
      agent.tsx            # AgentProvider — owns the SDK client
      dialog.tsx           # dialog-stack context
      command.tsx          # command registry (slash + menu + trigger)
  util/
    clipboard.ts           # OSC52 + native copy
    debug-log.ts           # JSONL writer; off unless --debug
    exit.ts                # clean shutdown via renderer.destroy()
    state-store.ts         # ~/.config/claude-tui/state.json read/write
    sessions.ts            # ~/.claude/projects/<cwd-hash>/*.jsonl lister
```

## Debugging

```bash
claude-tui --debug
# in another terminal:
tail -f ~/.local/share/claude-tui/logs/claude-tui.log
```

`--debug` writes a JSONL log of every keystroke, prompt change, slash
match, dialog event, and SDK message to `<install>/logs/claude-tui.log`,
and surfaces SDK subprocess stderr inline as system notices in the TUI.
Without `--debug`, neither happens.

## Not affiliated with Anthropic

This is an unofficial, community project. It calls the official Agent
SDK as a regular consumer. It does not modify, fork, or deobfuscate
anything Anthropic ships. **Claude** and **Claude Code** are trademarks
of Anthropic.

## License

MIT — see `LICENSE`.
