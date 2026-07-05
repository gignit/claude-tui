/**
 * CLI entry. Parses minimal flags, applies the persisted state, then starts
 * the TUI.
 *
 * Model resolution (highest priority first):
 *   1. --model on the command line
 *   2. ~/.config/claude-tui/state.json:model (set the last time you used /model)
 *   3. nothing — let the SDK / `claude` binary use its own default
 *      (the user's `claude` config wins, e.g. `claude opus 4.7`).
 *
 * Auth note: we do NOT pass an API key. The Claude Agent SDK spawns the
 * bundled `claude` binary, which inherits OAuth credentials from
 * `~/.claude/` when ANTHROPIC_API_KEY is unset. So a user logged in via
 * `claude /login` with a Pro/Max subscription will use that subscription
 * here too.
 */

import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runTui } from "./tui/app.tsx"
import { EFFORT_LEVELS } from "./agent/types.ts"
import { levelToSdk, parsePermissionLevel } from "./agent/modes.ts"
import { loadState, statePath } from "./util/state-store.ts"
import { initDebugLog } from "./util/debug-log.ts"

interface Argv {
  cwd: string
  model?: string
  bin?: string
  scrollSpeed?: number
  permissionMode?: string
  debug: boolean
  debugLog?: string
  help: boolean
}

/**
 * Resolve `<project>/logs/claude-tui.log` regardless of where the user
 * invoked us from. `import.meta.url` points at this file (src/index.tsx),
 * so the project root is two `..` up from there.
 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_DEBUG_LOG = join(PROJECT_ROOT, "logs", "claude-tui.log")

function parseArgs(argv: readonly string[]): Argv {
  const out: Argv = {
    cwd: process.cwd(),
    debug: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--help" || a === "-h") out.help = true
    else if (a === "--debug") out.debug = true
    else if (a === "--cwd" && argv[i + 1]) {
      out.cwd = argv[++i]!
    } else if (a === "--model" && argv[i + 1]) {
      out.model = argv[++i]!
    } else if (a === "--bin" && argv[i + 1]) {
      out.bin = argv[++i]!
    } else if (a === "--debug-log" && argv[i + 1]) {
      out.debugLog = argv[++i]!
      out.debug = true
    } else if (a === "--permission-mode" && argv[i + 1]) {
      out.permissionMode = argv[++i]!
    } else if (a.startsWith("--permission-mode=")) {
      out.permissionMode = a.slice("--permission-mode=".length)
    } else if (a === "--dangerously-skip-permissions" || a === "--yolo") {
      out.permissionMode = "bypass"
    } else if (a === "--scroll-speed" && argv[i + 1]) {
      out.scrollSpeed = Number.parseInt(argv[++i]!, 10)
    } else if (a.startsWith("--model=")) {
      out.model = a.slice("--model=".length)
    } else if (a.startsWith("--cwd=")) {
      out.cwd = a.slice("--cwd=".length)
    } else if (a.startsWith("--bin=")) {
      out.bin = a.slice("--bin=".length)
    } else if (a.startsWith("--scroll-speed=")) {
      out.scrollSpeed = Number.parseInt(a.slice("--scroll-speed=".length), 10)
    } else if (a.startsWith("--debug-log=")) {
      out.debugLog = a.slice("--debug-log=".length)
      out.debug = true
    }
  }
  return out
}

function printHelp(): void {
  process.stdout.write(
    [
      "claude-tui — terminal UI for the Claude Agent SDK",
      "",
      "Usage: claude-tui [--cwd <dir>] [--model <id>] [--bin <path>] [--debug]",
      "",
      "Options:",
      "  --cwd <dir>           Working directory for the agent (default: current dir)",
      "  --model <id>          Model id (default: persisted choice, else `claude` default)",
      "  --bin <path>          Path to the `claude` binary (default: auto-detect from",
      "                        PATH or ~/.local/bin/claude; override with $CLAUDE_TUI_BIN)",
      "  --permission-mode <m> permission level: default | accept | bypass (persisted",
      "                        /permissions choice is used when the flag is omitted)",
      "  --dangerously-skip-permissions   shorthand for --permission-mode bypass",
      "  --scroll-speed <n>    Mouse-wheel lines per tick (1-20, default 3). Persists.",
      `  --debug               Log every event to ${DEFAULT_DEBUG_LOG}`,
      "                        and surface SDK subprocess stderr in the TUI",
      "  --debug-log <path>    Use a custom debug log path (implies --debug)",
      "  -h, --help            Show this help",
      "",
      "Hotkeys:",
      "  Enter                 submit message",
      "  Ctrl+J / Shift+Enter  insert a newline",
      "  Tab                   toggle agent mode (Default ↔ Plan)",
      "  Ctrl+K                open the command menu",
      "  /                     slash-command autocomplete in the prompt",
      "  Ctrl+O                toggle expand / collapse all tool output",
      "  Up / Down             recall prompt history (when the prompt is untouched)",
      "  Ctrl+C                clear the prompt; if empty, quit",
      "  Ctrl+D                quit",
      "  Esc                   stop the in-flight response; or close the top dialog",
      "  PageUp / PageDown     scroll the message log (mouse wheel also works)",
      "  Ctrl+Home / End       jump to top / bottom",
      "  y / n                 allow / deny when a permission prompt is showing",
      "  Mouse drag            select text; release auto-copies to clipboard",
      "",
      "Slash commands (typed into the prompt):",
      "  /menu                 open the command menu (also Ctrl+K)",
      "  /models               pick a model from your account's available list",
      "  /variant              set the model's reasoning-effort variant (low..max)",
      "  /sessions             resume a previous conversation (most recently updated first)",
      "  /fork                 branch the conversation into a new session",
      "  /rewind               restore files + conversation to a past turn",
      "  /context              show context usage (live count + CLI breakdown)",
      "  /compact              summarize the conversation to reclaim context",
      "  /scroll <n>           set mouse-wheel scroll speed (1-20 lines per tick)",
      "  /markdown [on|off]    toggle markdown rendering of assistant messages (default on)",
      "  /markdown-stream [on|off]   render markdown live during streaming (on) or only when",
      "                              the message completes (off). Default on.",
      "  /help                 list local commands",
      "  Anything else starting with / is forwarded to claude.",
      "",
      `State file: ${statePath()}`,
      "",
      "Auth: uses ~/.claude/ OAuth tokens by default (your Claude Pro/Max",
      "subscription). Set ANTHROPIC_API_KEY to switch to API billing.",
      "",
    ].join("\n"),
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  // Initialize debug logger before render() takes the screen so any open()
  // failure can still be reported on stderr.
  const debugPath = args.debug ? args.debugLog ?? DEFAULT_DEBUG_LOG : undefined
  initDebugLog(debugPath)
  if (debugPath) {
    process.stdout.write(
      `claude-tui: debug log -> ${debugPath}\n` +
        `(open another terminal and run: tail -f ${debugPath})\n`,
    )
  }
  const persisted = loadState()
  const model = args.model ?? persisted.model // undefined → SDK uses claude's default
  // Only forward a persisted effort if it's still a valid level — the
  // union may change across versions and a stale value would error the
  // whole query() spawn.
  const effort = EFFORT_LEVELS.find((l) => l === persisted.effort)
  // Permission level: flag > persisted (/permissions) > SDK default.
  // Unrecognized values (including "plan" — that's a mode, not a
  // level) warn and fall through rather than silently granting more or
  // less than the user asked for.
  const rawPermission = args.permissionMode ?? persisted.permissionMode
  const permissionLevel = rawPermission ? parsePermissionLevel(rawPermission) : undefined
  const permissionMode = permissionLevel ? levelToSdk(permissionLevel) : undefined
  if (rawPermission && !permissionLevel) {
    process.stderr.write(
      `claude-tui: unknown permission level '${rawPermission}' — using default. ` +
        `Valid: default, accept, bypass\n`,
    )
  }
  await runTui({
    cwd: args.cwd,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(args.bin ? { pathToClaudeCodeExecutable: args.bin } : {}),
    ...(args.scrollSpeed !== undefined && Number.isFinite(args.scrollSpeed)
      ? { scrollSpeed: args.scrollSpeed }
      : {}),
  })
}

main().catch((err) => {
  process.stderr.write(`claude-tui: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exit(1)
})
