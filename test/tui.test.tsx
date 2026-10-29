/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { deflateSync } from "node:zlib"
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

// A real, decodable PNG filled with one colour.
function png(width: number, height: number) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, "latin1")
    out.set(data, 8)
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)])
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", pixels),
      chunk("IEND", new Uint8Array()),
    ]),
  )
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

function images(node: any): { protocol: string; height: number }[] {
  const own = "effectiveProtocol" in node ? [{ protocol: node.protocol, height: node.height }] : []
  return [...own, ...(node.getChildren?.() ?? []).flatMap(images)]
}
const imageProtocols = (node: any) => images(node).map((image) => image.protocol)

let root: string
afterEach(() => rm(root, { recursive: true, force: true }))

async function setup(height = 40) {
  root = await mkdtemp(path.join(os.tmpdir(), "result-tui-"))
  await writeFile(
    path.join(root, "shot.png"),
    process.env.REAL_IMAGE ? await Bun.file(process.env.REAL_IMAGE).bytes() : png(640, 480),
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
  const modes: string[] = []
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
      keymap: {
        layer: (factory: () => KeymapLayer) => layers.push(factory()),
        mode: { push: (mode: string) => (modes.push(mode), () => void modes.splice(modes.indexOf(mode), 1)) },
      },
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
          clear: () => setDialog(undefined),
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
    const app = claims.find((claim) => claim.append === "app")!
    return (
      <>
      {(app.render as (input: object) => any)({})}
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
      </>
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
  const escape = async () => {
    const close = layers.at(-1)!.commands!.find((item) => item.bind?.toString().startsWith("escape"))!
    await close.run()
    await settle()
  }
  const open = () => modes.includes("modal")
  const setPick = (next: typeof pick) => (pick = next)
  const slash = () => layers.find((layer) => layer.commands?.some((item) => item.id === "result.open"))!.commands![0]!
  return { ...rendered, report, older, layers, listeners, toasts, settle, command, clickText, escape, selects, setPick, slash, dialog, open }
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
  // Settled and fully visible, so the image leaves the block fallback.
  expect(imageProtocols(ui.renderer.root)).toEqual(["auto"])
  expect(frame).toContain("esc close")

  expect(ui.open()).toBe(true)
  await ui.escape()
  expect(ui.open()).toBe(false)
  expect(ui.captureCharFrame()).not.toContain("CONTENTS")
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
  expect(ui.open()).toBe(false)
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

test("a partly visible image is cropped to its visible rows and drawn in full quality", async () => {
  const ui = await setup(30)
  await ui.settle()
  await ui.clickText("Dark mode")
  const [full] = images(ui.renderer.root)
  expect(full).toMatchObject({ protocol: "auto" })

  for (let i = 0; i < 3; i++) void ui.command("Scroll down").run()
  await new Promise((resolve) => setTimeout(resolve, 50))
  await ui.renderOnce()
  expect(imageProtocols(ui.renderer.root)).toEqual(["blocks"])

  await ui.settle()
  const [cropped] = images(ui.renderer.root)
  expect(cropped!.protocol).toBe("auto")
  expect(cropped!.height).toBeLessThan(full!.height)
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
