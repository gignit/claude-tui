/**
 * LSP server inventory for the control panel.
 *
 * Claude Code's LSP support is configured through PLUGINS, not the Agent
 * SDK (sdk.d.ts 0.3.207 has no LSP surface at all — verified). The
 * on-disk chain, confirmed against a live install (incl. lsp-manager):
 *
 *   ~/.claude/settings.json
 *     enabledPlugins: { "<plugin>@<marketplace>": true }
 *   ~/.claude/plugins/known_marketplaces.json
 *     { "<marketplace>": { installLocation: <dir> } }
 *   <installLocation>/.claude-plugin/marketplace.json
 *     plugins[].name / plugins[].lspServers:
 *       { "<server>": { command, args?, extensionToLanguage? } }
 *
 * (There is no per-plugin plugin.json — lspServers live inline in the
 * marketplace manifest.) The CLI spawns these servers lazily per file
 * type and exposes no runtime status, so "available" here means the
 * command resolves — configured and launchable, not necessarily running.
 */

import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { commandExists } from "./clipboard.ts"

export interface LspServerInfo {
  /** Server key from the manifest, e.g. "gopls", "pyright". */
  name: string
  /** Plugin id it came from, e.g. "gopls-lsp@lsp-manager". */
  plugin: string
  /** Languages covered (unique extensionToLanguage values). */
  languages: string[]
  command: string
  /** Whether `command` resolves (absolute path exists, or found on PATH). */
  available: boolean
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function commandAvailable(command: string): boolean {
  if (command.includes("/")) {
    try {
      return statSync(command).isFile()
    } catch {
      return false
    }
  }
  return commandExists(command)
}

/**
 * Enabled LSP servers from Claude Code's plugin registry. Sync fs reads
 * over three small JSON files; never throws — unresolvable pieces are
 * skipped so a broken manifest can't take the panel down.
 */
export function listLspServers(): LspServerInfo[] {
  const claudeDir = join(homedir(), ".claude")
  const settings = readJson(join(claudeDir, "settings.json")) as {
    enabledPlugins?: Record<string, boolean>
  } | null
  const marketplaces = readJson(join(claudeDir, "plugins", "known_marketplaces.json")) as Record<
    string,
    { installLocation?: string }
  > | null
  if (!settings?.enabledPlugins || !marketplaces) return []

  // Parse each marketplace manifest once, keyed by marketplace name.
  const manifestCache = new Map<string, Map<string, Record<string, unknown>>>()
  const pluginsOf = (marketplace: string): Map<string, Record<string, unknown>> => {
    let byName = manifestCache.get(marketplace)
    if (byName) return byName
    byName = new Map()
    const root = marketplaces[marketplace]?.installLocation
    if (root) {
      const manifest = readJson(join(root, ".claude-plugin", "marketplace.json")) as {
        plugins?: Array<Record<string, unknown>>
      } | null
      for (const entry of manifest?.plugins ?? []) {
        if (typeof entry["name"] === "string") byName.set(entry["name"], entry)
      }
    }
    manifestCache.set(marketplace, byName)
    return byName
  }

  const servers: LspServerInfo[] = []
  for (const [pluginId, enabled] of Object.entries(settings.enabledPlugins)) {
    if (!enabled) continue
    const at = pluginId.lastIndexOf("@")
    if (at <= 0) continue
    const entry = pluginsOf(pluginId.slice(at + 1)).get(pluginId.slice(0, at))
    const lspServers = entry?.["lspServers"] as
      | Record<string, { command?: string; extensionToLanguage?: Record<string, string> }>
      | undefined
    if (!lspServers) continue
    for (const [name, def] of Object.entries(lspServers)) {
      if (typeof def?.command !== "string") continue
      servers.push({
        name,
        plugin: pluginId,
        languages: [...new Set(Object.values(def.extensionToLanguage ?? {}))],
        command: def.command,
        available: commandAvailable(def.command),
      })
    }
  }
  return servers.sort((a, b) => a.name.localeCompare(b.name))
}
