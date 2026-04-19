/**
 * Strip ANSI escape sequences from a string.
 *
 * Why: opentui's <text> renderer doesn't fully consume CSI/SGR
 * sequences — it eats the ESC + "[" prefix and the terminator letter
 * but leaves the parameter digits as visible text, garbling output
 * captured from tools that emit colors (e.g. Claude Code's /context).
 *
 * We don't apply ANSI styling from historical text anyway (the TUI
 * uses its own theme), so dropping every escape is the right move.
 *
 * Patterns covered:
 *   - CSI: ESC [ <params> <intermediates> <final>
 *   - OSC: ESC ]  ...  BEL  or  ESC ] ... ESC \
 *   - Other ESC sequences (cursor movement, charset selection, etc.)
 *
 * We do NOT try to strip "orphaned" SGR-looking residues (e.g. a bare
 * "38;5;153m" with no preceding ESC). Those would be too dangerous to
 * pattern-match — a real "47m" in text could collide. If you ever see
 * such residues in practice, sanitize at the producer instead of here.
 */

// ESC = 0x1b
// CSI:    /\x1b\[ <params: digits ; : > <intermediates: sp..to /> <final: @..~> /
const RE_CSI = /\x1b\[[\d;:]*[\x20-\x2f]*[\x40-\x7e]/g
// OSC:    /\x1b\] ... <terminator: BEL or ST> /
const RE_OSC = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g
// Other ESC sequences (single-char final after ESC):
//   ESC followed by a char in @..Z, \, ], ^, _ (Fp/Fe/Fs final bytes)
const RE_OTHER = /\x1b[@-Z\\-_]/g

export function stripAnsi(s: string): string {
  if (!s) return s
  return s.replace(RE_CSI, "").replace(RE_OSC, "").replace(RE_OTHER, "")
}
