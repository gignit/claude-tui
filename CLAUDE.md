# claude-tui — Project Playbook

> Hand-written project guidance. Update freely.

## What this project is

A small terminal UI for the **Claude Agent SDK**. Runs on Bun. Stack:

| Layer | Library | Purpose |
| ----- | ------- | ------- |
| Renderer | `@opentui/core` + `@opentui/solid` | terminal rendering, mouse, keyboard |
| Reactivity | `solid-js` | signals, stores, JSX |
| Agent | `@anthropic-ai/claude-agent-sdk` | spawns the user's `claude` binary, streams turns |

The whole app is ~1.5k lines of TypeScript. We talk to the Claude runtime
through the public Agent SDK only — we don't fork, modify, or
deobfuscate the bundled product.

## Where to look first when adding a feature

1. **Browse `src/`.** Layout map is in the README under "Layout".
2. **Verify opentui APIs from the installed source** in
   `node_modules/@opentui/core/` and `node_modules/@opentui/solid/`.
   opentui is pre-1.0 and the docs are sparse — the type definitions
   and source files are the truth.
3. **Verify Agent SDK APIs from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.**
   The `Query` interface around line 1870 documents every control
   method (`setModel`, `setPermissionMode`, `interrupt`, `accountInfo`,
   `supportedModels`, `setMcpServers`, `close`, etc.).

## opentui pitfalls we have already hit

These are non-obvious. Save the rediscovery time.

| Symptom | Root cause | Fix |
| ------- | ---------- | --- |
| Enter inserts a newline instead of submitting | Default textarea binds `return → newline` (see `@opentui/core/src/renderables/Textarea.ts`'s `defaultTextareaKeybindings`) | Pass `keyBindings={[{name:"return",action:"submit"}]}` to `<textarea>` |
| Children stack horizontally inside `<box>` | Yoga's default `flexDirection` differs from CSS expectations; opentui benchmark code always sets it explicitly | Always set `flexDirection="column"` (or `"row"`) on layout boxes — don't rely on the default |
| Scrollbox content rendering BEHIND the prompt | I tried `contentOptions: { minHeight: "100%", justifyContent: "flex-end" }` to bottom-pin. It made content render outside the viewport. | Don't bottom-pin. Use a scrollbox with `flexGrow={1}` plus a sibling `<box flexShrink={0}>` footer. Use `gap={1}` for breathing room. |
| `onContentChange` callback receives no string | opentui's textarea emits `ContentChangeEvent` (no payload by design — see `EditBufferRenderable.ts`) | Read text from the ref: `textarea.plainText` |
| JSX intrinsics not typed (`<box>` doesn't exist on `JSX.IntrinsicElements`) | Wrong jsxImportSource | `tsconfig.json: jsxImportSource: "@opentui/solid"` AND `bunfig.toml: preload = ["@opentui/solid/preload"]` |
| Bundled SDK can't find a `claude` binary on glibc Linux | The SDK ships `@anthropic-ai/claude-agent-sdk-linux-x64-musl` as an optional native dep; not installed on glibc systems | Auto-detect a `claude` on PATH or `~/.local/bin/claude` and pass `pathToClaudeCodeExecutable` to `query()`. See `findClaudeExecutable()` in `src/agent/client.ts`. |
| Solid disposes unrelated owners (e.g. dialog opens → agent provider closes) | Bun resolved `solid-js` to its SSR build (`dist/server.js`) by default | Force the browser/reactive build via `--conditions=browser` (set in `package.json` scripts and `bin/claude-tui`) and `customConditions: ["browser"]` in `tsconfig.json` |
| Dialog body crashes with `useX() called outside <XProvider>` | The DialogProvider's overlay JSX renders inside DialogProvider's scope, OUTSIDE later providers (CommandProvider, AgentProvider) | Render the overlay (`DialogOverlay`) at the bottom of the provider tree alongside `<Chat />`, not inside DialogProvider. DialogProvider exposes context only. |

## How to add a new feature: standard workflow

1. **Decide where state lives.**
   - Per-render? local `createSignal`.
   - Cross-component, ephemeral? new context provider in `src/tui/context/`.
   - Persists across runs? add a field to `PersistedState` in
     `src/util/state-store.ts`.
2. **If it talks to the SDK**, extend `AgentClient` (in
   `src/agent/client.ts`) — keep the SDK message shapes confined to that
   file. The TUI must only see DisplayItems / AgentEvents.
3. **If it's user-invocable**, register it in `src/tui/routes/commands.tsx`
   so it shows up in Ctrl+K and `/` autocomplete:
   ```tsx
   {
     value: "thing.do",
     title: "Do thing",
     description: "...",
     category: "App",
     slash: { name: "do-thing" },
     opensDialog: true,         // if onSelect pushes a sub-dialog
     onSelect: () => dialog.push(() => <YourDialog />, { title: "Do thing" }),
   }
   ```
4. **If it adds a global hotkey**, add an Action to `keybind.tsx`'s
   `BINDINGS` and handle it in `chat.tsx`'s `useKeyboard`.
5. **Wire it through the provider tree in `src/tui/app.tsx`** if it needs
   a new context.
6. **Run `bun run typecheck`** — must be exit 0 before testing.
7. **Add `dlog(...)` calls at the boundary** so `--debug` shows what
   happened. Categories already in use: `key`, `key.action`, `prompt.*`,
   `agent.*`, `sdk.*`, `clipboard.*`, `expand.*`, `command.*`, `dialog.*`.

## Debugging a live TUI

The TUI owns the screen, so `console.log` is forbidden — it corrupts the
display. Always:

1. Launch with `bun start --debug`. Default log: `<project>/logs/claude-tui.log`.
2. From a second terminal: `tail -f <project>/logs/claude-tui.log`
3. Add `dlog("category", { ... })` wherever you need visibility. Use a
   fresh category prefix per subsystem.
4. `dlog` truncates strings >2 KB and recurses 4 levels deep — safe to
   log raw SDK messages.

## Things NOT to do

- Don't `console.log` from inside the TUI — corrupts the screen.
- Don't add `pathToClaudeCodeExecutable` defaults that hardcode Anthropic
  binary paths — use the auto-detect helper.
- Don't pass `model:` to `query()` unless the user explicitly chose one.
  An undefined model means "use the user's `claude` default".
- Don't bottom-pin the scrollbox via `contentOptions: { minHeight }`. We
  tried, it broke. Top-stack + `stickyStart="bottom"` is correct.
- Don't put more than `Enter` and one `newline` binding on the textarea
  unless you fully merge with `defaultTextareaKeybindings` — opentui
  merges your overrides on top of its defaults automatically.
- Don't render dialog overlays inside `DialogProvider`. They must mount
  at the bottom of the provider tree so dialog factories can use every
  context (Agent, Command, Theme, Expand, …) without crashing.
- Don't drop the `--conditions=browser` flag from the `package.json`
  scripts or the launcher. Without it, Bun loads Solid's SSR build and
  everything breaks subtly.

## Quick links

- opentui core source (read-only): `node_modules/@opentui/core/`
- Agent SDK types: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
- Persistent state: `~/.config/claude-tui/state.json`
- Debug log (when `--debug`): `<project>/logs/claude-tui.log`
- Conversation transcripts (read by `/sessions`): `~/.claude/projects/<encoded-cwd>/*.jsonl`
