/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Context, KeymapLayer, Page, Route, SlotClaim } from "@opencode/plugin/tui/context"
import { RGBA, type CliRenderer } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { Show, createSignal } from "solid-js"
import plugin from "../src/tui"
import { Store } from "../src/store"

// Every theme token resolves to the same grey, whatever its path.
function fakeTheme(): any {
  const color = RGBA.fromHex("#888888")
  const handler: ProxyHandler<RGBA> = {
    get(target, prop) {
      if (prop in target) {
        const value = Reflect.get(target, prop, target)
        return typeof value === "function" ? value.bind(target) : value
      }
      return new Proxy(color, handler)
    },
  }
  return new Proxy(color, handler)
}

function png(width: number, height: number) {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

let root: string
afterEach(() => rm(root, { recursive: true, force: true }))

async function setup(height = 40) {
  root = await mkdtemp(path.join(os.tmpdir(), "result-tui-"))
  await writeFile(
    path.join(root, "shot.png"),
    process.env.REAL_IMAGE ? await Bun.file(process.env.REAL_IMAGE).bytes() : png(1600, 1200),
  )
  const store = new Store(path.join(root, "store"))
  const report = await store.create({
    sessionID: "ses_a",
    title: "Dark mode",
    status: "success",
    markdown: "## Changes\n\n- Added toggle\n\n![Settings page](shot.png)\n\nSee https://example.com",
    base: root,
  })

  const listeners: ((event: { data: unknown }) => void)[] = []
  const layers: KeymapLayer[] = []
  const claims: SlotClaim[] = []
  const toasts: string[] = []
  const pages: Page[] = []
  const [route, setRoute] = createSignal<Route>({ type: "session", sessionID: "ses_a" })

  const rpc = {
    list: async ({ sessionIDs }: { sessionIDs: string[] }) => ({ reports: await store.list(sessionIDs) }),
    get: async ({ sessionID, reportID }: { sessionID: string; reportID: string }) => ({
      report: await store.get(sessionID, reportID),
    }),
    image: async () => ({}),
    remove: async () => ({}),
    events: { on: (_: string, listener: (event: { data: unknown }) => void) => (listeners.push(listener), () => {}) },
  }

  const context = (renderer: CliRenderer) =>
    ({
      options: {},
      renderer,
      theme: fakeTheme(),
      client: { rpc: () => rpc },
      data: { session: { family: () => [] } },
      keymap: { layer: (factory: () => KeymapLayer) => layers.push(factory()) },
      ui: {
        slot: (claim: SlotClaim) => (claims.push(claim), () => {}),
        toast: { show: (options: { message: string }) => toasts.push(options.message) },
        router: {
          register: (page: Page) => (pages.push(page), () => {}),
          navigate: (destination: Route) => setRoute(destination),
          current: route,
        },
        dialog: {},
      },
    }) as unknown as Context

  function Host() {
    void plugin.setup(context(useRenderer()))
    const sidebar = claims.find((claim) => claim.append === "sidebar.content")!
    return (
      <Show
        when={route().type === "plugin"}
        fallback={
          <box width={38} flexDirection="column">
            {(sidebar.render as (input: { sessionID: string }) => any)({ sessionID: "ses_a" })}
          </box>
        }
      >
        {pages[0]!.render({ data: (route() as { data?: Record<string, any> }).data })}
      </Show>
    )
  }

  const rendered = await testRender(() => <Host />, { width: 90, height })
  const settle = async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 40))
      await rendered.renderOnce()
    }
  }
  return { ...rendered, report, layers, listeners, toasts, settle, route }
}

test("sidebar lists reports and a click opens the report full screen", async () => {
  const ui = await setup()
  await ui.settle()
  let frame = ui.captureCharFrame()
  expect(frame).toContain("Results")
  expect(frame).toContain("Dark mode")

  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes("Dark mode"))
  const x = lines[y]!.indexOf("Dark mode")
  await ui.mockMouse.click(x, y)
  await ui.settle()

  frame = ui.captureCharFrame()
  if (process.env.SHOW_FRAME) console.log(frame)
  expect(frame).toContain("Changes")
  expect(frame).toContain("Added toggle")
  expect(ui.route()).toMatchObject({ type: "plugin", name: "result", data: { sessionID: "ses_a", reportID: ui.report.id } })
  ui.renderer.destroy()
})

test("a created event shows a toast", async () => {
  const ui = await setup()
  await ui.settle()
  for (const listener of ui.listeners)
    listener({ data: { sessionID: "ses_a", reportID: ui.report.id, title: "Dark mode", created: true } })
  expect(ui.toasts).toEqual(["Dark mode"])
  ui.renderer.destroy()
})

test("only fully visible images are drawn, and none while scrolling", async () => {
  const ui = await setup(24)
  await ui.settle()
  const lines = ui.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("Dark mode"))
  await ui.mockMouse.click(lines[y]!.indexOf("Dark mode"), y)
  await ui.settle()
  // The image starts below the fold, so it would be clipped.
  expect(ui.captureCharFrame()).toContain("▣ scroll to show")

  const scrollDown = ui.layers.at(-1)!.commands!.find((command) => command.title === "Scroll down")!
  for (let i = 0; i < 6; i++) void scrollDown.run()
  await new Promise((resolve) => setTimeout(resolve, 60))
  await ui.renderOnce()
  expect(ui.captureCharFrame()).toContain("▣ scroll to show")

  await ui.settle()
  expect(ui.captureCharFrame()).not.toContain("▣ scroll to show")
  expect(ui.captureCharFrame()).toContain("Settings page")
  ui.renderer.destroy()
})
