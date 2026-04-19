/**
 * Cross-platform clipboard copy.
 *
 * Strategy: always emit an OSC 52 escape sequence (works over SSH and in
 * any terminal that supports it), AND fire-and-forget a native copy helper
 * on the host. We don't await the native helper — selecting text should
 * feel instant and "best effort" is good enough for a chat-app copy.
 */

import { spawn } from "node:child_process"
import { platform } from "node:os"

/** Best-effort write to the OSC 52 clipboard sequence. Silent on failure. */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return
  const base64 = Buffer.from(text, "utf8").toString("base64")
  const osc52 = `\x1b]52;c;${base64}\x07`
  // tmux strips OSC sequences unless wrapped in a passthrough escape.
  const passthrough = process.env["TMUX"] || process.env["STY"]
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
  try {
    process.stdout.write(sequence)
  } catch {
    // Stream may be detached during shutdown — ignore.
  }
}

interface CopyHelper {
  cmd: string
  args: string[]
}

/**
 * Pick the first available native clipboard helper. Resolved once and
 * cached. Returns undefined if no helper is on PATH (we still get OSC 52).
 */
let cachedHelper: CopyHelper | null | undefined = undefined
function findNativeHelper(): CopyHelper | null {
  if (cachedHelper !== undefined) return cachedHelper
  const os = platform()
  const candidates: CopyHelper[] = (() => {
    if (os === "darwin") return [{ cmd: "pbcopy", args: [] }]
    if (os === "linux") {
      const list: CopyHelper[] = []
      if (process.env["WAYLAND_DISPLAY"]) list.push({ cmd: "wl-copy", args: [] })
      list.push({ cmd: "xclip", args: ["-selection", "clipboard"] })
      list.push({ cmd: "xsel", args: ["--clipboard", "--input"] })
      return list
    }
    if (os === "win32") {
      return [
        {
          cmd: "powershell.exe",
          args: [
            "-NonInteractive",
            "-NoProfile",
            "-Command",
            "[Console]::InputEncoding=[System.Text.Encoding]::UTF8;Set-Clipboard -Value ([Console]::In.ReadToEnd())",
          ],
        },
      ]
    }
    return []
  })()

  for (const helper of candidates) {
    if (commandExists(helper.cmd)) {
      cachedHelper = helper
      return helper
    }
  }
  cachedHelper = null
  return null
}

function commandExists(cmd: string): boolean {
  // `command -v` is portable across bash/zsh/dash. Returns 0 if found.
  const result = Bun.spawnSync({
    cmd: ["sh", "-c", `command -v ${JSON.stringify(cmd)}`],
    stdout: "ignore",
    stderr: "ignore",
  })
  return result.exitCode === 0
}

/**
 * Copy `text` to the system clipboard. Never throws — silently degrades.
 */
export function copyToClipboard(text: string): void {
  if (!text) return
  writeOsc52(text)
  const helper = findNativeHelper()
  if (!helper) return

  try {
    const proc = spawn(helper.cmd, helper.args, {
      stdio: ["pipe", "ignore", "ignore"],
      detached: false,
    })
    proc.on("error", () => {
      // Helper not actually executable. Future calls will still try OSC 52.
    })
    if (proc.stdin) {
      proc.stdin.write(text)
      proc.stdin.end()
    }
  } catch {
    // best-effort
  }
}
