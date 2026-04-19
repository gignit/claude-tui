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
import type { AgentStatus, DisplayItem, PermissionRequest } from "../../agent/types.ts"
import { type AgentMode, nextMode } from "../../agent/modes.ts"
import { saveState } from "../../util/state-store.ts"
import { dlog } from "../../util/debug-log.ts"

export interface AgentContextValue {
  items: DisplayItem[]
  status: () => AgentStatus
  pendingPermission: () => PermissionRequest | null
  /** Active model id reported by the SDK, or null until the init event arrives. */
  model: () => string | null
  /** Active agent mode (Default ↔ Plan). Defaults to "default" until init. */
  mode: () => AgentMode
  /** Session UUID reported by the SDK init event, or null pre-init. */
  sessionId: () => string | null
  /** Working directory the agent was started with — for session-list scoping. */
  cwd: () => string
  submit: (text: string) => void
  interrupt: () => Promise<void>
  setModel: (model: string) => Promise<void>
  setMode: (mode: AgentMode) => Promise<void>
  /** Cycle Default → Plan → Default. Wired to Tab. */
  cycleMode: () => Promise<void>
  /** Resume a different session by uuid. Wipes the current scrollback and replays. */
  resumeSession: (id: string) => Promise<void>
  listModels: () => Promise<Array<{ id: string; displayName: string; description: string }>>
  /** Append a local-only notice to the scrollback (does not hit the SDK). */
  pushNotice: (text: string) => void
}

const AgentContext = createContext<AgentContextValue | null>(null)

export interface AgentProviderProps {
  children: JSX.Element
  config: Omit<AgentClientConfig, "onEvent" | "onPermissionRequest">
}

export function AgentProvider(props: AgentProviderProps) {
  const [items, setItems] = createStore<DisplayItem[]>([])
  const [status, setStatus] = createSignal<AgentStatus>({ kind: "idle" })
  const [pendingPermission, setPendingPermission] = createSignal<PermissionRequest | null>(null)
  const [model, setModelSignal] = createSignal<string | null>(null)
  const [mode, setModeSignal] = createSignal<AgentMode>("default")
  const [sessionId, setSessionIdSignal] = createSignal<string | null>(null)

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
    setSessionIdSignal(null)
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
          case "model":
            setModelSignal(evt.model)
            break
          case "mode":
            setModeSignal(evt.mode)
            break
          case "session":
            setSessionIdSignal(evt.sessionId)
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
    model,
    mode,
    sessionId,
    cwd: () => props.config.cwd ?? process.cwd(),
    submit: (text) => client?.submitUserMessage(text),
    interrupt: async () => {
      await client?.interrupt()
    },
    setModel: async (next) => {
      await client?.setModel(next)
      saveState({ model: next })
    },
    setMode: async (next) => {
      await client?.setMode(next)
    },
    cycleMode: async () => {
      await client?.setMode(nextMode(mode()))
    },
    resumeSession: async (id) => {
      dlog("agent.resumeSession", { id })
      startClient({ resume: id })
    },
    listModels: async () => (client ? client.listModels() : []),
    pushNotice: (text: string) => {
      setItems(produce((arr) => arr.push({
        kind: "system",
        id: `local-${Date.now()}-${arr.length}`,
        text,
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
