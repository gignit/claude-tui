/**
 * Filesystem-based session discovery for the current project.
 *
 * Claude Code persists every session to:
 *   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 *
 * The encoding for <encoded-cwd> is just: replace every "/" and "." in
 * the absolute cwd with "-". So /home/alice/projects/foo.bar
 * becomes -home-alice-projects-foo-bar.
 *
 * We don't use the SDK for this — Query.supportedCommands/Models/Agents
 * exist but there's no listSessions method. Reading the directory
 * directly is reliable and matches what `claude --resume` itself reads.
 */

import { readdirSync, statSync } from "node:fs"
import { open } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export interface SessionSummary {
  /** Session UUID (the .jsonl filename without extension). */
  id: string
  /** First user message content, trimmed. Empty if not parseable. */
  preview: string
  /** ISO timestamp of the first user message, or undefined. */
  firstAt?: string
  /** File mtime — used as proxy for last-activity. */
  mtimeMs: number
  /** Absolute path to the .jsonl, for diagnostics. */
  path: string
}

/** Mirror Claude Code's project-dir naming convention. */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, "-")
}

/** Returns the absolute path to ~/.claude/projects/<encoded>. */
export function projectDirPath(cwd: string): string {
  return join(homedir(), ".claude", "projects", projectDirName(cwd))
}

/**
 * List sessions for the given cwd, newest first. Reads each file's first
 * lines just enough to extract the user-message preview. Bounded by
 * `limit` (default 50) to keep this snappy on machines with a lot of
 * history.
 */
export async function listSessions(cwd: string, limit = 50): Promise<SessionSummary[]> {
  const dir = projectDirPath(cwd)

  let entries: string[]
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
  } catch (err: any) {
    if (err?.code === "ENOENT") return []
    throw err
  }

  // Sort by mtime descending so we read previews for the most recent
  // sessions first; bail after `limit` to avoid stat-storming a giant
  // history directory.
  const stamped = entries
    .map((file) => {
      const path = join(dir, file)
      try {
        const s = statSync(path)
        return { file, path, mtimeMs: s.mtimeMs }
      } catch {
        return null
      }
    })
    .filter((x): x is { file: string; path: string; mtimeMs: number } => x !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)

  const results: SessionSummary[] = []
  for (const { file, path, mtimeMs } of stamped) {
    const id = file.replace(/\.jsonl$/, "")
    const { preview, firstAt } = await readSessionPreview(path)
    results.push({ id, preview, ...(firstAt ? { firstAt } : {}), mtimeMs, path })
  }
  return results
}

/**
 * Read the first ~16 lines of a session and return the first user
 * message's text + timestamp. Bounded to keep this cheap; users almost
 * always submit text in the first event or two.
 */
async function readSessionPreview(path: string): Promise<{ preview: string; firstAt?: string }> {
  let preview = ""
  let firstAt: string | undefined
  let fh: import("node:fs/promises").FileHandle | undefined
  try {
    fh = await open(path, "r")
    const buf = Buffer.alloc(16 * 1024)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    const head = buf.subarray(0, bytesRead).toString("utf8")
    const lines = head.split("\n").slice(0, 16)
    for (const raw of lines) {
      if (!raw.trim()) continue
      let parsed: any
      try {
        parsed = JSON.parse(raw)
      } catch {
        continue
      }
      if (parsed?.type !== "user") continue
      const content = parsed.message?.content
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter((b: any) => b?.type === "text")
                .map((b: any) => b.text)
                .join(" ")
            : ""
      if (!text) continue
      preview = text.replace(/\s+/g, " ").trim()
      if (typeof parsed.timestamp === "string") firstAt = parsed.timestamp
      break
    }
  } catch {
    // best-effort — leave preview empty
  } finally {
    await fh?.close().catch(() => {})
  }
  return { preview, ...(firstAt ? { firstAt } : {}) }
}
