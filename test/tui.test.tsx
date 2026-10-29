/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Context, KeymapLayer, PanelInput, SlotClaim } from "@opencode/plugin/tui/context"
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

async function setup() {
  root = await mkdtemp(path.join(os.tmpdir(), "result-tui-"))
  await writeFile(
    path.join(root, "shot.png"),
    process.env.REAL_IMAGE ? await Bun.file(process.env.REAL_IMAGE).bytes() : png(400, 200),
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
  const [panel, setPanel] = createSignal<string>()

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
        panel: {
          open: (name: string) => (setPanel(name), true),
          close: () => setPanel(undefined),
          current: () => (panel() ? { name: panel()!, sessionID: "ses_a" } : undefined),
        },
        dialog: {},
      },
    }) as unknown as Context

  function Host() {
    void plugin.setup(context(useRenderer()))
    const sidebar = claims.find((claim) => claim.append === "sidebar.content")!
    const panelClaim = claims.find((claim) => claim.append === "session.panel")!
    const input = (): PanelInput => ({
      name: panel() ?? "",
      sessionID: "ses_a",
      width: 50,
      presentation: "panel",
      focused: true,
      focus: () => {},
      close: () => setPanel(undefined),
      toggleFullscreen: () => {},
    })
    return (
      <box flexDirection="row" width={90} height={40}>
        <box width={50} height={40}>
          <Show when={panel()}>{(panelClaim.render as (input: PanelInput) => any)(input())}</Show>
        </box>
        <box width={38} flexDirection="column">
          {(sidebar.render as (input: { sessionID: string }) => any)({ sessionID: "ses_a" })}
        </box>
      </box>
    )
  }

  const rendered = await testRender(() => <Host />, { width: 90, height: 40 })
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      await rendered.renderOnce()
    }
  }
  return { ...rendered, report, layers, listeners, toasts, settle }
}

test("sidebar lists reports and a click opens the report with its image", async () => {
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
  expect(frame).toContain("Settings page")
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
