/** @jsxImportSource @opentui/solid */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import {
  MacOSScrollAccel,
  NativeImage,
  RGBA,
  type BoxRenderable,
  type MouseEvent,
  type ScrollBoxRenderable,
  type SyntaxStyle,
} from "@opentui/core"
import { Portal, useTerminalDimensions } from "@opentui/solid"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { splitSections, type Section } from "./markdown"
import { ResultRpc, type Report, type ReportChanged, type ReportStatus, type ReportSummary } from "./rpc"
import { markdownSyntax } from "./syntax"

const MAX_SIDEBAR_ITEMS = 8
const MAX_WIDTH = 220
const LEGEND_WIDTH = 34
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

  const [shown, setShown] = createSignal<{ ref: Ref; fromList: boolean }>()

  /** Opens one report. Opened from the list, closing it returns to the list; otherwise to the session. */
  const open = (ref: Ref, fromList = false) => {
    context.ui.dialog.clear()
    setShown({ ref, fromList })
  }

  const close = () => {
    const current = shown()
    setShown(undefined)
    repaint()
    if (current?.fromList) setTimeout(() => void openList(current.ref.sessionID))
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

  type Visible = "moving" | { from: number; to: number }

  function ImageBlock(props: {
    report: Report
    file: string
    alt: string
    width: number
    maxHeight: number
    visible: (box: BoxRenderable | undefined, height: number) => Visible
  }) {
    const info = () => props.report.images.find((image) => image.file === props.file)
    const local = createMemo(() => {
      const file = path.join(props.report.dir, props.file)
      return existsSync(file) ? file : undefined
    })
    const owner = context.renderer.nativeScene.resourceContext
    // A remote server's files are not on this machine, so fetch the bytes over RPC.
    const image = asyncValue(
      () => ({ report: props.report, file: props.file, local: local() }),
      async (input): Promise<NativeImage | undefined> => {
        if (input.local) return NativeImage.load(input.local, { owner })
        const { data } = (await api.image({
          sessionID: input.report.sessionID,
          reportID: input.report.id,
          file: input.file,
        })) as { data?: string }
        return data ? NativeImage.load(new Uint8Array(Buffer.from(data, "base64")), { owner }) : undefined
      },
      undefined,
    )
    let previous: NativeImage | undefined
    createEffect(() => {
      const current = image()
      if (previous && previous !== current) previous.dispose()
      previous = current
    })
    // Cells are about twice as tall as wide; never wider than the image itself.
    const size = createMemo(() => {
      const meta = info()
      const maxHeight = Math.max(4, props.maxHeight)
      if (!meta?.width || !meta.height) return { width: props.width, height: Math.min(maxHeight, 12) }
      let width = Math.min(props.width, Math.ceil(meta.width / 8))
      let height = Math.round((width * meta.height) / meta.width / 2)
      if (height > maxHeight) {
        height = maxHeight
        width = Math.round((height * 2 * meta.width) / meta.height)
      }
      return { width: Math.max(4, width), height: Math.max(2, height) }
    })
    let box: BoxRenderable | undefined
    // Terminal graphics cannot be clipped, so a partly visible image shows only its visible rows, cropped.
    let crop: NativeImage | undefined
    const view = createMemo(() => {
      const source = image()
      if (!source) return undefined
      const height = size().height
      const visible = props.visible(box, height)
      crop?.dispose()
      crop = undefined
      if (visible === "moving" || visible.to <= visible.from)
        return { source, protocol: "blocks" as const, from: 0, rows: height }
      if (visible.from === 0 && visible.to === height) return { source, protocol: "auto" as const, from: 0, rows: height }
      const top = Math.round((source.height * visible.from) / height)
      const bottom = Math.max(top + 1, Math.round((source.height * visible.to) / height))
      crop = source.extract({ left: 0, top, width: source.width, height: Math.min(source.height, bottom) - top })
      return { source: crop, protocol: "auto" as const, from: visible.from, rows: visible.to - visible.from }
    })
    onCleanup(() => {
      crop?.dispose()
      previous?.dispose()
    })
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
          <Show when={view()} fallback={<text fg={theme().text.muted}>Loading image…</text>}>
            {(current) => (
              <image
                source={current().source}
                fit="fill"
                protocol={current().protocol}
                width={size().width}
                height={current().rows}
                marginTop={current().from}
              />
            )}
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
    const dimensions = useTerminalDimensions()
    const width = () => Math.min(MAX_WIDTH, dimensions().width - 8)
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

    const visible = (box: BoxRenderable | undefined, rows: number): Visible => {
      layoutTick()
      if (scrolling() || !box || !scroll || box.isDestroyed) return "moving"
      const viewport = scroll.viewport
      const from = Math.max(0, viewport.screenY - box.screenY)
      const to = Math.min(rows, viewport.screenY + viewport.height - box.screenY)
      return { from, to: Math.max(from, to) }
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
        { title: props.fromList ? "Back to results" : "Close result", group: "Results", bind: "escape,q", run: close },
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
                                maxHeight={height() - 8}
                                visible={visible}
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

  /** Our own modal instead of the host dialog, which is at most 116 columns wide. */
  function Overlay() {
    const dimensions = useTerminalDimensions()
    createEffect(() => {
      if (!shown()) return
      // Like the host dialog: take focus from the prompt and route keys to modal layers.
      const focused = context.renderer.currentFocusedRenderable
      focused?.blur()
      const pop = context.keymap.mode.push("modal")
      onCleanup(() => {
        pop()
        if (focused && !focused.isDestroyed) focused.focus()
      })
    })
    const stop = (event: MouseEvent) => event.stopPropagation()
    return (
      <Show when={shown()} keyed>
        {(current) => (
          <Portal
            mount={context.renderer.root}
            ref={(element) => {
              // Portal wraps its content in a flex child; pin that wrapper over the whole screen.
              const container = element as BoxRenderable
              container.position = "absolute"
              container.left = 0
              container.top = 0
              container.zIndex = 1000
            }}
          >
            <box
              position="absolute"
              left={0}
              top={0}
              zIndex={1000}
              width={dimensions().width}
              height={dimensions().height}
              backgroundColor={RGBA.fromValues(0, 0, 0, 0.55)}
              justifyContent="center"
              alignItems="center"
              onMouseDown={stop}
              onMouseUp={(event: MouseEvent) => {
                stop(event)
                if (event.target === event.currentTarget) close()
              }}
              onMouseScroll={stop}
            >
              <box
                backgroundColor={theme().background.raised.base}
                border
                borderStyle="rounded"
                borderColor={theme().text.muted}
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                onMouseUp={stop}
              >
                <ReportDialog target={current.ref} fromList={current.fromList} />
              </box>
            </box>
          </Portal>
        )}
      </Show>
    )
  }

  return { Sidebar, Overlay, open, openCurrent, stopEvents }
}

export default Plugin.define({
  id: "result.tui",
  setup(context) {
    const syntax = markdownSyntax(context.theme, context.renderer.nativeScene)
    const ui = createUI(context, syntax)

    const stopOverlay = context.ui.slot({ append: "app", render: () => <ui.Overlay /> })
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
      stopOverlay()
      void context.renderer.idle().then(() => syntax.destroy())
    }
  },
})
