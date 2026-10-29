import { readFile } from "node:fs/promises"
import { Plugin } from "@opencode/plugin"
import { ResultRpc, type Report, type ReportStatus } from "./rpc"
import { Store, defaultRoot } from "./store"

const STATUSES = ["success", "partial", "failed", "info"] as const

const REMINDER = [
  "When you finish a task, publish a result report with result_create: a short title and markdown with what changed,",
  "links (PRs, deployed URLs, docs) and notes. Embed screenshots or other images as ![caption](path) whenever the work",
  "has a visible result, for example UI changes. Use result_append to add to a report you already created in this session.",
].join(" ")

const imageCount = (count: number) => (count === 1 ? "1 image" : `${count} images`)

function describe(report: Report, verb: string) {
  return `${verb} report ${report.id} "${report.title}" (${report.status}, ${imageCount(report.imageCount)}). The user can open it from the Results list in the sidebar or with /results.`
}

export default Plugin.define({
  id: "result",
  async setup(ctx) {
    const store = new Store(typeof ctx.options.dir === "string" ? ctx.options.dir : defaultRoot())

    const directoryOf = async (sessionID: string) => {
      try {
        return (await ctx.session.get({ sessionID })).location.directory
      } catch {
        return ctx.location.directory
      }
    }

    const rpc = await ctx.rpc.register(ResultRpc, {
      list: async (input) => {
        const { sessionIDs } = input as { sessionIDs: string[] }
        return { reports: await store.list(sessionIDs) }
      },
      get: async (input) => {
        const { sessionID, reportID } = input as { sessionID: string; reportID: string }
        const report = await store.get(sessionID, reportID)
        return report ? { report } : {}
      },
      image: async (input) => {
        const { sessionID, reportID, file } = input as { sessionID: string; reportID: string; file: string }
        const found = await store.imagePath(sessionID, reportID, file)
        return found ? { data: (await readFile(found)).toString("base64") } : {}
      },
      remove: async (input) => {
        const { sessionID, reportID } = input as { sessionID: string; reportID: string }
        const report = await store.get(sessionID, reportID)
        await store.remove(sessionID, reportID)
        if (report) await rpc.events.emit("changed", { sessionID, reportID, title: report.title, created: false })
        return {}
      },
    })

    const changed = (report: Report, created: boolean) =>
      rpc.events.emit("changed", { sessionID: report.sessionID, reportID: report.id, title: report.title, created })

    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "result", description: "Result reports shown to the user in the TUI" })
      editor.add({
        name: "create",
        description: [
          "Publish a result report for the user at the end of a task. A session can have several reports.",
          "The report is markdown: headings, lists, links and notes. Embed images with ![caption](path):",
          "absolute paths, paths relative to the session directory, http(s) URLs or data URLs (PNG, JPEG, GIF, WebP).",
          "Images are copied into the report, so temporary screenshots are safe to delete afterwards.",
          "Put each image on its own line; it renders full width with the caption under it.",
        ].join(" "),
        input: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title, for example 'Dark mode for settings page'" },
            status: {
              type: "string",
              enum: [...STATUSES],
              description: "success (default), partial, failed or info",
            },
            markdown: { type: "string", description: "Report body in markdown, with images as ![caption](path)" },
          },
          required: ["title", "markdown"],
          additionalProperties: false,
        },
        options: { namespace: "result" },
        execute: async (input, context) => {
          const { title, status, markdown } = input as { title: string; status?: ReportStatus; markdown: string }
          const report = await store.create({
            sessionID: context.sessionID,
            title: title.trim() || "Result",
            status: status ?? "success",
            markdown,
            base: await directoryOf(context.sessionID),
            signal: context.signal,
          })
          await changed(report, true)
          return { content: describe(report, "Created"), metadata: { reportID: report.id } }
        },
      })
      editor.add({
        name: "append",
        description:
          "Add markdown and images to a result report created earlier in this session, and optionally change its title or status.",
        input: {
          type: "object",
          properties: {
            reportID: { type: "string" },
            markdown: { type: "string", description: "Markdown appended to the end of the report" },
            title: { type: "string" },
            status: { type: "string", enum: [...STATUSES] },
          },
          required: ["reportID"],
          additionalProperties: false,
        },
        options: { namespace: "result" },
        execute: async (input, context) => {
          const { reportID, markdown, title, status } = input as {
            reportID: string
            markdown?: string
            title?: string
            status?: ReportStatus
          }
          const report = await store.append({
            sessionID: context.sessionID,
            reportID,
            markdown,
            title,
            status,
            base: await directoryOf(context.sessionID),
            signal: context.signal,
          })
          await changed(report, false)
          return { content: describe(report, "Updated"), metadata: { reportID: report.id } }
        },
      })
      editor.add({
        name: "list",
        description: "List the result reports already published in this session.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "result" },
        execute: async (_input, context) => {
          const reports = await store.list([context.sessionID])
          if (!reports.length) return { content: "No result reports in this session yet." }
          return {
            content: reports
              .map((r) => `- ${r.id} "${r.title}" (${r.status}, ${imageCount(r.imageCount)}, ${new Date(r.createdAt).toISOString()})`)
              .join("\n"),
          }
        },
      })
    })

    if (ctx.options.remind !== false)
      await ctx.session.hook("context", (event) => {
        event.system.push({ type: "text", text: REMINDER })
      })
  },
})
