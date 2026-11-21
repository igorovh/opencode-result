// How `bun run record` and `bun run tui` set up the real OpenCode TUI with this plugin (opencode-tui-recorder).
import path from "node:path"
import { defineRecorder, type Context } from "opencode-tui-recorder"
import { Store } from "./src/store"

const docs = path.join(import.meta.dir, "docs")

// The server loads the plugin on the first request for a directory, so its RPC is unavailable until then.
async function waitForRpc(ctx: Context, directory: string, sessionID: string) {
  for (let attempt = 0; ; attempt++) {
    const response = await ctx.api("/api/rpc/result/list", { query: { "location[directory]": directory }, body: { input: { sessionIDs: [sessionID] } } })
    if (response.ok) return
    const text = await response.text()
    if (!text.includes("rpc.unavailable") || attempt >= 40) throw new Error(`result/list failed: ${response.status} ${text}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

export default defineRecorder({
  // The server part registers the RPC the TUI reads reports through, so both load from opencode.json.
  config: ({ plugin, options }) => ({ "opencode.json": { plugins: [{ package: plugin, options }] } }),
  sessions: [{ project: "web", title: "Polish the results viewer" }],
  attach: true,
  ready: {
    label: "the Results section in the sidebar",
    test: (lines) => lines.some((line) => line.includes("Results")) && lines.some((line) => line.includes("Flaky checkout test")),
  },
  // Report titles also show in the /results list and the report window; the sidebar is on the right.
  match: "rightmost",
  // Reports are files in the data directory, written the way result_create writes them, so no model runs.
  async seed(ctx) {
    const session = ctx.sessions[0]!
    // The sidebar lists reports once, so the plugin must answer before the TUI starts. On Windows the TUI asks
    // from the recorder's own directory, so load the plugin there too.
    for (const directory of [session.directory, process.cwd()]) await waitForRpc(ctx, directory, session.id)
    const store = new Store(path.join(ctx.work, "data", "opencode", "result"))
    const base = session.directory
    await store.create({
      sessionID: session.id,
      title: "Flaky checkout test",
      status: "partial",
      base,
      markdown: [
        "## Summary",
        "",
        "The checkout test fails about one run in ten. The cause is a race between the cart request and the",
        "redirect; a retry hides it in CI, but the real fix is still open.",
        "",
        "## Findings",
        "",
        "- `checkout.spec.ts` clicks **Pay** before the cart total loads.",
        "- The failure only shows with network throttling.",
        "",
        "## Next steps",
        "",
        "1. Wait for the total before clicking.",
        "2. Remove the retry once the fix lands.",
        "",
        "## Links",
        "",
        "- [CI run](https://github.com/acme/web/actions/runs/1)",
      ].join("\n"),
    })
    await store.create({
      sessionID: session.id,
      title: "Sidebar and viewer",
      status: "success",
      base,
      markdown: [
        "## Summary",
        "",
        "Reports now show in the sidebar with their status, image count and time, and open in a large window.",
        "",
        "## Sidebar",
        "",
        `![The Results section in the sidebar](${path.join(docs, "sidebar.png")})`,
        "",
        "## The /results list",
        "",
        `![The list with search](${path.join(docs, "list.png")})`,
        "",
        "## Changes",
        "",
        "| File | What changed |",
        "|---|---|",
        "| `src/tui.tsx` | Sidebar rows and the report window |",
        "| `src/store.ts` | Reports copy their images |",
        "",
        "## Links",
        "",
        "- [Pull request](https://github.com/acme/web/pull/42)",
      ].join("\n"),
    })
  },
})
