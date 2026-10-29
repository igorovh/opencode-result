/** @jsxImportSource @opentui/solid */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import type { BoxRenderable, MouseEvent, ScrollBoxRenderable, SyntaxStyle } from "@opentui/core"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { splitMarkdown } from "./markdown"
import { ResultRpc, type Report, type ReportChanged, type ReportStatus, type ReportSummary } from "./rpc"
import { markdownSyntax } from "./syntax"

const ROUTE = "result"
const MAX_SIDEBAR_ITEMS = 8
// Images reappear this long after scrolling stops.
const SCROLL_SETTLE_MS = 150

type Ref = { sessionID: string; reportID: string }
type RouteData = { sessionID: string; reportID?: string }

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

  const currentRoute = (): RouteData | undefined => {
    const route = context.ui.router.current()
    return route.type === "plugin" && route.name === ROUTE ? (route.data as RouteData) : undefined
  }

  const navigate = (data: RouteData) => context.ui.router.navigate({ type: "plugin", name: ROUTE, data })

  const back = () => {
    const data = currentRoute()
    if (!data) return
    if (data.reportID && data.sessionID) navigate({ sessionID: data.sessionID })
    else context.ui.router.navigate({ type: "session", sessionID: data.sessionID })
  }

  const openList = () => {
    const route = context.ui.router.current()
    const sessionID = route.type === "session" ? route.sessionID : currentRoute()?.sessionID
    if (!sessionID) return context.ui.toast.show({ message: "Open a session first", variant: "warning" })
    navigate({ sessionID })
  }

  const stopEvents = api.events.on("changed", (event) => {
    setVersion((value) => value + 1)
    const data = event.data as unknown as ReportChanged
    if (data.created)
      context.ui.toast.show({ title: "New result", message: data.title, variant: "success", sessionID: data.sessionID })
  })

  function ReportRow(props: { report: ReportSummary; width: number; active?: boolean; onSelect: () => void }) {
    const [hovered, setHovered] = createSignal(false)
    const mark = () => statusMark(props.report.status)
    const time = () => formatTime(props.report.createdAt)
    const images = () => (props.report.imageCount ? ` ▣${props.report.imageCount}` : "")
    const titleWidth = () => props.width - 2 - time().length - images().length - 1
    return (
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        backgroundColor={props.active || hovered() ? theme().background.raised.high : undefined}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={(event: MouseEvent) => {
          if (event.button !== 0) return
          event.stopPropagation()
          props.onSelect()
        }}
      >
        <text selectable={false} fg={mark().color}>{mark().char + " "}</text>
        <text selectable={false} fg={theme().text.base}>{truncate(props.report.title, titleWidth())}</text>
        <box flexGrow={1} />
        <text selectable={false} fg={theme().text.muted}>{images() + " " + time()}</text>
      </box>
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
          <box flexDirection="row" flexShrink={0} onMouseUp={() => navigate({ sessionID: props.sessionID })}>
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
                onSelect={() => navigate({ sessionID: props.sessionID, reportID: report.id })}
              />
            )}
          </For>
          <Show when={reports().length > MAX_SIDEBAR_ITEMS}>
            <box height={1} flexShrink={0} onMouseUp={() => navigate({ sessionID: props.sessionID })}>
              <text fg={theme().text.muted}>{`… ${reports().length - MAX_SIDEBAR_ITEMS} more (/results)`}</text>
            </box>
          </Show>
        </box>
      </Show>
    )
  }

  function Header(props: { title: string; hint: string }) {
    return (
      <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1} backgroundColor={theme().background.raised.base}>
        <text fg={theme().text.base}>
          <b>{props.title}</b>
        </text>
        <box flexGrow={1} />
        <text fg={theme().text.muted}>{props.hint}</text>
      </box>
    )
  }

  function ListPage(props: { sessionID: string }) {
    const reports = asyncValue(
      () => ({ ids: familyOf(props.sessionID), version: version() }),
      ({ ids }) => fetchList(ids),
      [] as ReportSummary[],
    )
    const [index, setIndex] = createSignal(0)
    const current = () => reports()[Math.min(index(), reports().length - 1)]
    const move = (delta: number) => setIndex((value) => Math.max(0, Math.min(reports().length - 1, value + delta)))
    const open = (report = current()) => report && navigate({ sessionID: props.sessionID, reportID: report.id })
    const remove = async () => {
      const report = current()
      if (!report) return
      const confirmed = await context.ui.dialog.confirm({
        title: "Delete result",
        message: `Delete "${report.title}" and its images?`,
        label: { confirm: "Delete" },
      })
      if (confirmed) await api.remove({ sessionID: report.sessionID, reportID: report.id })
    }

    context.keymap.layer(() => ({
      priority: 50,
      commands: [
        { title: "Previous result", group: "Results", bind: "up,k", run: () => move(-1) },
        { title: "Next result", group: "Results", bind: "down,j", run: () => move(1) },
        { title: "Open result", group: "Results", bind: "return", run: () => void open() },
        { title: "Delete result", group: "Results", bind: "d,delete", run: () => void remove() },
        { title: "Back to session", group: "Results", bind: "escape,q", run: back },
      ],
    }))

    return (
      <box flexDirection="column" flexGrow={1}>
        <Header title="Results" hint="↑↓ select · enter open · d delete · esc back" />
        <Show
          when={reports().length > 0}
          fallback={<text fg={theme().text.muted}> No results in this session yet.</text>}
        >
          <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} marginTop={1}>
            <For each={reports()}>
              {(report, position) => (
                <ReportRow
                  report={report}
                  width={Math.max(10, context.renderer.width - 2)}
                  active={position() === index()}
                  onSelect={() => open(report)}
                />
              )}
            </For>
          </scrollbox>
        </Show>
      </box>
    )
  }

  function ImageBlock(props: {
    report: Report
    file: string
    alt: string
    width: number
    maxHeight: number
    shown: (box: BoxRenderable | undefined) => boolean
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
          <Show
            when={source() && props.shown(box)}
            fallback={
              <box
                width={size().width}
                height={size().height}
                border
                borderColor={theme().text.muted}
                justifyContent="center"
                alignItems="center"
              >
                <text fg={theme().text.muted}>{source() ? "▣ scroll to show the image" : "Loading image…"}</text>
              </box>
            }
          >
            <image source={source()} fit="fit" width={size().width} height={size().height} />
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

  function ReportPage(props: { target: Ref }) {
    const report = asyncValue(() => ({ target: props.target, version: version() }), ({ target }) => fetchReport(target), undefined)
    const blocks = createMemo(() => splitMarkdown(report()?.markdown ?? ""))
    const contentWidth = () => Math.max(10, Math.min(context.renderer.width - 4, 120))
    let scroll: ScrollBoxRenderable | undefined

    // Hide images while scrolling; show only fully visible ones once it stops.
    const [settled, setSettled] = createSignal(false)
    const [layoutTick, setLayoutTick] = createSignal(0)
    let lastTop = -1
    let lastHeight = -1
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    const poll = setInterval(() => {
      if (!scroll || scroll.isDestroyed) return
      const top = scroll.scrollTop
      const height = scroll.viewport.height
      if (top === lastTop && height === lastHeight) return
      lastTop = top
      lastHeight = height
      setSettled(false)
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        setLayoutTick((value) => value + 1)
        setSettled(true)
      }, SCROLL_SETTLE_MS)
    }, 40)
    onCleanup(() => {
      clearInterval(poll)
      clearTimeout(settleTimer)
      repaint()
    })
    createEffect(on(settled, repaint, { defer: true }))

    const shown = (box: BoxRenderable | undefined) => {
      layoutTick()
      if (!settled() || !box || !scroll || box.isDestroyed) return false
      const viewport = scroll.viewport
      return box.screenY >= viewport.screenY && box.screenY + box.height <= viewport.screenY + viewport.height
    }

    const scrollBy = (delta: number) => scroll?.scrollBy(delta)
    const page = () => Math.max(1, (scroll?.viewport.height ?? 10) - 2)

    context.keymap.layer(() => ({
      priority: 50,
      commands: [
        { title: "Scroll up", group: "Results", bind: "up,k", run: () => scrollBy(-1) },
        { title: "Scroll down", group: "Results", bind: "down,j", run: () => scrollBy(1) },
        { title: "Page up", group: "Results", bind: "pageup,b", run: () => scrollBy(-page()) },
        { title: "Page down", group: "Results", bind: "pagedown,space", run: () => scrollBy(page()) },
        { title: "Top", group: "Results", bind: "home,g", run: () => scroll?.scrollTo(0) },
        { title: "Bottom", group: "Results", bind: "end,shift+g", run: () => scroll?.scrollTo(scroll.scrollHeight) },
        {
          title: "Open report folder",
          group: "Results",
          bind: "o",
          run: () => {
            const dir = report()?.dir
            if (dir && existsSync(dir)) openExternal(dir)
          },
        },
        { title: "Back to results", group: "Results", bind: "escape,q,backspace", run: back },
      ],
    }))

    return (
      <box flexDirection="column" flexGrow={1}>
        <Header
          title={report() ? truncate(report()!.title, Math.max(10, context.renderer.width - 50)) : "Result"}
          hint="↑↓ space scroll · o folder · click image · esc back"
        />
        <Show when={report()} fallback={<text fg={theme().text.muted}> Loading result…</text>}>
          {(loaded) => (
            <scrollbox
              ref={(element: ScrollBoxRenderable) => (scroll = element)}
              flexGrow={1}
              minHeight={0}
            >
              <box flexDirection="column" flexShrink={0} gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
                <box flexDirection="row" flexShrink={0}>
                  <text fg={statusMark(loaded().status).color}>{statusMark(loaded().status).char + " "}</text>
                  <text fg={theme().text.muted}>
                    {`${loaded().status} · ${formatTime(loaded().createdAt)}` +
                      (loaded().imageCount
                        ? ` · ${loaded().imageCount} image${loaded().imageCount === 1 ? "" : "s"}`
                        : "")}
                  </text>
                </box>
                <For each={blocks()}>
                  {(block) => (
                    <Switch>
                      <Match when={block.type === "markdown" && block}>
                        {(text) => (
                          <markdown content={text().text} syntaxStyle={syntax} conceal width={contentWidth()} flexShrink={0} />
                        )}
                      </Match>
                      <Match when={block.type === "image" && block}>
                        {(image) => (
                          <ImageBlock
                            report={loaded()}
                            file={image().src}
                            alt={image().alt}
                            width={contentWidth()}
                            maxHeight={context.renderer.height - 6}
                            shown={shown}
                          />
                        )}
                      </Match>
                    </Switch>
                  )}
                </For>
              </box>
            </scrollbox>
          )}
        </Show>
      </box>
    )
  }

  function Page(props: { data?: Record<string, any> }) {
    const data = () => props.data as RouteData | undefined
    return (
      <Show when={data()?.sessionID} fallback={<text> No session selected.</text>}>
        <Show
          when={data()?.reportID}
          keyed
          fallback={<ListPage sessionID={data()!.sessionID} />}
        >
          {(reportID) => <ReportPage target={{ sessionID: data()!.sessionID, reportID }} />}
        </Show>
      </Show>
    )
  }

  return { Sidebar, Page, openList, stopEvents }
}

export default Plugin.define({
  id: "result.tui",
  setup(context) {
    const syntax = markdownSyntax(context.theme, context.renderer.nativeScene)
    const ui = createUI(context, syntax)

    const stopRoute = context.ui.router.register({ name: ROUTE, render: (input) => <ui.Page data={input.data} /> })
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
          run: ui.openList,
        },
      ],
    }))

    return () => {
      ui.stopEvents()
      stopRoute()
      stopSidebar()
      void context.renderer.idle().then(() => syntax.destroy())
    }
  },
})
