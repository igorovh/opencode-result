import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { sniffImage } from "../src/image"
import { joinMarkdown, splitMarkdown, splitSections } from "../src/markdown"
import { Store } from "../src/store"

function png(width: number, height: number) {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

describe("splitMarkdown", () => {
  test("splits text and images, keeping order", () => {
    expect(splitMarkdown("# Done\n\n![Chat](shot.png)\n\nNotes")).toEqual([
      { type: "markdown", text: "# Done" },
      { type: "image", alt: "Chat", src: "shot.png" },
      { type: "markdown", text: "Notes" },
    ])
  })

  test("reads angle-bracket paths with spaces and drops titles", () => {
    expect(splitMarkdown('![a](<C:\\My Shots\\1.png> "title")')).toEqual([
      { type: "image", alt: "a", src: "C:\\My Shots\\1.png" },
    ])
  })

  test("accepts bare Windows paths with spaces", () => {
    expect(splitMarkdown("![shot](C:\\My Shots\\1.png)")).toEqual([
      { type: "image", alt: "shot", src: "C:\\My Shots\\1.png" },
    ])
  })

  test("leaves images inside fenced code alone", () => {
    const markdown = "```md\n![x](y.png)\n```\n![real](z.png)"
    expect(splitMarkdown(markdown)).toEqual([
      { type: "markdown", text: "```md\n![x](y.png)\n```" },
      { type: "image", alt: "real", src: "z.png" },
    ])
  })

  test("leaves image syntax inside inline code alone", () => {
    expect(splitMarkdown("Embed with `![caption](path)` or ``![a](b)``, like ![real](z.png)")).toEqual([
      { type: "markdown", text: "Embed with `![caption](path)` or ``![a](b)``, like" },
      { type: "image", alt: "real", src: "z.png" },
    ])
  })

  test("splitSections starts a block at each heading, ignoring code fences", () => {
    const sections = splitSections("Intro\n## Changes\n- a\n```\n# not a heading\n```\n![shot](s.png)\n### Notes **bold**\ntext")
    expect(sections).toEqual([
      { type: "markdown", text: "Intro" },
      { type: "markdown", text: "## Changes\n- a\n```\n# not a heading\n```", heading: { text: "Changes", level: 2 } },
      { type: "image", alt: "shot", src: "s.png" },
      { type: "markdown", text: "### Notes **bold**\ntext", heading: { text: "Notes bold", level: 3 } },
    ])
  })

  test("joinMarkdown round-trips", () => {
    const blocks = splitMarkdown("Intro\n![a b](<p q.png>)\nOutro")
    expect(splitMarkdown(joinMarkdown(blocks))).toEqual(blocks)
  })
})

describe("sniffImage", () => {
  test("reads PNG size", () => {
    expect(sniffImage(png(640, 480))).toEqual({ mime: "image/png", ext: "png", width: 640, height: 480 })
  })

  test("reads JPEG size from the frame header after other segments", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03,
    ])
    expect(sniffImage(jpeg)).toMatchObject({ mime: "image/jpeg", width: 640, height: 480 })
  })

  test("rejects other files", () => {
    expect(sniffImage(new TextEncoder().encode("just some text, not an image"))).toBeUndefined()
  })
})

describe("Store", () => {
  let root: string
  afterEach(() => rm(root, { recursive: true, force: true }))

  test("copies images into the report and rewrites the markdown", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "result-test-"))
    await writeFile(path.join(root, "shot one.png"), png(800, 400))
    const store = new Store(path.join(root, "store"))

    const report = await store.create({
      sessionID: "ses_1",
      title: "Dark mode",
      status: "success",
      markdown: "Done.\n\n![Settings](<shot one.png>)",
      base: root,
    })

    expect(report.images).toEqual([
      expect.objectContaining({ file: "images/01-shot-one.png", width: 800, height: 400, alt: "Settings" }),
    ])
    expect(report.markdown).toContain("![Settings](<images/01-shot-one.png>)")
    expect(await readFile(path.join(report.dir, "images/01-shot-one.png"))).toEqual(Buffer.from(png(800, 400)))

    const appended = await store.append({
      sessionID: "ses_1",
      reportID: report.id,
      markdown: `![Again](${path.join(root, "shot one.png")})`,
      status: "partial",
      base: root,
    })
    expect(appended.images.map((image) => image.file)).toEqual(["images/01-shot-one.png", "images/02-shot-one.png"])
    expect(appended.status).toBe("partial")
    expect(await store.list(["ses_1", "ses_other"])).toEqual([expect.objectContaining({ id: report.id, imageCount: 2 })])
  })

  test("fails with every bad image and leaves no report behind", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "result-test-"))
    await writeFile(path.join(root, "notes.txt"), "not an image at all")
    const store = new Store(path.join(root, "store"))

    const attempt = store.create({
      sessionID: "ses_1",
      title: "Broken",
      status: "success",
      markdown: "![a](missing.png)\n![b](notes.txt)",
      base: root,
    })

    await expect(attempt).rejects.toThrow(/2 image\(s\)[\s\S]*missing\.png[\s\S]*notes\.txt: not a PNG/)
    expect(await store.list(["ses_1"])).toEqual([])
  })

  test("concurrent appends keep every image and every paragraph", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "result-test-"))
    await writeFile(path.join(root, "a.png"), png(10, 10))
    const store = new Store(path.join(root, "store"))
    const report = await store.create({ sessionID: "ses_1", title: "T", status: "success", markdown: "start", base: root })

    await Promise.all(
      [1, 2, 3].map((n) =>
        store.append({ sessionID: "ses_1", reportID: report.id, markdown: `part ${n}
![n${n}](a.png)`, base: root }),
      ),
    )

    const final = (await store.get("ses_1", report.id))!
    expect(final.images.map((image) => image.file)).toEqual(["images/01-a.png", "images/02-a.png", "images/03-a.png"])
    for (const n of [1, 2, 3]) expect(final.markdown).toContain(`part ${n}`)
  })

  test("decodes percent-encoded data URLs as raw bytes", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "result-test-"))
    const bytes = png(3, 2)
    const encoded = [...bytes].map((byte) => "%" + byte.toString(16).padStart(2, "0")).join("")
    const store = new Store(path.join(root, "store"))
    const report = await store.create({
      sessionID: "ses_1",
      title: "T",
      status: "success",
      markdown: `![x](data:image/png,${encoded})`,
      base: root,
    })
    expect(report.images[0]).toMatchObject({ width: 3, height: 2 })
  })

  test("rejects IDs that would escape the store", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "result-test-"))
    const store = new Store(path.join(root, "store"))
    await expect(store.imagePath("..", "x", "images/01.png")).rejects.toThrow(/invalid/)
  })
})
