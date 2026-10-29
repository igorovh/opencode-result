/** @jsxImportSource @opentui/solid */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import {
  MacOSScrollAccel,
  type BoxRenderable,
  type MouseEvent,
  type ScrollBoxRenderable,
  type SyntaxStyle,
} from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { splitSections, type Section } from "./markdown"
import { ResultRpc, type Report, type ReportChanged, type ReportStatus, type ReportSummary } from "./rpc"
import { markdownSyntax } from "./syntax"

const MAX_SIDEBAR_ITEMS = 8
const DIALOG_WIDTH = 116
const LEGEND_WIDTH = 32
const SCROLL_STEP = 2
// Images switch from blocks to full quality this long after scrolling stops.
const SCROLL_SETTLE_MS = 120

type Ref = { sessionID: string; reportID: string }

function truncate(value: string, width: number) {
  if (width <= 0) return ""
  return value.length <= width ? value : value.slice(0, Math.max(0, width - 1)) + "…"
}

function formatTime(time: number) {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, "0")
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.toDateString() === new Date().toDateString()) return clock
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`
}

function openExternal(target: string) {
  const [command, args] =
    process.platform === "win32"
      ? ["explorer.exe", [target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]]
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref()
}

/** Like createResource, but never suspends the host's UI while loading. */
function asyncValue<S, T>(source: () => S, load: (input: S) => Promise<T>, initial: T) {
  const [value, setValue] = createSignal<T>(initial)
  let request = 0
  createEffect(() => {
    const input = source()
    const id = ++request
    load(input).then(
      (result) => id === request && setValue(() => result),
      () => {},
    )
  })
  return value
}

function createUI(context: Context, syntax: SyntaxStyle) {
  const api = context.client.rpc(ResultRpc)
  const theme = () => context.theme
  const [version, setVersion] = createSignal(0)

  const familyOf = (sessionID: string) => [...new Set([sessionID, ...context.data.session.family(sessionID)])]

  const fetchList = async (sessionIDs: string[]) =>
    ((await api.list({ sessionIDs })) as { reports: ReportSummary[] }).reports

  const fetchReport = async (ref: Ref) => ((await api.get(ref)) as { report?: Report }).report

  // Sixel and Kitty pixels are not cells, so the diff renderer can leave them behind; redraw everything.
  const repaint = () => {
    ;(context.renderer as unknown as { forceFullRepaintRequested: boolean }).forceFullRepaintRequested = true
    context.renderer.requestRender()
  }

  const statusMark = (status: ReportStatus) => {
    const feedback = theme().text.feedback
    if (status === "failed") return { char: "✕", color: feedback.error.base }
    if (status === "partial") return { char: "◐", color: feedback.warning.base }
    if (status === "info") return { char: "●", color: feedback.info.base }
    return { char: "●", color: feedback.success.base }
  }

  /** Opens one report. Opened from the list, closing it returns to the list; otherwise to the session. */
  const open = (ref: Ref, fromList = false) => {
    context.ui.dialog.show(
      () => <ReportDialog target={ref} fromList={fromList} />,
      () => {
        repaint()
        // Let the host finish closing this dialog before it shows the next one.
        if (fromList) setTimeout(() => void openList(ref.sessionID))
      },
    )
    context.ui.dialog.set({ size: "xlarge", centered: true })
  }

  const openList = async (sessionID: string) => {
    const reports = await fetchList(familyOf(sessionID))
    if (!reports.length) return context.ui.toast.show({ message: "No results in this session yet", variant: "info" })
    const picked = await context.ui.dialog.select({
      title: "Results",
      placeholder: "Search results",
      options: reports.map((report) => ({
        title: `${statusMark(report.status).char} ${report.title}`,
        value: report,
        description: report.status + (report.imageCount ? ` · ▣${report.imageCount}` : ""),
        footer: formatTime(report.createdAt),
      })),
    })
    if (picked) open({ sessionID: picked.sessionID, reportID: picked.id }, true)
  }

  const openCurrent = () => {
    const route = context.ui.router.current()
    if (route.type !== "session") return context.ui.toast.show({ message: "Open a session first", variant: "warning" })
    void openList(route.sessionID).catch((error) =>
      context.ui.toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" }),
    )
  }

  const stopEvents = api.events.on("changed", (event) => {
    setVersion((value) => value + 1)
    const data = event.data as unknown as ReportChanged
    if (data.created)
      context.ui.toast.show({ title: "New result", message: data.title, variant: "success", sessionID: data.sessionID })
  })

  function Row(props: {
    width: number
    active?: boolean
    onSelect: () => void
    children: (width: number) => any
  }) {
    const [hovered, setHovered] = createSignal(false)
    return (
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        backgroundColor={props.active ? theme().background.raised.max : hovered() ? theme().background.raised.high : undefined}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={(event: MouseEvent) => {
          if (event.button !== 0) return
          event.stopPropagation()
          props.onSelect()
        }}
      >
        {props.children(props.width)}
      </box>
    )
  }

  function ReportRow(props: { report: ReportSummary; width: number; onSelect: () => void }) {
    const mark = () => statusMark(props.report.status)
    const meta = () =>
      (props.report.imageCount ? ` ▣${props.report.imageCount}` : "") +
      " " + formatTime(props.report.createdAt)
    return (
      <Row width={props.width} onSelect={props.onSelect}>
        {(width) => (
          <>
            <text selectable={false} fg={mark().color}>{mark().char + " "}</text>
            <text selectable={false} fg={theme().text.base}>{truncate(props.report.title, width - 3 - meta().length)}</text>
            <box flexGrow={1} />
            <text selectable={false} fg={theme().text.muted}>{meta()}</text>
          </>
        )}
      </Row>
    )
  }

  function Sidebar(props: { sessionID: string }) {
    const sessionIDs = createMemo(() => familyOf(props.sessionID), [], {
      equals: (a, b) => a.join() === b.join(),
    })
    const reports = asyncValue(() => ({ ids: sessionIDs(), version: version() }), ({ ids }) => fetchList(ids), [])
    const [width, setWidth] = createSignal(30)
    return (
      <Show when={reports().length > 0}>
        <box
          flexDirection="column"
          flexShrink={0}
          onSizeChange={function (this: { width: number }) {
            setWidth(this.width)
          }}
        >
          <box flexDirection="row" flexShrink={0} onMouseUp={() => void openList(props.sessionID)}>
            <text fg={theme().text.base}>
              <b>Results</b>
            </text>
            <box flexGrow={1} />
            <text fg={theme().text.muted}>{String(reports().length)}</text>
          </box>
          <For each={reports().slice(0, MAX_SIDEBAR_ITEMS)}>
            {(report) => (
              <ReportRow
                report={report}
                width={width()}
                onSelect={() => open({ sessionID: report.sessionID, reportID: report.id })}
              />
            )}
          </For>
          <Show when={reports().length > MAX_SIDEBAR_ITEMS}>
            <box height={1} flexShrink={0} onMouseUp={() => void openList(props.sessionID)}>
              <text fg={theme().text.muted}>{`… ${reports().length - MAX_SIDEBAR_ITEMS} more (/results)`}</text>
            </box>
          </Show>
        </box>
      </Show>
    )
  }

  function ImageBlock(props: {
    report: Report
    file: string
    alt: string
    width: number
    maxHeight: number
    crisp: (box: BoxRenderable | undefined) => boolean
  }) {
    const info = () => props.report.images.find((image) => image.file === props.file)
    const local = createMemo(() => {
      const file = path.join(props.report.dir, props.file)
      return existsSync(file) ? file : undefined
    })
    // A remote server's files are not on this machine, so fetch the bytes over RPC.
    const source = asyncValue(
      () => ({ report: props.report, file: props.file, local: local() }),
      async (input): Promise<string | Uint8Array | undefined> => {
        if (input.local) return input.local
        const { data } = (await api.image({
          sessionID: input.report.sessionID,
          reportID: input.report.id,
          file: input.file,
        })) as { data?: string }
        return data ? new Uint8Array(Buffer.from(data, "base64")) : undefined
      },
      undefined,
    )
    // Cells are about twice as tall as wide; never wider than the image itself.
    const size = createMemo(() => {
      const image = info()
      const maxHeight = Math.max(4, props.maxHeight)
      if (!image?.width || !image.height) return { width: props.width, height: Math.min(maxHeight, 12) }
      let width = Math.min(props.width, Math.ceil(image.width / 8))
      let height = Math.round((width * image.height) / image.width / 2)
      if (height > maxHeight) {
        height = maxHeight
        width = Math.round((height * 2 * image.width) / image.height)
      }
      return { width: Math.max(4, width), height: Math.max(2, height) }
    })
    let box: BoxRenderable | undefined
    return (
      <box flexDirection="column" flexShrink={0}>
        <box
          ref={(element: BoxRenderable) => (box = element)}
          width={size().width}
          height={size().height}
          flexShrink={0}
          onMouseUp={(event: MouseEvent) => {
            const file = local()
            if (event.button === 0 && file) openExternal(file)
          }}
        >
          <Show when={source()} fallback={<text fg={theme().text.muted}>Loading image…</text>}>
            {/* Blocks are plain cells, so they clip cleanly while the image is moving or cut off. */}
            <image
              source={source()}
              fit="fit"
              protocol={props.crisp(box) ? "auto" : "blocks"}
              width={size().width}
              height={size().height}
            />
          </Show>
        </box>
        <Show when={props.alt}>
          <text fg={theme().text.muted}>
            <i>{props.alt}</i>
          </text>
        </Show>
      </box>
    )
  }

  function ReportDialog(props: { target: Ref; fromList: boolean }) {
    context.ui.dialog.set({ size: "xlarge", centered: true })
    const dimensions = useTerminalDimensions()
    const width = () => Math.min(DIALOG_WIDTH, dimensions().width - 2) - 4
    const height = () => Math.max(12, dimensions().height - 6)
    const contentWidth = () => Math.max(20, width() - LEGEND_WIDTH - 3)

    const report = asyncValue(
      () => ({ target: props.target, version: version() }),
      ({ target }) => fetchReport(target),
      undefined as Report | undefined,
    )
    const sections = createMemo(() => splitSections(report()?.markdown ?? ""))
    const outline = createMemo(() =>
      sections()
        .map((section, index) => ({ section, index }))
        .filter(({ section }) => section.type === "image" || section.heading),
    )

    let scroll: ScrollBoxRenderable | undefined
    const blocks: (BoxRenderable | undefined)[] = []
    const offsetOf = (index: number) => {
      const block = blocks[index]
      if (!scroll || !block || block.isDestroyed) return undefined
      return block.screenY - scroll.content.screenY
    }

    const [scrolling, setScrolling] = createSignal(true)
    const [layoutTick, setLayoutTick] = createSignal(0)
    const [activeIndex, setActiveIndex] = createSignal(-1)
    let lastTop = -1
    let lastHeight = -1
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    const poll = setInterval(() => {
      if (!scroll || scroll.isDestroyed) return
      const top = scroll.scrollTop
      const viewport = scroll.viewport.height
      if (top === lastTop && viewport === lastHeight) return
      lastTop = top
      lastHeight = viewport
      setScrolling(true)
      let active = -1
      for (const { index } of outline()) {
        const offset = offsetOf(index)
        if (offset !== undefined && offset <= top + 1) active = index
      }
      setActiveIndex(active)
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        setLayoutTick((value) => value + 1)
        setScrolling(false)
      }, SCROLL_SETTLE_MS)
    }, 30)
    onCleanup(() => {
      clearInterval(poll)
      clearTimeout(settleTimer)
    })
    createEffect(on(scrolling, repaint, { defer: true }))

    const crisp = (box: BoxRenderable | undefined) => {
      layoutTick()
      if (scrolling() || !box || !scroll || box.isDestroyed) return false
      const viewport = scroll.viewport
      return box.screenY >= viewport.screenY && box.screenY + box.height <= viewport.screenY + viewport.height
    }

    const jumpTo = (index: number) => {
      const offset = offsetOf(index)
      if (offset !== undefined) scroll?.scrollTo(offset)
    }
    const jumpSection = (delta: number) => {
      const list = outline().map(({ index }) => index)
      const top = scroll?.scrollTop ?? 0
      const target =
        delta > 0
          ? list.find((index) => (offsetOf(index) ?? 0) > top + 1)
          : list.findLast((index) => (offsetOf(index) ?? 0) < top - 1)
      if (target !== undefined) jumpTo(target)
      else if (delta < 0) scroll?.scrollTo(0)
    }
    const page = () => Math.max(1, (scroll?.viewport.height ?? 10) - 3)

    context.keymap.layer(() => ({
      mode: "modal",
      priority: 50,
      commands: [
        { title: "Scroll up", group: "Results", bind: "up,k", run: () => scroll?.scrollBy(-SCROLL_STEP) },
        { title: "Scroll down", group: "Results", bind: "down,j", run: () => scroll?.scrollBy(SCROLL_STEP) },
        { title: "Page up", group: "Results", bind: "pageup,b", run: () => scroll?.scrollBy(-page()) },
        { title: "Page down", group: "Results", bind: "pagedown,space", run: () => scroll?.scrollBy(page()) },
        { title: "Top", group: "Results", bind: "home,g", run: () => scroll?.scrollTo(0) },
        { title: "Bottom", group: "Results", bind: "end,shift+g", run: () => scroll?.scrollTo(scroll.scrollHeight) },
        { title: "Next section", group: "Results", bind: "n,right,l", run: () => jumpSection(1) },
        { title: "Previous section", group: "Results", bind: "p,left,h", run: () => jumpSection(-1) },
        {
          title: "Open report folder",
          group: "Results",
          bind: "o",
          run: () => {
            const dir = report()?.dir
            if (dir && existsSync(dir)) openExternal(dir)
          },
        },
      ],
    }))

    const legendLabel = (section: Section) =>
      section.type === "image"
        ? "▣ " + (section.alt || "image")
        : "  ".repeat(Math.max(0, (section.heading?.level ?? 2) - 2)) + (section.heading?.text ?? "")

    return (
      <box flexDirection="column" width={width()} height={height()}>
        <box flexDirection="row" flexShrink={0}>
          <Show when={report()} fallback={<text fg={theme().text.base}><b>Result</b></text>}>
            {(loaded) => (
              <>
                <text fg={statusMark(loaded().status).color}>{statusMark(loaded().status).char + " "}</text>
                <text fg={theme().text.base}>
                  <b>{truncate(loaded().title, contentWidth() - 2)}</b>
                </text>
                <box flexGrow={1} />
                <text fg={theme().text.muted}>
                  {`${loaded().status} · ${formatTime(loaded().createdAt)}` +
                    (loaded().imageCount ? ` · ▣${loaded().imageCount}` : "")}
                </text>
              </>
            )}
          </Show>
        </box>
        <box flexDirection="row" flexGrow={1} minHeight={0} marginTop={1}>
          <Show
            when={report()}
            fallback={<text fg={theme().text.muted}>Loading result…</text>}
          >
            {(loaded) => (
              <scrollbox
                ref={(element: ScrollBoxRenderable) => (scroll = element)}
                width={contentWidth()}
                flexShrink={0}
                minHeight={0}
                scrollAcceleration={new MacOSScrollAccel()}
              >
                <box flexDirection="column" flexShrink={0} gap={1} paddingRight={1}>
                  <For each={sections()}>
                    {(section, index) => (
                      <box ref={(element: BoxRenderable) => (blocks[index()] = element)} flexShrink={0}>
                        <Switch>
                          <Match when={section.type === "markdown" && section}>
                            {(text) => (
                              <markdown content={text().text} syntaxStyle={syntax} conceal width={contentWidth() - 2} flexShrink={0} />
                            )}
                          </Match>
                          <Match when={section.type === "image" && section}>
                            {(image) => (
                              <ImageBlock
                                report={loaded()}
                                file={image().src}
                                alt={image().alt}
                                width={contentWidth() - 2}
                                maxHeight={height() - 6}
                                crisp={crisp}
                              />
                            )}
                          </Match>
                        </Switch>
                      </box>
                    )}
                  </For>
                </box>
              </scrollbox>
            )}
          </Show>
          <box flexGrow={1} />
          <box
            width={LEGEND_WIDTH}
            flexShrink={0}
            flexDirection="column"
            border={["left"]}
            borderColor={theme().border?.base ?? theme().text.muted}
            paddingLeft={1}
          >
            <scrollbox flexGrow={1} minHeight={0}>
              <text fg={theme().text.muted}>CONTENTS</text>
              <Show when={outline().length > 0} fallback={<text fg={theme().text.muted}>No sections</text>}>
                <For each={outline()}>
                  {(entry) => (
                    <Row width={LEGEND_WIDTH - 3} active={activeIndex() === entry.index} onSelect={() => jumpTo(entry.index)}>
                      {(rowWidth) => (
                        <text
                          selectable={false}
                          fg={entry.section.type === "image" ? theme().text.muted : theme().text.base}
                        >
                          {truncate(legendLabel(entry.section), rowWidth)}
                        </text>
                      )}
                    </Row>
                  )}
                </For>
              </Show>
            </scrollbox>
          </box>
        </box>
        <text fg={theme().text.muted} marginTop={1}>
          {`↑↓ scroll · space page · n/p section · o folder · click image to open · esc ${props.fromList ? "back" : "close"}`}
        </text>
      </box>
    )
  }

  return { Sidebar, open, openCurrent, stopEvents }
}

export default Plugin.define({
  id: "result.tui",
  setup(context) {
    const syntax = markdownSyntax(context.theme, context.renderer.nativeScene)
    const ui = createUI(context, syntax)

    const stopSidebar = context.ui.slot({
      append: "sidebar.content",
      render: (input) => <ui.Sidebar sessionID={input.sessionID} />,
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "result.open",
          title: "Show results",
          group: "Results",
          palette: true,
          slash: { name: "results" },
          run: ui.openCurrent,
        },
      ],
    }))

    return () => {
      ui.stopEvents()
      stopSidebar()
      void context.renderer.idle().then(() => syntax.destroy())
    }
  },
})
