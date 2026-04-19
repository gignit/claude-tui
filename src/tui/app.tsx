/**
 * Provider tree + render() entry. Each layer of context wraps the chat
 * route. Order matters — see `dialog-overlay.tsx` for why DialogOverlay
 * is mounted alongside <Chat /> rather than inside DialogProvider.
 */

import { ErrorBoundary } from "solid-js"
import { render } from "@opentui/solid"
import { ThemeProvider, useTheme } from "./context/theme.tsx"
import { KeybindProvider } from "./context/keybind.tsx"
import { ExpandProvider } from "./context/expand.tsx"
import { SettingsProvider } from "./context/settings.tsx"
import { AgentProvider } from "./context/agent.tsx"
import { DialogProvider } from "./context/dialog.tsx"
import { CommandProvider } from "./context/command.tsx"
import { DialogCommand } from "./component/dialog-command.tsx"
import { DialogOverlay } from "./component/dialog-overlay.tsx"
import { Chat } from "./routes/chat.tsx"

export interface RunOptions {
  cwd: string
  /** Optional. When undefined, the SDK uses whatever `claude` would default to. */
  model?: string
  pathToClaudeCodeExecutable?: string
  /** Optional override for mouse-wheel scroll speed (lines per tick). */
  scrollSpeed?: number
}

export async function runTui(opts: RunOptions): Promise<void> {
  await render(
    () => (
      <ErrorBoundary fallback={(err) => <Crash err={err} />}>
        <ThemeProvider>
          <KeybindProvider>
            <ExpandProvider>
              <SettingsProvider initialScrollSpeed={opts.scrollSpeed}>
                <AgentProvider
                  config={{
                    cwd: opts.cwd,
                    ...(opts.model ? { model: opts.model } : {}),
                    ...(opts.pathToClaudeCodeExecutable
                      ? { pathToClaudeCodeExecutable: opts.pathToClaudeCodeExecutable }
                      : {}),
                  }}
                >
                  <DialogProvider>
                    <CommandProvider
                      paletteRenderer={(initialFilter) => <DialogCommand initialFilter={initialFilter} />}
                    >
                      <Chat />
                      {/* Overlay must be inside CommandProvider (and every
                          other provider) so dialog factories that call
                          useCommand/useAgent/useTheme have those contexts
                          available. See dialog-overlay.tsx for context. */}
                      <DialogOverlay />
                    </CommandProvider>
                  </DialogProvider>
                </AgentProvider>
              </SettingsProvider>
            </ExpandProvider>
          </KeybindProvider>
        </ThemeProvider>
      </ErrorBoundary>
    ),
    {
      targetFps: 60,
      exitOnCtrlC: false, // we handle Ctrl+C ourselves so it can interrupt instead of kill
      useKittyKeyboard: {},
    },
  )
}

function Crash(props: { err: unknown }) {
  const theme = useTheme()
  const text = props.err instanceof Error ? `${props.err.message}\n${props.err.stack ?? ""}` : String(props.err)
  return (
    <box padding={2} backgroundColor={theme.background}>
      <text fg={theme.error}>fatal: claude-tui crashed</text>
      <text fg={theme.text}>{text}</text>
    </box>
  )
}
