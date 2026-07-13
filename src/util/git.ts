/**
 * Best-effort git helpers for the control panel. Never throw — a
 * non-repo cwd, missing git binary, or timeout all resolve to null.
 */

import { execFile } from "node:child_process"

/**
 * Current branch name for `cwd`, or null when cwd is not a git repo
 * (or git is unavailable). Detached HEAD reports the literal "HEAD".
 */
export function currentGitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, timeout: 2000 },
      (err, stdout) => {
        if (err) return resolve(null)
        const branch = stdout.trim()
        resolve(branch.length > 0 ? branch : null)
      },
    )
  })
}
