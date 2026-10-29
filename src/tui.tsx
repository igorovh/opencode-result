/** @jsxImportSource @opentui/solid */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { Plugin } from "@opencode/plugin/tui"
import type { Context, PanelInput } from "@opencode/plugin/tui/context"
import type { MouseEvent, ScrollBoxRenderable, SyntaxStyle } from "@opentui/core"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { splitMarkdown } from "./markdown"
import { ResultRpc, type Report, type ReportChanged, type ReportStatus, type ReportSummary } from "./rpc"
import { markdownSyntax } from "./syntax"

const PANEL = "result.report"
const MAX_SIDEBAR_ITEMS = 8

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
  const [selected, setSelected] = createSignal<Ref>()

  const familyOf = (sessionID: string) => [...new Set([sessionID, ...context.data.session.family(sessionID)])]

  const fetchList = async (sessionIDs: string[]) =>
    ((await api.list({ sessionIDs })) as { reports: ReportSummary[] }).reports

  const fetchReport = async (ref: Ref | undefined) =>
    ref ? ((await api.get(ref)) as { report?: Report }).report : undefined

  const statusMark = (status: ReportStatus) => {
    const feedback = theme().text.feedback
    if (status === "failed") return { char: "✕", color: feedback.error.base }
    if (status === "partial") return { char: "◐", color: feedback.warning.base }
    if (status === "info") return { char: "●", color: feedback.info.base }
    return { char: "●", color: feedback.success.base }
  }

  const openReport = (ref: Ref | undefined) => {
    setSelected(ref)
    if (!context.ui.panel.open(PANEL)) context.ui.toast.show({ message: "Open a session first", variant: "warning" })
  }

  const reload = () => setVersion((value) => value + 1)

  const stopEvents = api.events.on("changed", (event) => {
    reload()
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
          <box flexDirection="row" flexShrink={0}>
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
                active={context.ui.panel.current()?.name === PANEL && selected()?.reportID === report.id}
                onSelect={() => openReport({ sessionID: report.sessionID, reportID: report.id })}
              />
            )}
          </For>
          <Show when={reports().length > MAX_SIDEBAR_ITEMS}>
            <box height={1} flexShrink={0} onMouseUp={() => openReport(undefined)}>
              <text fg={theme().text.muted}>{`… ${reports().length - MAX_SIDEBAR_ITEMS} more (/results)`}</text>
            </box>
          </Show>
        </box>
      </Show>
    )
  }

  function ListView(props: { panel: PanelInput }) {
    const reports = asyncValue(
      () => ({ ids: familyOf(props.panel.sessionID), version: version() }),
      ({ ids }) => fetchList(ids),
      [] as ReportSummary[],
    )
    const [index, setIndex] = createSignal(0)
    const current = () => reports()[Math.min(index(), reports().length - 1)]
    const move = (delta: number) => setIndex((value) => Math.max(0, Math.min(reports().length - 1, value + delta)))
    const open = () => {
      const report = current()
      if (report) setSelected({ sessionID: report.sessionID, reportID: report.id })
    }
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
      enabled: () => props.panel.focused,
      priority: 50,
      commands: [
        { title: "Previous result", group: "Results", bind: "up,k", run: () => move(-1) },
        { title: "Next result", group: "Results", bind: "down,j", run: () => move(1) },
        { title: "Open result", group: "Results", bind: "return", run: open },
        { title: "Delete result", group: "Results", bind: "d,delete", run: () => void remove() },
        { title: "Close results", group: "Results", bind: "escape", run: props.panel.close },
      ],
    }))

    return (
      <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
        <text fg={theme().text.base}>
          <b>Results</b>
        </text>
        <Show
          when={reports().length > 0}
          fallback={<text fg={theme().text.muted}>No results in this session yet.</text>}
        >
          <scrollbox flexGrow={1} minHeight={0} marginTop={1}>
            <For each={reports()}>
              {(report, position) => (
                <ReportRow
                  report={report}
                  width={Math.max(10, props.panel.width - 2)}
                  active={position() === index()}
                  onSelect={() => setSelected({ sessionID: report.sessionID, reportID: report.id })}
                />
              )}
            </For>
          </scrollbox>
        </Show>
        <text fg={theme().text.muted}>↑↓ · enter open · d delete · esc close</text>
      </box>
    )
  }

  function ImageBlock(props: { report: Report; file: string; alt: string; width: number }) {
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
    const width = () => Math.max(8, props.width)
    const height = () => {
      const image = info()
      const maxHeight = Math.max(6, Math.floor(context.renderer.height * 0.7))
      if (!image?.width || !image.height) return Math.min(maxHeight, Math.round(width() / 3))
      // Terminal cells are about twice as tall as they are wide.
      return Math.max(2, Math.min(maxHeight, Math.round((width() * image.height) / image.width / 2)))
    }
    return (
      <box flexDirection="column" flexShrink={0}>
        <box
          width={width()}
          height={height()}
          flexShrink={0}
          onMouseUp={(event: MouseEvent) => {
            const file = local()
            if (event.button === 0 && file) openExternal(file)
          }}
        >
          <Show when={source()} fallback={<text fg={theme().text.muted}>Loading image…</text>}>
            <image source={source()} fit="fit" width={width()} height={height()} />
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

  function ReportView(props: { panel: PanelInput; target: Ref }) {
    const report = asyncValue(() => ({ target: props.target, version: version() }), ({ target }) => fetchReport(target), undefined)
    const blocks = createMemo(() => splitMarkdown(report()?.markdown ?? ""))
    const contentWidth = () => Math.max(10, props.panel.width - 4)
    let scroll: ScrollBoxRenderable | undefined
    const scrollBy = (delta: number) => scroll?.scrollBy(delta)
    const page = () => Math.max(1, (scroll?.height ?? 10) - 2)

    context.keymap.layer(() => ({
      enabled: () => props.panel.focused,
      priority: 50,
      commands: [
        { title: "Scroll up", group: "Results", bind: "up,k", run: () => scrollBy(-1) },
        { title: "Scroll down", group: "Results", bind: "down,j", run: () => scrollBy(1) },
        { title: "Page up", group: "Results", bind: "pageup", run: () => scrollBy(-page()) },
        { title: "Page down", group: "Results", bind: "pagedown,space", run: () => scrollBy(page()) },
        { title: "Top", group: "Results", bind: "home,g", run: () => scroll?.scrollTo(0) },
        { title: "Bottom", group: "Results", bind: "end,shift+g", run: () => scroll?.scrollTo(scroll.scrollHeight) },
        { title: "Toggle fullscreen", group: "Results", bind: "f", run: props.panel.toggleFullscreen },
        {
          title: "Open report folder",
          group: "Results",
          bind: "o",
          run: () => {
            const dir = report()?.dir
            if (dir && existsSync(dir)) openExternal(dir)
          },
        },
        { title: "Back to results", group: "Results", bind: "escape,backspace", run: () => setSelected(undefined) },
      ],
    }))

    return (
      <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
        <Show
          when={report()}
          fallback={<text fg={theme().text.muted}>Loading result…</text>}
        >
          {(loaded) => (
            <>
              <box flexDirection="row" flexShrink={0}>
                <text fg={statusMark(loaded().status).color}>{statusMark(loaded().status).char + " "}</text>
                <text fg={theme().text.base}>
                  <b>{truncate(loaded().title, contentWidth() - 2)}</b>
                </text>
              </box>
              <text fg={theme().text.muted}>
                {`${loaded().status} · ${formatTime(loaded().createdAt)}` +
                  (loaded().imageCount ? ` · ${loaded().imageCount} image${loaded().imageCount === 1 ? "" : "s"}` : "")}
              </text>
              <scrollbox
                ref={(element: ScrollBoxRenderable) => (scroll = element)}
                flexGrow={1}
                minHeight={0}
                marginTop={1}
              >
                <box flexDirection="column" flexShrink={0} gap={1} paddingRight={1}>
                  <For each={blocks()}>
                    {(block) => (
                      <Switch>
                        <Match when={block.type === "markdown" && block}>
                          {(text) => <markdown content={text().text} syntaxStyle={syntax} conceal flexShrink={0} />}
                        </Match>
                        <Match when={block.type === "image" && block}>
                          {(image) => (
                            <ImageBlock report={loaded()} file={image().src} alt={image().alt} width={contentWidth()} />
                          )}
                        </Match>
                      </Switch>
                    )}
                  </For>
                </box>
              </scrollbox>
            </>
          )}
        </Show>
        <text fg={theme().text.muted}>↑↓ scroll · f full · o folder · esc back</text>
      </box>
    )
  }

  function ResultsPanel(props: { panel: PanelInput }) {
    onMount(() => props.panel.focus())
    return (
      <Show when={selected()} keyed fallback={<ListView panel={props.panel} />}>
        {(target) => <ReportView panel={props.panel} target={target} />}
      </Show>
    )
  }

  return { Sidebar, ResultsPanel, openReport, stopEvents }
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
    const stopPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL}>
          <ui.ResultsPanel panel={panel} />
        </Show>
      ),
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
          run: () => {
            if (context.ui.panel.current()?.name === PANEL) context.ui.panel.close()
            else ui.openReport(undefined)
          },
        },
      ],
    }))

    return () => {
      ui.stopEvents()
      stopSidebar()
      stopPanel()
      void context.renderer.idle().then(() => syntax.destroy())
    }
  },
})
