import { expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { foreignImports } from "../script/check-dist"

const root = path.join(import.meta.dir, "..")

test("dist/tui.js imports only modules that OpenCode provides", async () => {
  expect(foreignImports(await Bun.file(path.join(root, "dist", "tui.js")).text())).toEqual([])
})

// A `github:` install lives under node_modules, where OpenCode skips the Solid transform.
test("the TUI renders when installed under node_modules", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "result-install-"))
  try {
    const target = path.join(temp, "node_modules", "opencode-result")
    await mkdir(target, { recursive: true })
    for (const entry of ["package.json", "src", "dist"]) await cp(path.join(root, entry), path.join(target, entry), { recursive: true })
    const child = Bun.spawn(["bun", "test", "--preload", "./test/host-preload.ts", "test/tui.test.tsx"], {
      cwd: root,
      env: { ...process.env, RESULT_TUI: path.join(target, "dist", "tui.js") },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stderr, exit] = await Promise.all([new Response(child.stderr).text(), child.exited])
    expect({ exit, failed: stderr.match(/^\(fail\).*$/gm) ?? [] }).toEqual({ exit: 0, failed: [] })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 120_000)
