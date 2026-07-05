/**
 * SolidJS context wrapping the AgentClient. Holds the live scrollback,
 * status, model, mode, and session id as reactive signals so any
 * component can read them.
 *
 * Session switching: `resumeSession(id)` tears down the current
 * AgentClient (which closes the underlying claude subprocess), wipes
 * the items store, then spins up a new AgentClient with `resume: id`.
 * The SDK replays the prior turns through its NDJSON stream as
 * `assistant` / `user` events; our existing translator turns them into
 * DisplayItems indistinguishable from live ones, so the scrollback
 * fills with the full history naturally.
 */

import { createContext, useContext, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createAgentClient, type AgentClient, type AgentClientConfig } from "../../agent/client.ts"
import type {
  AgentStatus,
  ContextUsage,
  DisplayItem,
  EffortLevel,
  ModelChoice,
  PermissionRequest,
  QuestionRequest,
} from "../../agent/types.ts"
import { type AgentMode, nextMode } from "../../agent/modes.ts"
import { saveState } from "../../util/state-store.ts"
import { readSessionHistory } from "../../util/sessions.ts"
import { dlog } from "../../util/debug-log.ts"

export interface AgentContextValue {
  items: DisplayItem[]
  status: () => AgentStatus
  pendingPermission: () => PermissionRequest | null
  /**
   * In-flight AskUserQuestion. The chat route mounts a question dialog
   * whenever this is non-null; the dialog calls `request.resolve(...)`
   * to feed answers back to the SDK.
   */
  pendingQuestion: () => QuestionRequest | null
  /** Active model id reported by the SDK, or null until the init event arrives. */
  model: () => string | null
  /** Active reasoning-effort variant, or null → model default. */
  effort: () => EffortLevel | null
  /** Active agent mode (Default ↔ Plan). Defaults to "default" until init. */
  mode: () => AgentMode
  /** Session UUID reported by the SDK init event, or null pre-init. */
  sessionId: () => string | null
  /** Working directory the agent was started with — for session-list scoping. */
  cwd: () => string
  /** Latest context-usage snapshot from the SDK; null until first refresh. */
  contextUsage: () => ContextUsage | null
  submit: (text: string) => void
  interrupt: () => Promise<void>
  setModel: (model: string) => Promise<void>
  /** Set the reasoning-effort variant; null → back to model default. Persists. */
  setEffort: (effort: EffortLevel | null) => Promise<void>
  setMode: (mode: AgentMode) => Promise<void>
  /** Cycle Default → Plan → Default. Wired to Tab. */
  cycleMode: () => Promise<void>
  /** Resume a different session by uuid. Wipes the current scrollback and replays. */
  resumeSession: (id: string) => Promise<void>
  /**
   * Branch the current session into a new session id (SDK forkSession).
   * Scrollback is preserved; subsequent turns land in the new session
   * while the original stays untouched on disk.
   */
  forkSession: () => Promise<void>
  /**
   * Rewind the current session to just before a user turn (see
   * RewindPoint). Restores checkpointed files to that turn first
   * (best-effort), then restarts the conversation truncated at the
   * anchor. anchorUuid null = rewind to before the first turn (fresh
   * session).
   */
  rewindSession: (point: import("../../util/sessions.ts").RewindPoint) => Promise<void>
  listModels: () => Promise<ModelChoice[]>
  /** Append a local-only notice to the scrollback (does not hit the SDK). */
  pushNotice: (text: string, tone?: "info" | "debug") => void
}

const AgentContext = createContext<AgentContextValue | null>(null)

export interface AgentProviderProps {
  children: JSX.Element
  config: Omit<AgentClientConfig, "onEvent" | "onPermissionRequest" | "onQuestionRequest">
}

export function AgentProvider(props: AgentProviderProps) {
  const [items, setItems] = createStore<DisplayItem[]>([])
  const [status, setStatus] = createSignal<AgentStatus>({ kind: "idle" })
  const [pendingPermission, setPendingPermission] = createSignal<PermissionRequest | null>(null)
  const [pendingQuestion, setPendingQuestion] = createSignal<QuestionRequest | null>(null)
  const [model, setModelSignal] = createSignal<string | null>(null)
  // Initial value comes from persisted state (threaded through config).
  // The SDK doesn't report effort back, so this signal is our source of
  // truth: what we sent at spawn, updated on every setEffort().
  const [effort, setEffortSignal] = createSignal<EffortLevel | null>(props.config.effort ?? null)
  const [mode, setModeSignal] = createSignal<AgentMode>("default")
  const [sessionId, setSessionIdSignal] = createSignal<string | null>(null)
  const [contextUsage, setContextUsageSignal] = createSignal<ContextUsage | null>(null)

  // Mutable reference: closed methods (submit/interrupt/setModel/etc.)
  // dereference via `client?.x()` at call time, so swapping the binding
  // for resumeSession() is safe.
  let client: AgentClient | null = null

  const startClient = (extra: Partial<AgentClientConfig>): void => {
    dlog("agent.client.start", { resume: extra.resume })
    // Tear down any previous client (closes the subprocess pipe).
    client?.close()
    setItems([])
    setStatus({ kind: "idle" })
    setPendingPermission(null)
    setPendingQuestion(null)
    setSessionIdSignal(null)
    setContextUsageSignal(null)
    // Keep model/mode signals as-is; they get overwritten by the next
    // init event anyway and showing "connecting…" briefly is fine.

    const config: AgentClientConfig = {
      ...props.config,
      ...extra,
      onPermissionRequest: (req) =>
        new Promise<boolean>((resolve) => {
          setPendingPermission({
            ...req,
            resolve: (allow) => {
              setPendingPermission(null)
              resolve(allow)
            },
          })
        }),
      // Surface AskUserQuestion calls as a pending dialog. The
      // DialogQuestion component (mounted by the chat route when
      // pendingQuestion() is non-null) calls request.resolve() to
      // either answer the questions or cancel.
      onQuestionRequest: (req) =>
        new Promise<Record<string, string> | null>((resolve) => {
          setPendingQuestion({
            ...req,
            resolve: (answers) => {
              setPendingQuestion(null)
              resolve(answers)
            },
          })
        }),
      onEvent: (evt) => {
        switch (evt.type) {
          case "appended":
            setItems(produce((arr) => arr.push(evt.item)))
            break
          case "updated":
            setItems(produce((arr) => {
              const idx = arr.findIndex((x) => x.id === evt.id)
              if (idx >= 0) Object.assign(arr[idx]!, evt.patch)
            }))
            break
          case "status":
            setStatus(evt.status)
            break
          case "permission":
            setPendingPermission(evt.request)
            break
          case "question":
            setPendingQuestion(evt.request)
            break
          case "model":
            setModelSignal(evt.model)
            break
          case "effort":
            setEffortSignal(evt.effort)
            break
          case "mode":
            setModeSignal(evt.mode)
            break
          case "session":
            setSessionIdSignal(evt.sessionId)
            break
          case "context":
            setContextUsageSignal(evt.usage)
            break
        }
      },
    }
    client = createAgentClient(config)
  }

  // Initial client.
  startClient({})

  onCleanup(() => {
    dlog("agent.provider.cleanup", { stack: new Error().stack?.split("\n").slice(1, 6).join(" | ") })
    client?.close()
  })

  const value: AgentContextValue = {
    get items() {
      return items
    },
    status,
    pendingPermission,
    pendingQuestion,
    model,
    effort,
    mode,
    sessionId,
    contextUsage,
    cwd: () => props.config.cwd ?? process.cwd(),
    submit: (text) => client?.submitUserMessage(text),
    interrupt: async () => {
      await client?.interrupt()
    },
    setModel: async (next) => {
      await client?.setModel(next)
      saveState({ model: next })
    },
    setEffort: async (next) => {
      await client?.setEffort(next)
      // `undefined` in the patch overwrites the key, and JSON.stringify
      // then drops it — so clearing to model-default removes the entry.
      saveState({ effort: next ?? undefined })
    },
    setMode: async (next) => {
      await client?.setMode(next)
    },
    cycleMode: async () => {
      await client?.setMode(nextMode(mode()))
    },
    resumeSession: async (id) => {
      dlog("agent.resumeSession", { id })
      // The SDK's --resume only loads the session into the model's
      // context — it doesn't echo prior turns through the live event
      // stream. So we read the on-disk JSONL transcript ourselves and
      // populate the scrollback before swapping the client.
      const cwd = props.config.cwd ?? process.cwd()
      let history: DisplayItem[] = []
      try {
        history = await readSessionHistory(cwd, id)
        dlog("agent.resumeSession.history", { count: history.length })
      } catch (err) {
        dlog("agent.resumeSession.history.error", {
          error: err instanceof Error ? err.message : String(err),
        })
      }
      startClient({ resume: id })
      // Seed the session id immediately — resuming keeps the same id,
      // and waiting for the SDK's init event (which may not arrive
      // until the first turn) left /rewind and /fork refusing with
      // "no active session" right after a resume. init still confirms
      // or corrects it when it lands. (forkSession deliberately does
      // NOT do this: the fork gets a NEW id only init can tell us.)
      setSessionIdSignal(id)
      // startClient already cleared the items store; refill with the
      // historical items we just parsed. The next live event from the
      // resumed subprocess will append after these.
      if (history.length > 0) {
        setItems(produce((arr) => {
          for (const item of history) arr.push(item)
        }))
      }
    },
    forkSession: async () => {
      const id = sessionId()
      if (!id) return
      dlog("agent.forkSession", { from: id })
      // Same shape as resumeSession, but with fork:true the SDK assigns
      // a fresh session id — the init event updates the signal.
      let history: DisplayItem[] = []
      try {
        history = await readSessionHistory(props.config.cwd ?? process.cwd(), id)
      } catch {
        /* fork still works without visual history */
      }
      startClient({ resume: id, fork: true })
      if (history.length > 0) {
        setItems(produce((arr) => {
          for (const item of history) arr.push(item)
        }))
      }
    },
    rewindSession: async (point) => {
      const id = sessionId()
      if (!id) return
      dlog("agent.rewindSession", { id, anchor: point.anchorUuid, user: point.userUuid })
      // 1. File restore MUST run on the live client — checkpoints belong
      //    to the running subprocess. Best-effort: a session started
      //    before checkpointing was enabled simply reports it can't.
      const files = await client?.rewindFiles(point.userUuid)
      value.pushNotice(`/rewind: files — ${files?.summary ?? "no client"}`)
      // 2. Restart the conversation truncated at the anchor. For the
      //    first user turn there is nothing before it — start fresh.
      if (point.anchorUuid === null) {
        startClient({})
        value.pushNotice("/rewind: conversation reset to the beginning (new session)")
        return
      }
      let history: DisplayItem[] = []
      try {
        history = await readSessionHistory(props.config.cwd ?? process.cwd(), id)
      } catch {
        /* scrollback prefill is cosmetic; the resume itself is what matters */
      }
      // Truncate the visual history at the picked user turn: drop the
      // (ordinal+1)-th user bubble and everything after it.
      let seen = 0
      let cut = history.length
      for (let i = 0; i < history.length; i++) {
        if (history[i]!.kind === "user") {
          if (seen === point.ordinal) {
            cut = i
            break
          }
          seen++
        }
      }
      startClient({ resume: id, resumeAt: point.anchorUuid })
      // Same optimistic seed as resumeSession — rewinding continues the
      // same session id, and a follow-up /rewind or /fork shouldn't have
      // to wait for the init event.
      setSessionIdSignal(id)
      const truncated = history.slice(0, cut)
      if (truncated.length > 0) {
        setItems(produce((arr) => {
          for (const item of truncated) arr.push(item)
        }))
      }
      value.pushNotice(`/rewind: conversation rewound to before turn ${point.ordinal + 1}`)
    },
    listModels: async () => (client ? client.listModels() : []),
    pushNotice: (text: string, tone: "info" | "debug" = "info") => {
      setItems(produce((arr) => arr.push({
        kind: "system",
        id: `local-${Date.now()}-${arr.length}`,
        text,
        tone,
        createdAt: Date.now(),
      })))
    },
  }

  return <AgentContext.Provider value={value}>{props.children}</AgentContext.Provider>
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error("useAgent() called outside <AgentProvider>")
  return ctx
}
