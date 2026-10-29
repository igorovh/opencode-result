/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Context, KeymapLayer, SlotClaim } from "@opencode/plugin/tui/context"
import { RGBA, type CliRenderer } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { Show, createSignal, type JSX } from "solid-js"
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

const MARKDOWN = [
  "## Changes",
  "- Added toggle",
  "![Settings page](shot.png)",
  "## Links",
  "See https://example.com",
  ...Array.from({ length: 12 }, (_, i) => `Note ${i + 1}`),
  "## Last section",
  "The end",
].join("\n\n")

let root: string
afterEach(() => rm(root, { recursive: true, force: true }))

async function setup(height = 40) {
  root = await mkdtemp(path.join(os.tmpdir(), "result-tui-"))
  await writeFile(
    path.join(root, "shot.png"),
    process.env.REAL_IMAGE ? await Bun.file(process.env.REAL_IMAGE).bytes() : png(1600, 1200),
  )
  const store = new Store(path.join(root, "store"))
  const older = await store.create({ sessionID: "ses_a", title: "Older run", status: "partial", markdown: "Old notes", base: root })
  const report = await store.create({ sessionID: "ses_a", title: "Dark mode", status: "success", markdown: MARKDOWN, base: root })

  const listeners: ((event: { data: unknown }) => void)[] = []
  const layers: KeymapLayer[] = []
  const claims: SlotClaim[] = []
  const toasts: string[] = []
  const [dialog, setDialog] = createSignal<() => JSX.Element>()
  let onClose: (() => void) | undefined
  const selects: { title: string; value: unknown }[][] = []
  let pick: (options: { title: string; value: unknown }[]) => unknown = () => undefined

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
        router: { current: () => ({ type: "session", sessionID: "ses_a" }) },
        dialog: {
          show: (render: () => JSX.Element, close?: () => void) => {
            setDialog(() => render)
            onClose = close
          },
          set: () => {},
          select: async ({ options }: { options: { title: string; value: unknown }[] }) => {
            selects.push(options)
            return pick(options)
          },
        },
      },
    }) as unknown as Context

  function Host() {
    void plugin.setup(context(useRenderer()))
    const sidebar = claims.find((claim) => claim.append === "sidebar.content")!
    return (
      <Show
        when={dialog()}
        fallback={
          <box width={38} flexDirection="column">
            {(sidebar.render as (input: { sessionID: string }) => any)({ sessionID: "ses_a" })}
          </box>
        }
      >
        {(render) => <box padding={2}>{render()()}</box>}
      </Show>
    )
  }

  const rendered = await testRender(() => <Host />, { width: 120, height })
  const settle = async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      await rendered.renderOnce()
    }
  }
  const command = (title: string) => layers.at(-1)!.commands!.find((item) => item.title === title)!
  const clickText = async (text: string) => {
    const lines = rendered.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes(text))
    expect(y).toBeGreaterThanOrEqual(0)
    await rendered.mockMouse.click(lines[y]!.indexOf(text), y)
    await settle()
  }
  // What the host does on Escape: close the dialog, then call its onClose.
  const escape = async () => {
    setDialog(undefined)
    const close = onClose
    onClose = undefined
    close?.()
    await settle()
  }
  const setPick = (next: typeof pick) => (pick = next)
  const slash = () => layers.find((layer) => layer.commands?.some((item) => item.id === "result.open"))!.commands![0]!
  return { ...rendered, report, older, layers, listeners, toasts, settle, command, clickText, escape, selects, setPick, slash, dialog }
}

test("a sidebar report opens in a dialog with a contents legend, and escape returns to the session", async () => {
  const ui = await setup()
  await ui.settle()
  expect(ui.captureCharFrame()).toContain("Results")
  await ui.clickText("Dark mode")

  const frame = ui.captureCharFrame()
  if (process.env.SHOW_FRAME) console.log(frame)
  expect(frame).toContain("Added toggle")
  expect(frame).toContain("CONTENTS")
  expect(frame).toContain("▣ Settings page")
  expect(frame).toContain("Last section")
  expect(frame).toContain("esc close")
  expect(frame).not.toContain("Older run")
  expect(ui.layers.at(-1)!.mode).toBe("modal")

  await ui.escape()
  expect(ui.dialog()).toBeUndefined()
  expect(ui.selects).toEqual([])
  ui.renderer.destroy()
})

test("/results lists reports first, and escape from a report goes back to that list", async () => {
  const ui = await setup()
  await ui.settle()
  ui.setPick((options) => options.find((option) => option.title.includes("Dark mode"))!.value)
  await ui.slash().run()
  await ui.settle()
  expect(ui.selects[0]!.map((option) => option.title)).toEqual(["● Dark mode", "◐ Older run"])
  expect(ui.captureCharFrame()).toContain("esc back")

  ui.setPick(() => undefined)
  await ui.escape()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(ui.selects.length).toBe(2)
  expect(ui.dialog()).toBeUndefined()
  ui.renderer.destroy()
})

test("legend entries and n/p scroll to their section", async () => {
  const ui = await setup(30)
  await ui.settle()
  await ui.clickText("Dark mode")
  expect(ui.captureCharFrame()).not.toContain("The end")

  await ui.clickText("Last section")
  expect(ui.captureCharFrame()).toContain("The end")

  void ui.command("Top").run()
  await ui.settle()
  expect(ui.captureCharFrame()).not.toContain("The end")
  for (let i = 0; i < 3; i++) void ui.command("Next section").run()
  await ui.settle()
  expect(ui.captureCharFrame()).toContain("The end")
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
