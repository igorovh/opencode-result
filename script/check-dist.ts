import { readdir, readFile } from "node:fs/promises"
import { isBuiltin } from "node:module"
import path from "node:path"

// Only these modules come from the host; anything else would load a second copy from the plugin's node_modules.
export const HOST_MODULES = new Set([
  "@opencode/plugin",
  "@opencode/plugin/tui",
  "@opencode/plugin/rpc",
  "effect",
  "@opentui/core",
  "@opentui/solid",
  "@opentui/solid/components",
  "@opentui/solid/jsx-runtime",
  "solid-js",
  "solid-js/store",
])

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g

export function foreignImports(code: string) {
  return [...code.matchAll(IMPORT)]
    .map((match) => match[1]!)
    .filter((specifier) => !isBuiltin(specifier) && !specifier.startsWith(".") && !HOST_MODULES.has(specifier))
}

if (import.meta.main) {
  const dist = path.join(import.meta.dir, "..", "dist")
  const files = (await readdir(dist)).filter((file) => file.endsWith(".js"))
  if (!files.includes("tui.js")) throw new Error("dist/tui.js is missing; run `bun run compile`")
  let failed = false
  for (const file of files) {
    const code = await readFile(path.join(dist, file), "utf8")
    if (/@opentui\/solid\/jsx-(?:dev-)?runtime/.test(code)) {
      console.error(`dist/${file}: JSX was not compiled by the Solid transform`)
      failed = true
    }
    for (const specifier of foreignImports(code)) {
      console.error(`dist/${file}: imports "${specifier}", which OpenCode does not provide`)
      failed = true
    }
  }
  if (failed) process.exit(1)
  console.log(`dist OK: ${files.join(", ")}`)
}
