import { rm } from "node:fs/promises"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

// OpenCode compiles plugin .tsx without Solid when it sits in node_modules (anomalyco/opencode#39986), so ship JS.
const root = path.join(import.meta.dir, "..")
const outdir = path.join(root, "dist")

await rm(outdir, { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: [path.join(root, "src", "tui.tsx")],
  outdir,
  root: path.join(root, "src"),
  target: "bun",
  format: "esm",
  external: ["@opencode/plugin", "@opencode/plugin/*", "@opentui/*", "solid-js", "solid-js/*", "effect", "effect/*"],
  plugins: [createSolidTransformPlugin()],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
for (const output of result.outputs) {
  // Bun labels modules relative to the cwd as it spells it, so pin the labels for a reproducible dist.
  const code = await Bun.file(output.path).text()
  await Bun.write(output.path, code.replace(/^\/\/ (?:\.\.\/|[^\n]*?\/)*(src\/[^\n/]+)$/gm, "// $1"))
  console.log(path.relative(root, output.path))
}
