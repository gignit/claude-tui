/**
 * Headless (non-TUI) mode: `--prompt` and/or `--debug --debug-options`.
 *
 * Runs the real AgentClient — spawning the claude subprocess with the same
 * config the TUI would use — WITHOUT taking over the screen. Two layers,
 * composable:
 *
 *   --prompt <text>            Single-turn non-interactive mode (the moral
 *                              equivalent of `claude -p`): submit the prompt,
 *                              stream the turn as plain text, exit.
 *   --debug-options <probe,…>  After the prompt turn (if any), print the data
 *                              a UI element would render and exit. With
 *                              --resume, probes report the resumed session's
 *                              state — so any feature can be tested at any
 *                              point in a session's life without TUI
 *                              navigation.
 *
 * Probes:
 *   panel   Everything the /controlpanel sidebar renders: session id +
 *           title, context usage, MCP servers, LSP servers, todos, and
 *           the cwd:branch footer.
 *   models  Every model the SDK reports for this account — what the
 *           /models picker shows (id, display name, resolved id,
 *           supported effort levels).
 *
 * Probe output is `panel.<field>: <value>` lines — stable enough to grep in
 * a verification script, human-readable enough to eyeball.
 *
 * Wire notes that shaped this design (verified against SDK 0.3.207):
 *   - The stream's system/init message does NOT arrive until the first user
 *     turn, so probes never gate on it. Control requests (mcp_status,
 *     context usage) are answered pre-turn.
 *   - `resume` does not replay prior turns as events; resumed todos/session
 *     data come from the JSONL transcript, same as the TUI does.
 */

import { homedir } from "node:os"
import { createAgentClient, fetchSessionTitle, type AgentClientConfig } from "../agent/client.ts"
import type { ContextUsage, McpServerInfo, TodoItem } from "../agent/types.ts"
import { currentGitBranch } from "../util/git.ts"
import { listLspServers } from "../util/lsp.ts"
import { readSessionHistory } from "../util/sessions.ts"

const PROBES = ["panel", "models"] as const
type Probe = (typeof PROBES)[number]

/** Cap on a --prompt turn; generous because real turns run tools. */
const TURN_TIMEOUT_MS = 300_000
/** Cap on each control-request probe fetch. */
const FETCH_TIMEOUT_MS = 15_000

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

export interface HeadlessOptions {
  /** Comma-separated probe names (--debug-options). */
  probes?: string
  /** Single prompt to run non-interactively (--prompt). */
  prompt?: string
}

export async function runHeadlessDebug(
  opts: HeadlessOptions,
  config: Omit<AgentClientConfig, "onEvent" | "onPermissionRequest" | "onQuestionRequest">,
): Promise<number> {
  const probes = (opts.probes ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  const unknown = probes.filter((p) => !(PROBES as readonly string[]).includes(p))
  if (unknown.length > 0) {
    process.stderr.write(
      `claude-tui: unknown --debug-options '${unknown.join(",")}' — valid: ${PROBES.join(", ")}\n`,
    )
    return 1
  }

  const out = (line: string) => process.stdout.write(line + "\n")
  const errOut = (line: string) => process.stderr.write(line + "\n")

  // State the probes read, filled by the same AgentEvents the TUI consumes.
  let sessionId: string | null = config.resume ?? null
  let sessionTitle: string | null = null
  let contextUsage: ContextUsage | null = null
  let todos: TodoItem[] = []
  let model: string | null = null
  let hadError = false
  // Streaming bookkeeping for --prompt: text accumulates via `updated`
  // patches; a bubble prints when it completes.
  const streamText = new Map<string, { text: string; printed: boolean }>()
  // Turn end = the turn_stamp item the client appends on `result`.
  let resolveTurn: () => void = () => {}
  const turnDone = new Promise<void>((resolve) => {
    resolveTurn = resolve
  })

  // Resume: seed the client's todo tracker from the transcript (the SDK
  // does not replay turns as events), so probes report the session's
  // todo state and a --prompt turn can TaskUpdate pre-resume tasks.
  let seedHistory: Awaited<ReturnType<typeof readSessionHistory>> = []
  if (config.resume) {
    try {
      seedHistory = await readSessionHistory(config.cwd ?? process.cwd(), config.resume)
    } catch {
      // Transcript unreadable — probes report live state only.
    }
  }

  const client = createAgentClient({
    ...config,
    ...(seedHistory.length > 0 ? { seedTodoHistory: seedHistory } : {}),
    // Headless has nobody to answer prompts. Deny loudly (stderr) so a
    // probe run never hangs; use --permission-mode accept/bypass when a
    // --prompt turn needs to use tools.
    onPermissionRequest: async (req) => {
      errOut(`[permission denied — headless] ${req.toolName}`)
      return false
    },
    onQuestionRequest: async () => null,
    onEvent: (evt) => {
      switch (evt.type) {
        case "session":
          sessionId = evt.sessionId
          break
        case "title":
          sessionTitle = evt.title
          break
        case "context":
          contextUsage = evt.usage
          break
        case "todos":
          todos = evt.todos
          break
        case "model":
          model = evt.model
          break
        case "appended":
          if (evt.item.kind === "error") {
            hadError = true
            errOut(`[error] ${evt.item.text}`)
          } else if (opts.prompt) {
            if (evt.item.kind === "assistant") {
              streamText.set(evt.item.id, { text: evt.item.text, printed: false })
            } else if (evt.item.kind === "tool_call") {
              errOut(`[tool] ${evt.item.toolName}`)
            } else if (evt.item.kind === "turn_stamp") {
              resolveTurn()
            }
          }
          break
        case "updated": {
          const st = streamText.get(evt.id)
          if (!st) break
          const patch = evt.patch as { text?: string; complete?: boolean }
          if (typeof patch.text === "string") st.text = patch.text
          if (patch.complete && !st.printed && st.text.trim().length > 0) {
            st.printed = true
            out(st.text)
          }
          break
        }
        case "status":
          if (evt.status.kind === "error") hadError = true
          break
      }
    },
  })

  if (opts.prompt) {
    client.submitUserMessage(opts.prompt)
    await withTimeout(turnDone, TURN_TIMEOUT_MS, undefined)
  }

  for (const probe of probes as Probe[]) {
    if (probe === "models") {
      const models = await withTimeout(client.listModels(), FETCH_TIMEOUT_MS, [])
      out(`models.count: ${models.length}`)
      for (const m of models) {
        out(
          `models.entry: ${m.id} — ${m.displayName}` +
            `${m.resolvedModel ? ` -> ${m.resolvedModel}` : ""}` +
            `${m.supportedEffortLevels?.length ? ` [${m.supportedEffortLevels.join(",")}]` : ""}`,
        )
      }
    }
    if (probe === "panel") {
      let servers = await withTimeout(client.listMcpServers(), FETCH_TIMEOUT_MS, [])
      // Right after spawn every server reports "pending" while it
      // connects; one settle-retry makes the snapshot far more useful.
      if (servers.some((s) => s.status === "pending")) {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        servers = await withTimeout(client.listMcpServers(), FETCH_TIMEOUT_MS, servers)
      }
      await withTimeout(client.refreshContext(), FETCH_TIMEOUT_MS, undefined)
      // refreshContext resolves after emitting its event, but give the
      // event dispatch a tick regardless.
      await new Promise((resolve) => setTimeout(resolve, 100))
      const branch = await currentGitBranch(config.cwd ?? process.cwd())
      const lsp = listLspServers()
      const done = todos.filter((t) => t.status === "completed").length
      // Read through typed locals — TS can't see the closure assignments
      // above and would otherwise narrow these to their initial values.
      const usage = contextUsage as ContextUsage | null
      const fmtServer = (s: McpServerInfo) =>
        `${s.name} ${s.status}${s.toolCount !== undefined ? ` (${s.toolCount} tools)` : ""}` +
        `${s.scope ? ` [${s.scope}]` : ""}${s.error ? ` — ${s.error}` : ""}`
      // Prefer the hook-delivered title; fall back to the session store
      // (customTitle → auto summary → first prompt), same as the panel.
      const id = sessionId as string | null
      const storeTitle =
        sessionTitle ?? (id ? await fetchSessionTitle(id, config.cwd ?? process.cwd()) : null)
      out(`panel.session.id: ${id ?? "(none)"}`)
      out(`panel.session.title: ${storeTitle ?? "(untitled)"}`)
      out(`panel.model: ${model ?? "(unknown)"}`)
      out(
        usage
          ? `panel.context: ${usage.totalTokens} / ${usage.maxTokens} tokens (${Math.round(usage.percentage)}%)`
          : "panel.context: (no usage data)",
      )
      out(`panel.mcp.count: ${servers.length}`)
      for (const s of servers) out(`panel.mcp.server: ${fmtServer(s)}`)
      out(`panel.lsp.count: ${lsp.length}`)
      for (const s of lsp) {
        out(
          `panel.lsp.server: ${s.name}${s.languages.length > 0 ? ` (${s.languages.join(", ")})` : ""} ` +
            `${s.available ? "available" : "MISSING"} ${s.command} [${s.plugin}]`,
        )
      }
      out(`panel.todos.count: ${todos.length}${todos.length > 0 ? ` (${done} done)` : ""}`)
      for (const t of todos) out(`panel.todo: [${t.status}] ${t.content}`)
      const cwd = (config.cwd ?? process.cwd()).replace(homedir(), "~")
      out(`panel.footer: ${cwd}:${branch ?? "no git"}`)
    }
  }

  client.close()
  return hadError ? 1 : 0
}
