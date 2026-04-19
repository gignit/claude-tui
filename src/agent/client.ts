/**
 * Thin wrapper around @anthropic-ai/claude-agent-sdk's `query()`.
 *
 * Responsibilities:
 *   - Open a single long-lived streaming-input session so multi-turn works.
 *   - Translate raw SDKMessage events into DisplayItem events the TUI renders.
 *   - Expose `submitUserMessage()` / `interrupt()` / `close()` for the UI.
 *   - Surface permission requests via callback so the TUI can prompt.
 *
 * Auth: we deliberately do NOT pass an apiKey. The SDK spawns the bundled
 * `claude` binary, which picks up OAuth credentials from `~/.claude/` (i.e.
 * the user's Claude Pro/Max subscription) when ANTHROPIC_API_KEY is unset.
 */

import { statSync } from "node:fs"
import { delimiter, join } from "node:path"
import { homedir } from "node:os"
import { query, type Query, type SDKMessage, type SDKUserMessage, type Options } from "@anthropic-ai/claude-agent-sdk"
import type { AgentEvent, DisplayItem, PermissionRequest } from "./types.ts"
import { type AgentMode, modeFromSdk, modeToSdk } from "./modes.ts"
import { dlog, isDebugEnabled } from "../util/debug-log.ts"
import { stripAnsi } from "../util/ansi.ts"

export interface AgentClientConfig {
  cwd?: string
  model?: string
  /**
   * Resume a prior session by UUID. The SDK will replay the session's
   * prior turns through the same NDJSON event stream as `assistant` /
   * `user` messages — our translator handles them indistinguishably from
   * live events, so the TUI's scrollback fills with the full history.
   */
  resume?: string
  /**
   * If you want to pre-approve tools and skip the permission UI entirely,
   * pass `permissionMode: "acceptEdits"` or `"bypassPermissions"`. Default
   * is `"default"` which routes everything through `canUseTool`.
   */
  permissionMode?: Options["permissionMode"]
  /** Forwarded to the SDK if non-empty. */
  allowedTools?: string[]
  /**
   * Override path to the `claude` binary. If unset, we auto-detect from
   * (1) CLAUDE_TUI_BIN env var, (2) `which claude` on PATH, (3) the
   * conventional install location at ~/.local/bin/claude.
   * The SDK's bundled optional native package only ships for musl-linked
   * Linux; on glibc systems we have to point at an external install.
   */
  pathToClaudeCodeExecutable?: string
  /**
   * Called from the SDK's permission callback. Return true to allow the
   * tool call, false to deny. Default implementation auto-allows everything,
   * which is fine for a personal CLI but the TUI should override this.
   */
  onPermissionRequest?: (req: PermissionRequest) => Promise<boolean>
  /** Hook for every translated display event. */
  onEvent: (evt: AgentEvent) => void
}

function isExecutable(path: string): boolean {
  try {
    const s = statSync(path)
    return s.isFile() || s.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Locate a usable `claude` binary so the SDK can spawn it. Returns
 * `undefined` to let the SDK fall back to its bundled native binary
 * (which works on musl-linked systems but not glibc).
 */
export function findClaudeExecutable(): string | undefined {
  const fromEnv = process.env["CLAUDE_TUI_BIN"]
  if (fromEnv && isExecutable(fromEnv)) return fromEnv

  const pathDirs = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean)
  for (const dir of pathDirs) {
    const candidate = join(dir, "claude")
    if (isExecutable(candidate)) return candidate
  }

  const fallback = join(homedir(), ".local", "bin", "claude")
  if (isExecutable(fallback)) return fallback

  return undefined
}

/** Async iterator over user messages, fed by `submitUserMessage()`. */
class UserInputChannel implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = []
  private waiters: Array<(value: IteratorResult<SDKUserMessage>) => void> = []
  private closed = false

  push(msg: SDKUserMessage) {
    if (this.closed) throw new Error("UserInputChannel already closed")
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: msg, done: false })
    } else {
      this.pending.push(msg)
    }
  }

  close() {
    this.closed = true
    for (const w of this.waiters.splice(0)) {
      w({ value: undefined as any, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const ready = this.pending.shift()
        if (ready) return Promise.resolve({ value: ready, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as any, done: true })
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waiters.push(resolve)
        })
      },
    }
  }
}

let displayIdCounter = 0
function nextDisplayId(prefix: string): string {
  displayIdCounter += 1
  return `${prefix}-${Date.now()}-${displayIdCounter}`
}

export interface AgentClient {
  submitUserMessage(text: string): void
  interrupt(): Promise<void>
  close(): void
  /** Switch the model for subsequent assistant turns. Streaming-input only. */
  setModel(model?: string): Promise<void>
  /** Switch the agent mode (Default ↔ Plan) for subsequent turns. */
  setMode(mode: AgentMode): Promise<void>
  /** Fetch the SDK's current view of available models. */
  listModels(): Promise<Array<{ id: string; displayName: string; description: string }>>
  /** Resolves once the underlying query iterator finishes (e.g. on close). */
  done: Promise<void>
}

export function createAgentClient(config: AgentClientConfig): AgentClient {
  const channel = new UserInputChannel()
  const emit = config.onEvent

  /**
   * In streaming-input mode the SDK requires us to pass an AsyncIterable
   * as the `prompt`. The first message in that stream is the first turn;
   * each subsequent push becomes the next turn.
   */
  const claudeBin = config.pathToClaudeCodeExecutable ?? findClaudeExecutable()
  const sdkOptions: Options = {
    cwd: config.cwd ?? process.cwd(),
    ...(config.model ? { model: config.model } : {}),
    ...(claudeBin ? { pathToClaudeCodeExecutable: claudeBin } : {}),
    ...(config.resume ? { resume: config.resume } : {}),
    // Only ask the subprocess for verbose stderr diagnostics when the
    // user opted into debug mode. Otherwise leave the env alone so we
    // don't generate noise we then have to filter out of the TUI.
    env: {
      ...process.env,
      ...(isDebugEnabled()
        ? { DEBUG_CLAUDE_AGENT_SDK: process.env["DEBUG_CLAUDE_AGENT_SDK"] ?? "1" }
        : {}),
    },
    permissionMode: config.permissionMode ?? "default",
    ...(config.allowedTools && config.allowedTools.length > 0
      ? { allowedTools: config.allowedTools }
      : {}),
    canUseTool: async (toolName, input, opts) => {
      const handler = config.onPermissionRequest
      if (!handler) return { behavior: "allow", updatedInput: input }
      const allowed = await new Promise<boolean>((resolve) => {
        const request: PermissionRequest = {
          toolName,
          input,
          ...(opts.title ? { title: opts.title } : {}),
          ...(opts.description ? { description: opts.description } : {}),
          toolUseId: opts.toolUseID,
          resolve,
        }
        handler(request).then(resolve).catch(() => resolve(false))
      })
      return allowed
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "denied by user" }
    },
    stderr: (chunk) => {
      // Always mirror to the debug log (cheap, gated to a file when
      // --debug is on). Only surface in the TUI when --debug is enabled
      // — otherwise the subprocess's verbose chatter floods the
      // conversation panel.
      dlog("sdk.subprocess.stderr", { chunk: chunk.slice(0, 1024) })
      if (!isDebugEnabled()) return
      if (chunk.trim().length === 0) return
      emit({
        type: "appended",
        item: {
          kind: "system",
          id: nextDisplayId("sys"),
          text: chunk.trimEnd(),
          createdAt: Date.now(),
        },
      })
    },
  }

  const q: Query = query({ prompt: channel, options: sdkOptions })

  // Track in-flight assistant message so streaming text appends to it.
  let currentAssistantId: string | null = null
  // Map SDK toolUseID → display tool_call id, so result events can find their call.
  const toolCallByUseId = new Map<string, string>()
  // Best-effort cache of the current agent mode. Updated on:
  //   (1) the SDK's init system message (initial value),
  //   (2) every `setMode()` call we issue,
  //   (3) Claude invoking the built-in plan_enter / plan_exit tools.
  // Used to stamp assistant messages so a Tab mid-conversation never
  // retroactively relabels older bubbles.
  let currentMode: AgentMode = modeFromSdk(sdkOptions.permissionMode)

  const consume = async () => {
    try {
      dlog("sdk.query.start", { cwd: sdkOptions.cwd, model: sdkOptions.model, claudeBin })
      emit({ type: "status", status: { kind: "idle" } })
      for await (const msg of q) {
        dlog("sdk.message", { type: msg.type, ...((msg as any).subtype ? { subtype: (msg as any).subtype } : {}) })
        translateSdkMessage(msg)
      }
      dlog("sdk.query.end", { reason: "iterator_done_clean" })
    } catch (err) {
      dlog("sdk.query.error", { message: err instanceof Error ? err.message : String(err) })
      emit({
        type: "appended",
        item: {
          kind: "error",
          id: nextDisplayId("err"),
          text: err instanceof Error ? err.message : String(err),
          createdAt: Date.now(),
        },
      })
      emit({ type: "status", status: { kind: "error", message: String(err) } })
    } finally {
      dlog("sdk.query.finally")
      emit({ type: "status", status: { kind: "idle" } })
    }
  }

  function translateSdkMessage(msg: SDKMessage) {
    switch (msg.type) {
      case "assistant": {
        const beta = msg.message
        // Stamp the model that produced this turn onto the assistant
        // bubble. We pull it off BetaMessage.model on every assistant
        // event; if the user runs /model mid-conversation the next turn
        // arrives with the new model, but this turn keeps the old one.
        const turnModel = typeof beta.model === "string" ? beta.model : undefined
        const turnMode = currentMode
        for (const block of beta.content) {
          if (block.type === "text") {
            appendAssistantText(block.text, turnModel, turnMode)
          } else if (block.type === "thinking") {
            appendAssistantThinking(block.thinking, turnModel, turnMode)
          } else if (block.type === "tool_use") {
            // Detect Claude's built-in mode-switch tools and update local
            // state so the status line reflects reality. The model can
            // call these tools to enter/exit plan mode mid-conversation
            // without the user toggling Tab.
            if (block.name === "plan_enter" && currentMode !== "plan") {
              currentMode = "plan"
              emit({ type: "mode", mode: currentMode })
              dlog("agent.mode.auto", { mode: currentMode, source: "plan_enter" })
            } else if (block.name === "plan_exit" && currentMode !== "default") {
              currentMode = "default"
              emit({ type: "mode", mode: currentMode })
              dlog("agent.mode.auto", { mode: currentMode, source: "plan_exit" })
            }
            const id = nextDisplayId("tool")
            toolCallByUseId.set(block.id, id)
            const item: DisplayItem = {
              kind: "tool_call",
              id,
              toolUseId: block.id,
              toolName: block.name,
              input: (block.input ?? {}) as Record<string, unknown>,
              resolved: false,
              createdAt: Date.now(),
            }
            emit({ type: "appended", item })
            emit({ type: "status", status: { kind: "tool_running", toolName: block.name } })
          }
        }
        break
      }

      case "user": {
        // The SDK echoes user-side tool_result blocks back through `user` messages.
        // We intercept those here; the original user text we already rendered
        // optimistically in submitUserMessage().
        const content = msg.message.content
        if (typeof content === "string") return
        for (const block of content) {
          if (block.type === "tool_result") {
            const callId = toolCallByUseId.get(block.tool_use_id)
            if (callId) {
              emit({ type: "updated", id: callId, patch: { resolved: true } as Partial<DisplayItem> })
            }
            const item: DisplayItem = {
              kind: "tool_result",
              id: nextDisplayId("res"),
              toolUseId: block.tool_use_id,
              // Strip ANSI: tool output frequently contains SGR color
              // codes (e.g. ripgrep's --color=auto, /context output's
              // 256-color gradient) that opentui's text renderer eats
              // partially, leaving garbled parameter digits as text.
              output: stripAnsi(stringifyToolResult(block.content)),
              isError: !!block.is_error,
              createdAt: Date.now(),
            }
            emit({ type: "appended", item })
          }
        }
        break
      }

      case "result": {
        // End-of-turn marker. Drop streaming-text accumulator so the next
        // assistant turn starts a fresh bubble.
        if (currentAssistantId) {
          emit({ type: "updated", id: currentAssistantId, patch: { complete: true } as Partial<DisplayItem> })
          currentAssistantId = null
        }
        emit({ type: "status", status: { kind: "idle" } })
        // Refresh context usage after every turn ends — that's when it
        // could have changed (new prompt + assistant text + tool calls).
        // Fire and forget; the response posts a context event.
        void refreshContextUsage()
        break
      }

      case "system": {
        // We capture the active model, permissionMode, and session id
        // from the init event so the status line has something to show
        // before the first assistant turn. No notice appended; per-message
        // stamps are the user-visible source of truth.
        if ("subtype" in msg && msg.subtype === "init") {
          const m = msg as {
            model?: string
            permissionMode?: Options["permissionMode"]
            session_id?: string
          }
          if (m.model) emit({ type: "model", model: m.model })
          if (m.permissionMode) {
            currentMode = modeFromSdk(m.permissionMode)
            emit({ type: "mode", mode: currentMode })
          }
          if (m.session_id) emit({ type: "session", sessionId: m.session_id })
          // Initial context-usage fetch — gives the status bar a number
          // to show before the first user turn.
          void refreshContextUsage()
        }
        break
      }

      case "stream_event": {
        // Optional partial-message events. We ignore them; the assistant
        // event already gives us text per turn-completion.
        break
      }

      default:
        // Unknown / new SDK event type — ignore quietly.
        break
    }
  }

  /**
   * Pull the latest context usage from the SDK and emit a 'context'
   * event. Called after each result and after model/mode changes; no-op
   * if the SDK isn't ready yet (e.g. before the init message arrived).
   */
  async function refreshContextUsage() {
    try {
      const usage = await q.getContextUsage()
      emit({
        type: "context",
        usage: {
          totalTokens: usage.totalTokens,
          maxTokens: usage.maxTokens,
          percentage: usage.percentage,
        },
      })
      dlog("agent.context.refresh", {
        total: usage.totalTokens,
        max: usage.maxTokens,
        pct: usage.percentage,
      })
    } catch (err) {
      // Pre-init or transient SDK errors are normal; just log.
      dlog("agent.context.refresh.error", {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  function appendAssistantText(text: string, model: string | undefined, mode: AgentMode) {
    if (!currentAssistantId) {
      currentAssistantId = nextDisplayId("asst")
      emit({
        type: "appended",
        item: {
          kind: "assistant",
          id: currentAssistantId,
          text,
          complete: false,
          mode,
          ...(model ? { model } : {}),
          createdAt: Date.now(),
        },
      })
      emit({ type: "status", status: { kind: "streaming" } })
    } else {
      emit({
        type: "updated",
        id: currentAssistantId,
        patch: { text, mode, ...(model ? { model } : {}) } as Partial<DisplayItem>,
      })
    }
  }

  function appendAssistantThinking(thinking: string, model: string | undefined, mode: AgentMode) {
    if (!currentAssistantId) {
      currentAssistantId = nextDisplayId("asst")
      emit({
        type: "appended",
        item: {
          kind: "assistant",
          id: currentAssistantId,
          text: "",
          thinking,
          complete: false,
          mode,
          ...(model ? { model } : {}),
          createdAt: Date.now(),
        },
      })
    } else {
      emit({
        type: "updated",
        id: currentAssistantId,
        patch: { thinking, mode, ...(model ? { model } : {}) } as Partial<DisplayItem>,
      })
    }
    emit({ type: "status", status: { kind: "thinking" } })
  }

  const done = consume()

  return {
    submitUserMessage(text: string) {
      dlog("agent.submit", { length: text.length, preview: text.slice(0, 80) })
      // Optimistic UI: render user bubble immediately so the input box can clear.
      emit({
        type: "appended",
        item: {
          kind: "user",
          id: nextDisplayId("user"),
          text,
          createdAt: Date.now(),
        },
      })
      // Reset assistant accumulator so the next turn opens a new bubble.
      currentAssistantId = null
      channel.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        session_id: "",
      })
    },
    async interrupt() {
      try {
        await q.interrupt()
      } catch (err) {
        emit({
          type: "appended",
          item: {
            kind: "error",
            id: nextDisplayId("err"),
            text: `interrupt failed: ${err instanceof Error ? err.message : String(err)}`,
            createdAt: Date.now(),
          },
        })
      }
    },
    async setModel(model?: string) {
      try {
        await q.setModel(model)
        // The SDK does not echo a fresh init after setModel, so emit ourselves.
        if (model) emit({ type: "model", model })
        // Different model = different context window size; refresh.
        void refreshContextUsage()
      } catch (err) {
        emit({
          type: "appended",
          item: {
            kind: "error",
            id: nextDisplayId("err"),
            text: `setModel failed: ${err instanceof Error ? err.message : String(err)}`,
            createdAt: Date.now(),
          },
        })
      }
    },
    async setMode(mode: AgentMode) {
      try {
        await q.setPermissionMode(modeToSdk(mode))
        currentMode = mode
        emit({ type: "mode", mode })
        dlog("agent.mode.user", { mode })
      } catch (err) {
        emit({
          type: "appended",
          item: {
            kind: "error",
            id: nextDisplayId("err"),
            text: `setMode failed: ${err instanceof Error ? err.message : String(err)}`,
            createdAt: Date.now(),
          },
        })
      }
    },
    async listModels() {
      try {
        const models = await q.supportedModels()
        return models.map((m) => ({ id: m.value, displayName: m.displayName, description: m.description }))
      } catch (err) {
        emit({
          type: "appended",
          item: {
            kind: "error",
            id: nextDisplayId("err"),
            text: `listModels failed: ${err instanceof Error ? err.message : String(err)}`,
            createdAt: Date.now(),
          },
        })
        return []
      }
    },
    close() {
      dlog("sdk.client.close", { stack: new Error().stack?.split("\n").slice(1, 6).join(" | ") })
      channel.close()
      try {
        q.close()
      } catch {
        // best-effort
      }
    },
    done,
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return safeStringify(content)
  return content
    .map((part: any) => {
      if (part?.type === "text") return part.text
      if (part?.type === "image") return "[image]"
      return safeStringify(part)
    })
    .join("\n")
}
