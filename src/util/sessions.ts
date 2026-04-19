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
import { open, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { DisplayItem } from "../agent/types.ts"

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
 * Parse a session JSONL file from disk into the DisplayItems we render
 * in the scrollback. Used by `agent.resumeSession()` — the SDK doesn't
 * echo prior turns through the live event stream when given `--resume`,
 * it only loads them into the model's context. So we parse the on-disk
 * transcript ourselves to populate the visual history.
 *
 * The on-disk format is one JSON object per line. Relevant types:
 *
 *   type:"user"              {message:{role,content}, timestamp, uuid, ...}
 *   type:"assistant"         {message:{role,content[]}, timestamp, uuid, ...}
 *   type:"queue-operation"   internal queueing housekeeping — skip
 *   type:"attachment"        deferred-tool / context attachment — skip
 *   type:"last-prompt"       checkpoint marker — skip
 *
 * Within user content, blocks of type:"tool_result" become tool_result
 * DisplayItems (linked back to their tool_use by tool_use_id). Plain
 * text content (string or text-block array) becomes a user bubble.
 *
 * Within assistant content, "text" blocks join into a single assistant
 * bubble per turn; "tool_use" blocks become tool_call DisplayItems;
 * "thinking" blocks are folded into the assistant bubble's `thinking`
 * field. Each assistant turn (one assistant entry in the JSONL) is one
 * bubble — we don't try to merge consecutive assistant entries.
 */
export async function readSessionHistory(cwd: string, sessionId: string): Promise<DisplayItem[]> {
  const path = join(projectDirPath(cwd), `${sessionId}.jsonl`)
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch {
    return []
  }

  const items: DisplayItem[] = []
  let counter = 0
  const nextId = (kind: string) => `replay-${kind}-${++counter}`

  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue
    let entry: any
    try {
      entry = JSON.parse(raw)
    } catch {
      continue
    }
    const type = entry?.type
    if (type !== "user" && type !== "assistant") continue
    const createdAt = parseTimestamp(entry?.timestamp) ?? Date.now()
    const content = entry?.message?.content

    if (type === "user") {
      // 1. Tool results — surfaced as their own DisplayItem (linked by tool_use_id).
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_result") {
            items.push({
              kind: "tool_result",
              id: nextId("res"),
              toolUseId: String(block.tool_use_id ?? ""),
              output: stringifyToolResult(block.content),
              isError: !!block.is_error,
              createdAt,
            })
          }
        }
      }
      // 2. Plain user text — render as a user bubble.
      const userText = extractUserText(content)
      if (userText) {
        items.push({
          kind: "user",
          id: nextId("user"),
          text: userText,
          createdAt,
        })
      }
      continue
    }

    // type === "assistant"
    if (!Array.isArray(content)) continue
    let bubbleText = ""
    let thinking = ""
    const turnModel = typeof entry.message?.model === "string" ? entry.message.model : undefined
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string") {
        bubbleText += block.text
      } else if (block?.type === "thinking" && typeof block.thinking === "string") {
        thinking += (thinking ? "\n" : "") + block.thinking
      } else if (block?.type === "tool_use") {
        items.push({
          kind: "tool_call",
          id: nextId("tool"),
          toolUseId: String(block.id ?? ""),
          toolName: String(block.name ?? "tool"),
          inputJson: safeStringify(block.input),
          // Marked resolved=true so we don't show the spinner for
          // historical tool calls.
          resolved: true,
          createdAt,
        })
      }
    }
    if (bubbleText || thinking) {
      items.push({
        kind: "assistant",
        id: nextId("asst"),
        text: bubbleText,
        complete: true,
        ...(thinking ? { thinking } : {}),
        ...(turnModel ? { model: turnModel } : {}),
        createdAt,
      })
    }
  }

  return items
}

function extractUserText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("")
    .trim()
}

function parseTimestamp(t: unknown): number | undefined {
  if (typeof t !== "string") return undefined
  const ms = Date.parse(t)
  return Number.isNaN(ms) ? undefined : ms
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return safeStringify(content)
  return content
    .map((part: any) => {
      if (part?.type === "text") return String(part.text ?? "")
      if (part?.type === "image") return "[image]"
      return safeStringify(part)
    })
    .join("\n")
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
