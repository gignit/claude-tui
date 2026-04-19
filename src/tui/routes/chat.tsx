/**
 * Main chat view.
 *
 *   <box flexDirection=row>          ← outer (room for a sidebar later)
 *     <box flexGrow=1 padding gap=1> ← chat column (column is the Yoga default)
 *       <scrollbox flexGrow=1 stickyScroll stickyStart="bottom">
 *         <For each={items}>{MessageView}</For>
 *       </scrollbox>
 *       <box flexShrink=0>           ← footer wrapper, never shrinks
 *         {permission?}
 *         <Prompt />
 *         <StatusLine />
 *       </box>
 *     </box>
 *   </box>
 *
 * No `contentOptions` on the scrollbox. Messages stack from the top, and
 * stickyStart="bottom" keeps the latest visible whenever content overflows.
 * The visual chat-app feel comes from the `gap={1}` and outer padding,
 * plus enough messages to fill the screen.
 */

import { For, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme.tsx"
import { useAgent } from "../context/agent.tsx"
import { useExpand } from "../context/expand.tsx"
import { useKeybind } from "../context/keybind.tsx"
import { useCommand } from "../context/command.tsx"
import { useDialog } from "../context/dialog.tsx"
import { MessageView } from "../component/message.tsx"
import { Prompt } from "../component/prompt.tsx"
import { StatusLine } from "../component/status-line.tsx"
import { dlog } from "../../util/debug-log.ts"
import { copyToClipboard } from "../../util/clipboard.ts"
import { registerBuiltinCommands } from "./commands.tsx"

export function Chat() {
  const theme = useTheme()
  const agent = useAgent()
  const expand = useExpand()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const command = useCommand()
  const dialog = useDialog()
  let scroll: ScrollBoxRenderable | undefined

  // Register the built-in commands once. registerBuiltinCommands returns
  // null but its hook calls do all the work in the provider tree.
  registerBuiltinCommands()

  /**
   * Auto-copy on mouse-up if there's any selected text. We write via
   * OSC 52 (works over SSH and inside tmux) plus a native helper for
   * local terminals.
   */
  const copySelectionIfAny = () => {
    const text = renderer.getSelection()?.getSelectedText()
    if (!text) return false
    copyToClipboard(text)
    renderer.clearSelection()
    dlog("clipboard.auto_copy", { length: text.length })
    return true
  }

  useKeyboard((evt) => {
    dlog("key", {
      name: evt.name,
      ctrl: evt.ctrl || undefined,
      meta: evt.meta || undefined,
      shift: evt.shift || undefined,
    })
    // Ctrl+K opens the command palette. Skip if a dialog is already open;
    // the DialogProvider handles Esc/Ctrl+C to close.
    if (evt.ctrl && evt.name === "k" && dialog.size() === 0) {
      command.show()
      evt.preventDefault()
      return
    }
    // Permission prompt intercepts y/n before global bindings.
    const req = agent.pendingPermission()
    if (req) {
      if (evt.name === "y") {
        req.resolve(true)
        return
      }
      if (evt.name === "n" || evt.name === "escape") {
        req.resolve(false)
        return
      }
    }

    const action = keybind.match({
      ...(evt.name ? { name: evt.name } : {}),
      ...(evt.ctrl ? { ctrl: evt.ctrl } : {}),
      ...(evt.meta ? { meta: evt.meta } : {}),
      ...(evt.shift ? { shift: evt.shift } : {}),
    })
    if (!action) return
    dlog("key.action", { action })
    switch (action) {
      case "expand_toggle":
        expand.toggle()
        dlog("expand.toggle", { expanded: expand.expanded() })
        return
      case "scroll_up_page":
        scroll?.scrollBy(-Math.floor((scroll?.height ?? 20) * 0.9))
        return
      case "scroll_down_page":
        scroll?.scrollBy(Math.floor((scroll?.height ?? 20) * 0.9))
        return
      case "scroll_top":
        scroll?.scrollTo(0)
        return
      case "scroll_bottom":
        if (scroll) scroll.scrollTo(scroll.scrollHeight)
        return
    }
  })

  const pending = agent.pendingPermission

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      flexDirection="row"
      onMouseUp={copySelectionIfAny}
    >
      <box
        flexGrow={1}
        flexDirection="column"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        gap={1}
      >
        <scrollbox
          ref={scroll}
          flexGrow={1}
          stickyScroll={true}
          stickyStart="bottom"
          viewportOptions={{ paddingRight: 1 }}
          verticalScrollbarOptions={{
            visible: true,
            paddingLeft: 1,
            trackOptions: {
              backgroundColor: theme.backgroundElement,
              foregroundColor: theme.border,
            },
          }}
        >
          <For each={agent.items}>{(item) => <MessageView item={item} />}</For>
        </scrollbox>

        <box flexShrink={0} flexDirection="column">
          <Show when={pending()}>
            {(req) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
                borderColor={theme.warn}
                border={["top", "bottom", "left", "right"]}
                backgroundColor={theme.backgroundPanel}
              >
                <text fg={theme.warn}>permission requested</text>
                <text fg={theme.text}>{req().title ?? `Allow ${req().toolName}?`}</text>
                <Show when={req().description}>
                  <text fg={theme.textMuted}>{req().description}</text>
                </Show>
                <text fg={theme.textDim}>{"y = allow   |   n = deny"}</text>
              </box>
            )}
          </Show>

          <Prompt disabled={!!pending()} />
          <StatusLine />
        </box>
      </box>
    </box>
  )
}
