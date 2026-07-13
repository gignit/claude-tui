/**
 * Right-hand control panel: at-a-glance session state without crowding
 * the status line. Toggled via /controlpanel (persists).
 *
 *   <box width=34 border=left>        ← panel root
 *     <scrollbox flexGrow=1>          ← sections overflow → scroll
 *       Session   (title, id)
 *       Context   (tokens + bar)
 *       MCP       (collapsible — click header)
 *       LSP       (collapsible)
 *       Todos     (collapsible)
 *     </scrollbox>
 *     <box flexShrink=0>{cwd}:{branch}</box>   ← pinned footer
 *   </box>
 *
 * Data freshness: MCP statuses and the git branch are re-fetched when
 * the panel mounts, when the session id changes, and on every
 * busy→idle status transition (i.e. after each turn, when the agent
 * could have changed them).
 */

import { For, Show, createEffect, createSignal, onMount, type JSX } from "solid-js"
import { homedir } from "node:os"
import { useTheme } from "../context/theme.tsx"
import { useAgent } from "../context/agent.tsx"
import { currentGitBranch } from "../../util/git.ts"
import { listLspServers, type LspServerInfo } from "../../util/lsp.ts"
import type { McpServerInfo, TodoItem } from "../../agent/types.ts"
import { dlog } from "../../util/debug-log.ts"

export const CONTROL_PANEL_WIDTH = 34

type SectionKey = "mcp" | "lsp" | "todos"

function mcpStatusSigil(status: McpServerInfo["status"]): string {
  switch (status) {
    case "connected":
      return "●"
    case "pending":
      return "◌"
    case "needs-auth":
      return "◐"
    case "disabled":
      return "○"
    case "failed":
      return "✗"
  }
}

function todoSigil(status: TodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "[x]"
    case "in_progress":
      return "[~]"
    case "pending":
      return "[ ]"
  }
}

/** "12.3k" style token counts — same rounding the status line uses. */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
}

export function ControlPanel() {
  const theme = useTheme()
  const agent = useAgent()
  const [collapsed, setCollapsed] = createSignal<Record<SectionKey, boolean>>({
    mcp: false,
    lsp: false,
    todos: false,
  })
  const [branch, setBranch] = createSignal<string | null>(null)
  const [lsp, setLsp] = createSignal<LspServerInfo[]>([])

  const toggle = (key: SectionKey) => {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }))
    dlog("panel.section.toggle", { key, collapsed: collapsed()[key] })
  }

  const refresh = () => {
    void agent.refreshMcpServers()
    void agent.refreshSessionTitle()
    void currentGitBranch(agent.cwd()).then(setBranch)
    // Plugin registry reads (see util/lsp.ts) — sync and cheap.
    setLsp(listLspServers())
  }

  onMount(refresh)
  // Session swap (resume/fork/rewind spawn a new client) → re-fetch.
  createEffect((prev: string | null | undefined) => {
    const id = agent.sessionId()
    if (prev !== undefined && id !== prev) refresh()
    return id
  })
  // Busy→idle edge = a turn just finished; the agent may have switched
  // branches or reconfigured MCP servers during it.
  createEffect((prevKind: string | undefined) => {
    const kind = agent.status().kind
    if (prevKind !== undefined && prevKind !== "idle" && kind === "idle") refresh()
    return kind
  })

  const shortCwd = () => agent.cwd().replace(homedir(), "~")
  const todosDone = () => agent.todos().filter((t) => t.status === "completed").length

  const usageColor = () => {
    const u = agent.contextUsage()
    if (!u) return theme.textDim
    if (u.percentage >= 90) return theme.error
    if (u.percentage >= 70) return theme.warn
    return theme.success
  }

  /** 10-cell usage bar: `████░░░░░░`. */
  const usageBar = () => {
    const u = agent.contextUsage()
    if (!u) return "░".repeat(10)
    const filled = Math.max(0, Math.min(10, Math.round(u.percentage / 10)))
    return "█".repeat(filled) + "░".repeat(10 - filled)
  }

  const Section = (props: {
    title: string
    key: SectionKey
    count: string
    children: JSX.Element
  }) => (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" onMouseUp={() => toggle(props.key)}>
        <text fg={theme.accent}>
          {`${collapsed()[props.key] ? "▸" : "▾"} ${props.title} `}
        </text>
        <text fg={theme.textDim}>{props.count}</text>
      </box>
      <Show when={!collapsed()[props.key]}>
        <box flexDirection="column" paddingLeft={2}>
          {props.children}
        </box>
      </Show>
    </box>
  )

  const McpRows = (props: { servers: McpServerInfo[]; empty: string }) => (
    <Show
      when={props.servers.length > 0}
      fallback={<text fg={theme.textDim}>{props.empty}</text>}
    >
      <For each={props.servers}>
        {(s) => (
          <box flexDirection="column">
            <text
              fg={
                s.status === "connected"
                  ? theme.text
                  : s.status === "failed"
                    ? theme.error
                    : theme.textMuted
              }
            >
              {`${mcpStatusSigil(s.status)} ${s.name}${
                s.toolCount !== undefined ? ` (${s.toolCount})` : ""
              }${s.status === "connected" ? "" : ` — ${s.status}`}`}
            </text>
            <Show when={s.error}>
              <text fg={theme.textDim}>{`  ${s.error}`}</text>
            </Show>
          </box>
        )}
      </For>
    </Show>
  )

  return (
    <box
      width={CONTROL_PANEL_WIDTH}
      flexShrink={0}
      flexDirection="column"
      border={["left"]}
      borderColor={theme.border}
      backgroundColor={theme.background}
      paddingTop={1}
      paddingBottom={0}
      paddingLeft={1}
      paddingRight={1}
    >
      <scrollbox flexGrow={1}>
        <box flexDirection="column" gap={1}>
          {/* Session — always visible */}
          <box flexDirection="column" flexShrink={0}>
            <text fg={theme.primary}>session</text>
            <text fg={theme.text}>{agent.sessionTitle() ?? "(untitled)"}</text>
            <text fg={theme.textDim}>
              {agent.sessionId()?.slice(0, 8) ?? "connecting…"}
            </text>
          </box>

          {/* Context — always visible */}
          <box flexDirection="column" flexShrink={0}>
            <text fg={theme.primary}>context</text>
            <Show
              when={agent.contextUsage()}
              fallback={<text fg={theme.textDim}>no usage data yet</text>}
            >
              {(u) => (
                <>
                  <text fg={usageColor()}>
                    {`${usageBar()} ${Math.round(u().percentage)}%`}
                  </text>
                  <text fg={theme.textDim}>
                    {`${fmtTokens(u().totalTokens)} of ${fmtTokens(u().maxTokens)} tokens`}
                  </text>
                </>
              )}
            </Show>
          </box>

          <Section title="mcp" key="mcp" count={`(${agent.mcpServers().length})`}>
            <McpRows servers={agent.mcpServers()} empty="none configured" />
          </Section>

          <Section title="lsp" key="lsp" count={`(${lsp().length})`}>
            <Show
              when={lsp().length > 0}
              fallback={<text fg={theme.textDim}>no lsp plugins enabled</text>}
            >
              <For each={lsp()}>
                {(s) => (
                  <text fg={s.available ? theme.text : theme.error}>
                    {`${s.available ? "●" : "✗"} ${s.name}${
                      s.languages.length > 0 ? ` (${s.languages.join(", ")})` : ""
                    }${s.available ? "" : " — missing"}`}
                  </text>
                )}
              </For>
            </Show>
          </Section>

          <Section
            title="todos"
            key="todos"
            count={agent.todos().length > 0 ? `(${todosDone()}/${agent.todos().length})` : "(none)"}
          >
            <Show
              when={agent.todos().length > 0}
              fallback={<text fg={theme.textDim}>no active todo list</text>}
            >
              <For each={agent.todos()}>
                {(t) => (
                  <text
                    fg={
                      t.status === "completed"
                        ? theme.textDim
                        : t.status === "in_progress"
                          ? theme.accent
                          : theme.text
                    }
                  >
                    {`${todoSigil(t.status)} ${
                      t.status === "in_progress" && t.activeForm ? t.activeForm : t.content
                    }`}
                  </text>
                )}
              </For>
            </Show>
          </Section>
        </box>
      </scrollbox>

      {/* Footer — pinned below the scroll area, like chat's prompt box. */}
      <box flexShrink={0} paddingTop={1} flexDirection="column">
        <text fg={theme.textDim}>
          {`${shortCwd()}:${branch() ?? "no git"}`}
        </text>
      </box>
    </box>
  )
}
