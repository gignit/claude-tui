/**
 * Incremental todo-state reducer shared by the live client and JSONL
 * replay. Claude surfaces its checklist through either of two tool
 * families depending on harness configuration:
 *
 *   - TodoWrite: one call carries the ENTIRE list (replace semantics).
 *     The input alone is enough.
 *   - TaskCreate / TaskUpdate: incremental. TaskCreate's id is only in
 *     the tool RESULT text ("Task #3 created …"), so those calls apply
 *     when their result arrives, and failed calls are ignored.
 *
 * Feed every resolved tool call through applyToolCall(); it returns true
 * when the visible todo list changed.
 */

import type { TodoItem } from "../agent/types.ts"

export class TodoTracker {
  /** Keyed by task id ("3") or synthetic TodoWrite index ("todo-0"). */
  private tasks = new Map<string, TodoItem>()

  applyToolCall(
    toolName: string,
    input: Record<string, unknown>,
    result?: { output: string; isError: boolean },
  ): boolean {
    if (toolName === "TodoWrite" && Array.isArray(input["todos"])) {
      this.tasks.clear()
      let i = 0
      for (const t of input["todos"] as TodoItem[]) {
        this.tasks.set(`todo-${i++}`, { ...t })
      }
      return true
    }
    if (toolName === "TaskCreate") {
      if (!result || result.isError) return false
      const id = /#(\d+)/.exec(result.output)?.[1]
      const subject = input["subject"]
      if (!id || typeof subject !== "string") return false
      this.tasks.set(id, {
        content: subject,
        status: "pending",
        activeForm: typeof input["activeForm"] === "string" ? input["activeForm"] : subject,
      })
      return true
    }
    if (toolName === "TaskUpdate") {
      if (!result || result.isError) return false
      const id = String(input["taskId"] ?? "")
      const existing = this.tasks.get(id)
      if (!existing) return false
      const status = input["status"]
      if (status === "deleted") {
        this.tasks.delete(id)
        return true
      }
      let changed = false
      if (status === "pending" || status === "in_progress" || status === "completed") {
        existing.status = status
        changed = true
      }
      if (typeof input["subject"] === "string") {
        existing.content = input["subject"]
        changed = true
      }
      if (typeof input["activeForm"] === "string") {
        existing.activeForm = input["activeForm"]
        changed = true
      }
      return changed
    }
    return false
  }

  /** Current list, in id order (task ids and TodoWrite indexes both sort numerically). */
  todos(): TodoItem[] {
    return [...this.tasks.entries()]
      .sort(([a], [b]) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")))
      .map(([, t]) => t)
  }
}
