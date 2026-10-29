import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { sniffImage } from "./image"
import { joinMarkdown, splitMarkdown, type Block } from "./markdown"
import type { Report, ReportImage, ReportStatus, ReportSummary } from "./rpc"

const MAX_IMAGE_BYTES = 64 * 1024 * 1024
const FETCH_TIMEOUT = 20_000
const SAFE_ID = /^\w[\w.-]*$/

export function defaultRoot() {
  const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  return path.join(data, "opencode", "result")
}

export function summarize(report: Report): ReportSummary {
  const { id, sessionID, title, status, createdAt, updatedAt, imageCount } = report
  return { id, sessionID, title, status, createdAt, updatedAt, imageCount }
}

function newID() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function safeName(value: string) {
  return (
    value
      .replace(/\.[^.]*$/, "")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "image"
  )
}

async function readSource(src: string, base: string, signal?: AbortSignal) {
  if (src.startsWith("data:")) {
    const comma = src.indexOf(",")
    if (comma === -1) throw new Error("malformed data URL")
    const payload = src.slice(comma + 1)
    return {
      bytes: src.slice(0, comma).endsWith(";base64")
        ? new Uint8Array(Buffer.from(payload, "base64"))
        : new Uint8Array(Buffer.from(payload.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), "latin1")),
      name: "image",
    }
  }
  if (/^https?:\/\//i.test(src)) {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT)
    const response = await fetch(src, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("larger than 64 MiB")
    return { bytes: new Uint8Array(await response.arrayBuffer()), name: path.basename(new URL(src).pathname) }
  }
  let file = src.startsWith("file:") ? fileURLToPath(src) : src
  if (file === "~" || file.startsWith("~/") || file.startsWith("~\\")) file = path.join(os.homedir(), file.slice(1))
  file = path.resolve(base, file)
  return { bytes: new Uint8Array(await readFile(file)), name: path.basename(file) }
}

export class Store {
  private locks = new Map<string, Promise<unknown>>()

  constructor(readonly root: string) {}

  /** Runs read-modify-write updates of one report one at a time. */
  private exclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(task, task)
    const tail = run.catch(() => {})
    this.locks.set(key, tail)
    void tail.then(() => this.locks.get(key) === tail && this.locks.delete(key))
    return run
  }

  private dir(sessionID: string, reportID?: string) {
    const safe = (id: unknown) => typeof id === "string" && SAFE_ID.test(id)
    if (!safe(sessionID) || (reportID !== undefined && !safe(reportID)))
      throw new Error("invalid session or report ID")
    return reportID ? path.join(this.root, sessionID, reportID) : path.join(this.root, sessionID)
  }

  async get(sessionID: string, reportID: string): Promise<Report | undefined> {
    const dir = this.dir(sessionID, reportID)
    try {
      return { ...JSON.parse(await readFile(path.join(dir, "report.json"), "utf8")), dir }
    } catch {
      return undefined
    }
  }

  async list(sessionIDs: readonly string[]): Promise<ReportSummary[]> {
    const lists = await Promise.all(
      sessionIDs.map(async (sessionID) => {
        const ids = await readdir(this.dir(sessionID)).catch(() => [] as string[])
        const reports = await Promise.all(ids.filter((id) => SAFE_ID.test(id)).map((id) => this.get(sessionID, id)))
        return reports.filter((report) => report !== undefined).map(summarize)
      }),
    )
    return lists.flat().sort((a, b) => b.createdAt - a.createdAt)
  }

  async imagePath(sessionID: string, reportID: string, file: string) {
    const report = await this.get(sessionID, reportID)
    if (!report?.images.some((image) => image.file === file)) return undefined
    return path.join(report.dir, file)
  }

  async remove(sessionID: string, reportID: string) {
    await rm(this.dir(sessionID, reportID), { recursive: true, force: true })
  }

  async create(input: {
    sessionID: string
    title: string
    status: ReportStatus
    markdown: string
    base: string
    signal?: AbortSignal
  }): Promise<Report> {
    const id = newID()
    const dir = this.dir(input.sessionID, id)
    await mkdir(dir, { recursive: true })
    try {
      const { markdown, images } = await this.importImages(dir, input.markdown, input.base, [], input.signal)
      const now = Date.now()
      const report: Report = {
        id,
        sessionID: input.sessionID,
        title: input.title,
        status: input.status,
        createdAt: now,
        updatedAt: now,
        imageCount: images.length,
        markdown,
        images,
        dir,
      }
      await this.write(report)
      return report
    } catch (error) {
      await rm(dir, { recursive: true, force: true })
      throw error
    }
  }

  async append(input: {
    sessionID: string
    reportID: string
    markdown?: string
    title?: string
    status?: ReportStatus
    base: string
    signal?: AbortSignal
  }): Promise<Report> {
    return this.exclusive(this.dir(input.sessionID, input.reportID), () => this.appendNow(input))
  }

  private async appendNow(input: Parameters<Store["append"]>[0]): Promise<Report> {
    const current = await this.get(input.sessionID, input.reportID)
    if (!current) throw new Error(`Report ${input.reportID} not found in this session. Use result_list to see reports.`)
    const added = input.markdown?.trim()
      ? await this.importImages(current.dir, input.markdown, input.base, current.images, input.signal)
      : { markdown: "", images: current.images }
    const report: Report = {
      ...current,
      title: input.title ?? current.title,
      status: input.status ?? current.status,
      markdown: [current.markdown, added.markdown].filter(Boolean).join("\n\n"),
      images: added.images,
      imageCount: added.images.length,
      updatedAt: Date.now(),
    }
    await this.write(report)
    return report
  }

  private async write(report: Report) {
    const { dir, ...stored } = report
    // Write then rename, so a crash never leaves a half-written report.json behind.
    const temp = path.join(dir, `report.json.${process.pid}.tmp`)
    await writeFile(temp, JSON.stringify(stored, null, 2))
    await rename(temp, path.join(dir, "report.json"))
  }

  /** Copies every referenced image into the report and points the markdown at the copies. */
  private async importImages(
    dir: string,
    markdown: string,
    base: string,
    existing: readonly ReportImage[],
    signal?: AbortSignal,
  ) {
    const images = [...existing]
    const failures: string[] = []
    const blocks: Block[] = []
    for (const block of splitMarkdown(markdown)) {
      if (block.type !== "image") {
        blocks.push(block)
        continue
      }
      try {
        const { bytes, name } = await readSource(block.src, base, signal)
        if (bytes.length > MAX_IMAGE_BYTES) throw new Error("larger than 64 MiB")
        const kind = sniffImage(bytes)
        if (!kind) throw new Error("not a PNG, JPEG, GIF or WebP image")
        const file = `images/${String(images.length + 1).padStart(2, "0")}-${safeName(name)}.${kind.ext}`
        await mkdir(path.join(dir, "images"), { recursive: true })
        await writeFile(path.join(dir, file), bytes)
        images.push({ file, alt: block.alt, mime: kind.mime, width: kind.width, height: kind.height, source: block.src })
        blocks.push({ ...block, src: file })
      } catch (error) {
        failures.push(`- ${block.src}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (failures.length)
      throw new Error(
        `Could not add ${failures.length} image(s):\n${failures.join("\n")}\nUse absolute paths, paths relative to ${base}, http(s) URLs or data URLs.`,
      )
    return { markdown: joinMarkdown(blocks), images }
  }
}
