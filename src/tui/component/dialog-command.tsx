/**
 * The Ctrl+K command palette. Wraps DialogSelect with the live list
 * from the command registry.
 *
 * Lives in `component/` rather than `context/` because it depends on
 * dialog-select, which depends on theme and other runtime concerns.
 * The registry context is in `context/command.tsx`.
 */

import { useCommand } from "../context/command.tsx"
import { DialogSelect, type DialogSelectOption } from "./dialog-select.tsx"

export function DialogCommand(props: { initialFilter?: string }) {
  const command = useCommand()

  const options = (): DialogSelectOption<string>[] =>
    command.visible().map((c) => ({
      value: c.value,
      title: c.title,
      ...(c.description ? { subtitle: c.description } : {}),
      ...(c.slash ? { hint: "/" + c.slash.name } : {}),
    }))

  return (
    <DialogSelect<string>
      // Body heading; the breadcrumb at the top already says "Menu",
      // so this slot tells the user what to *do* rather than repeating
      // the section name.
      title="Choose selection"
      placeholder="Search…"
      options={options()}
      initialFilter={props.initialFilter ?? ""}
      onSelect={(opt) => {
        // Don't clear — the command's onSelect will push its dialog on
        // top of the palette so the breadcrumb shows
        // "Commands › <command>" and the user can click back.
        // (If the command is a no-dialog action like /help, it's
        // responsible for popping itself.)
        command.trigger(opt.value)
      }}
    />
  )
}
