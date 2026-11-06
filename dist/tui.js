// @bun
// stale
import { memo as _$memo } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { Plugin } from "@opencode/plugin/tui";
import { MacOSScrollAccel, NativeImage, RGBA } from "@opentui/core";
import { Portal, useTerminalDimensions } from "@opentui/solid";
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";

// src/markdown.ts
var IMAGE = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^()<>"]+?))(?:\s+"[^"]*")?\s*\)/g;
var FENCE = /^\s{0,3}(`{3,}|~{3,})/;
var CODE_SPAN = /(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g;
function codeSpans(line) {
  return [...line.matchAll(CODE_SPAN)].map((match) => [match.index, match.index + match[0].length]);
}
function splitMarkdown(markdown) {
  const blocks = [];
  let text = "";
  let fence;
  const flush = () => {
    if (text.trim())
      blocks.push({ type: "markdown", text: text.replace(/^\n+|\s+$/g, "") });
    text = "";
  };
  for (const line of markdown.replace(/\r\n/g, `
`).split(`
`)) {
    const marker = FENCE.exec(line)?.[1];
    if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) {
      fence = fence ? undefined : marker;
      text += line + `
`;
      continue;
    }
    if (fence) {
      text += line + `
`;
      continue;
    }
    let last = 0;
    const spans = codeSpans(line);
    for (const match of line.matchAll(IMAGE)) {
      if (spans.some(([start, end]) => match.index >= start && match.index < end))
        continue;
      text += line.slice(last, match.index);
      flush();
      blocks.push({ type: "image", alt: match[1].trim(), src: (match[2] ?? match[3]).trim() });
      last = match.index + match[0].length;
    }
    text += line.slice(last) + `
`;
  }
  flush();
  return blocks;
}
var HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
function splitSections(markdown) {
  const sections = [];
  for (const block of splitMarkdown(markdown)) {
    if (block.type === "image") {
      sections.push(block);
      continue;
    }
    let lines = [];
    let heading;
    let fence;
    const flush = () => {
      const text = lines.join(`
`).trim();
      if (text)
        sections.push(heading ? { type: "markdown", text, heading } : { type: "markdown", text });
      lines = [];
      heading = undefined;
    };
    for (const line of block.text.split(`
`)) {
      const marker = FENCE.exec(line)?.[1];
      if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length))
        fence = fence ? undefined : marker;
      const match = fence || marker ? undefined : HEADING.exec(line);
      if (match) {
        flush();
        heading = { text: match[2].replace(/[*_`]/g, ""), level: match[1].length };
      }
      lines.push(line);
    }
    flush();
  }
  return sections;
}

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var object = { type: "object" };
var ref = {
  type: "object",
  properties: { sessionID: { type: "string" }, reportID: { type: "string" } },
  required: ["sessionID", "reportID"]
};
var ResultRpc = Rpc.define({
  id: "result",
  methods: {
    list: {
      input: {
        type: "object",
        properties: { sessionIDs: { type: "array", items: { type: "string" } } },
        required: ["sessionIDs"]
      },
      output: { type: "object", properties: { reports: { type: "array", items: object } }, required: ["reports"] }
    },
    get: {
      input: ref,
      output: { type: "object", properties: { report: object } }
    },
    image: {
      input: { ...ref, properties: { ...ref.properties, file: { type: "string" } }, required: [...ref.required, "file"] },
      output: { type: "object", properties: { data: { type: "string" } } }
    }
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          reportID: { type: "string" },
          title: { type: "string" },
          created: { type: "boolean" }
        },
        required: ["sessionID", "reportID", "title", "created"]
      }
    }
  }
});

// src/syntax.ts
import { SyntaxStyle } from "@opentui/core";
var rule = (scope, foreground, style = {}) => ({ scope, style: { foreground, ...style } });
function markdownSyntax(theme, owner) {
  const { syntax, markdown } = theme;
  const feedback = theme.text.feedback;
  return SyntaxStyle.fromTheme([
    rule(["default"], theme.text.base),
    rule(["comment", "comment.documentation"], syntax.comment, { italic: true }),
    rule(["string", "symbol", "character.special", "character"], syntax.string),
    rule(["number", "boolean", "constant", "float"], syntax.number),
    rule(["keyword"], syntax.keyword, { italic: true }),
    rule(["operator", "keyword.operator", "punctuation.delimiter"], syntax.operator),
    rule(["variable", "property", "parameter", "field", "function.call", "function.method.call"], syntax.variable),
    rule(["function", "function.method", "constructor", "variable.member"], syntax.function),
    rule(["type", "module", "class", "namespace"], syntax.type),
    rule(["punctuation", "punctuation.bracket"], syntax.punctuation),
    rule(["markup.heading", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"], markdown.heading, { bold: true }),
    rule(["markup.heading.1"], markdown.heading, { bold: true, underline: true }),
    rule(["markup.bold", "markup.strong"], markdown.strong, { bold: true }),
    rule(["markup.italic"], markdown.emphasis, { italic: true }),
    rule(["markup.list"], markdown.listItem),
    rule(["markup.quote"], markdown.blockQuote, { italic: true }),
    rule(["markup.raw", "markup.raw.block"], markdown.code),
    rule(["markup.raw.inline"], markdown.code, { background: theme.background.base }),
    rule(["markup.link", "markup.link.url", "string.special", "string.special.url"], markdown.link, { underline: true }),
    rule(["markup.link.label"], markdown.linkText, { underline: true }),
    rule(["label"], markdown.linkText),
    rule(["markup.strikethrough", "markup.list.unchecked"], theme.text.muted),
    rule(["markup.list.checked"], feedback.success.base),
    rule(["diff.plus"], theme.diff.text.added, { background: theme.diff.background.added }),
    rule(["diff.minus"], theme.diff.text.removed, { background: theme.diff.background.removed })
  ], owner);
}

// src/tui.tsx
var MAX_SIDEBAR_ITEMS = 8;
var MAX_WIDTH = 220;
var LEGEND_WIDTH = 34;
var SCROLL_STEP = 2;
var SCROLL_SETTLE_MS = 120;
function truncate(value, width) {
  if (width <= 0)
    return "";
  return value.length <= width ? value : value.slice(0, Math.max(0, width - 1)) + "\u2026";
}
function formatTime(time) {
  const date = new Date(time);
  const pad = (n) => String(n).padStart(2, "0");
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === new Date().toDateString())
    return clock;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}
function openExternal(target, onError) {
  const openers = process.platform === "win32" ? ["explorer.exe"] : process.platform === "darwin" ? ["open"] : ["xdg-open", "wslview", "gio"];
  const attempt = (index) => {
    const command = openers[index];
    if (!command)
      return onError(`No program to open ${target}. Install xdg-utils.`);
    const args = command === "gio" ? ["open", target] : [target];
    spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).on("error", () => attempt(index + 1)).unref();
  };
  attempt(0);
}
function asyncValue(source, load, initial, options = {}) {
  const [value, setValue] = createSignal(initial);
  let request = 0;
  let disposed = false;
  onCleanup(() => disposed = true);
  createEffect(() => {
    const input = source();
    const id = ++request;
    load(input).then((result) => id === request && !disposed ? setValue(() => result) : options.discard?.(result), (error) => id === request && !disposed && options.onError?.(error));
  });
  return value;
}
function createUI(context, syntax) {
  const api = context.client.rpc(ResultRpc);
  const theme = () => context.theme;
  const [version, setVersion] = createSignal(0);
  const familyOf = (sessionID) => [...new Set([sessionID, ...context.data.session.family(sessionID)])];
  const fetchList = async (sessionIDs) => (await api.list({
    sessionIDs
  })).reports;
  const fetchReport = async (ref) => (await api.get(ref)).report;
  const repaint = () => {
    context.renderer.forceFullRepaintRequested = true;
    context.renderer.requestRender();
  };
  const showError = (error) => context.ui.toast.show({
    message: error instanceof Error ? error.message : String(error),
    variant: "error"
  });
  const statusMark = (status) => {
    const feedback = theme().text.feedback;
    if (status === "failed")
      return {
        char: "\u2715",
        color: feedback.error.base
      };
    if (status === "partial")
      return {
        char: "\u25D0",
        color: feedback.warning.base
      };
    if (status === "info")
      return {
        char: "\u25CF",
        color: feedback.info.base
      };
    return {
      char: "\u25CF",
      color: feedback.success.base
    };
  };
  const [shown, setShown] = createSignal();
  const open = (ref, fromList = false) => {
    context.ui.dialog.clear();
    setShown({
      ref,
      fromList
    });
  };
  const close = () => {
    const current = shown();
    setShown(undefined);
    repaint();
    if (current?.fromList)
      setTimeout(() => void openList(current.ref.sessionID).catch(showError));
  };
  const openList = async (sessionID) => {
    const reports = await fetchList(familyOf(sessionID));
    if (!reports.length)
      return context.ui.toast.show({
        message: "No results in this session yet",
        variant: "info"
      });
    const picked = await context.ui.dialog.select({
      title: "Results",
      placeholder: "Search results",
      options: reports.map((report) => ({
        title: `${statusMark(report.status).char} ${report.title}`,
        value: report,
        description: report.status + (report.imageCount ? ` \xB7 \u25A3${report.imageCount}` : ""),
        footer: formatTime(report.createdAt)
      }))
    });
    if (picked)
      open({
        sessionID: picked.sessionID,
        reportID: picked.id
      }, true);
  };
  const openCurrent = () => {
    const route = context.ui.router.current();
    if (route.type !== "session")
      return context.ui.toast.show({
        message: "Open a session first",
        variant: "warning"
      });
    openList(route.sessionID).catch(showError);
  };
  const stopEvents = api.events.on("changed", (event) => {
    setVersion((value) => value + 1);
    const data = event.data;
    if (data.created)
      context.ui.toast.show({
        title: "New result",
        message: data.title,
        variant: "success",
        sessionID: data.sessionID
      });
  });
  function Row(props) {
    const [hovered, setHovered] = createSignal(false);
    return (() => {
      var _el$ = _$createElement("box");
      _$setProp(_el$, "flexDirection", "row");
      _$setProp(_el$, "height", 1);
      _$setProp(_el$, "flexShrink", 0);
      _$setProp(_el$, "onMouseOver", () => setHovered(true));
      _$setProp(_el$, "onMouseOut", () => setHovered(false));
      _$setProp(_el$, "onMouseUp", (event) => {
        if (event.button !== 0)
          return;
        event.stopPropagation();
        props.onSelect();
      });
      _$insert(_el$, () => props.children(props.width));
      _$effect((_$p) => _$setProp(_el$, "backgroundColor", props.active ? theme().background.raised.max : hovered() ? theme().background.raised.high : undefined, _$p));
      return _el$;
    })();
  }
  function ReportRow(props) {
    const mark = () => statusMark(props.report.status);
    const meta = () => (props.report.imageCount ? ` \u25A3${props.report.imageCount}` : "") + " " + formatTime(props.report.createdAt);
    return _$createComponent(Row, {
      get width() {
        return props.width;
      },
      get onSelect() {
        return props.onSelect;
      },
      children: (width) => [(() => {
        var _el$2 = _$createElement("text");
        _$setProp(_el$2, "selectable", false);
        _$insert(_el$2, () => mark().char + " ");
        _$effect((_$p) => _$setProp(_el$2, "fg", mark().color, _$p));
        return _el$2;
      })(), (() => {
        var _el$3 = _$createElement("text");
        _$setProp(_el$3, "selectable", false);
        _$insert(_el$3, () => truncate(props.report.title, width - 3 - meta().length));
        _$effect((_$p) => _$setProp(_el$3, "fg", theme().text.base, _$p));
        return _el$3;
      })(), (() => {
        var _el$4 = _$createElement("box");
        _$setProp(_el$4, "flexGrow", 1);
        return _el$4;
      })(), (() => {
        var _el$5 = _$createElement("text");
        _$setProp(_el$5, "selectable", false);
        _$insert(_el$5, meta);
        _$effect((_$p) => _$setProp(_el$5, "fg", theme().text.muted, _$p));
        return _el$5;
      })()]
    });
  }
  function Sidebar(props) {
    const sessionIDs = createMemo(() => familyOf(props.sessionID), [], {
      equals: (a, b) => a.join() === b.join()
    });
    const reports = asyncValue(() => ({
      ids: sessionIDs(),
      version: version()
    }), ({
      ids
    }) => fetchList(ids), []);
    const [width, setWidth] = createSignal(30);
    return _$createComponent(Show, {
      get when() {
        return reports().length > 0;
      },
      get children() {
        var _el$6 = _$createElement("box"), _el$7 = _$createElement("box"), _el$8 = _$createElement("text"), _el$9 = _$createElement("b"), _el$1 = _$createElement("box"), _el$10 = _$createElement("text");
        _$insertNode(_el$6, _el$7);
        _$setProp(_el$6, "flexDirection", "column");
        _$setProp(_el$6, "flexShrink", 0);
        _$setProp(_el$6, "onSizeChange", function() {
          setWidth(this.width);
        });
        _$insertNode(_el$7, _el$8);
        _$insertNode(_el$7, _el$1);
        _$insertNode(_el$7, _el$10);
        _$setProp(_el$7, "flexDirection", "row");
        _$setProp(_el$7, "flexShrink", 0);
        _$setProp(_el$7, "onMouseUp", () => void openList(props.sessionID).catch(showError));
        _$insertNode(_el$8, _el$9);
        _$insertNode(_el$9, _$createTextNode(`Results`));
        _$setProp(_el$1, "flexGrow", 1);
        _$insert(_el$10, () => String(reports().length));
        _$insert(_el$6, _$createComponent(For, {
          get each() {
            return reports().slice(0, MAX_SIDEBAR_ITEMS);
          },
          children: (report) => _$createComponent(ReportRow, {
            report,
            get width() {
              return width();
            },
            onSelect: () => open({
              sessionID: report.sessionID,
              reportID: report.id
            })
          })
        }), null);
        _$insert(_el$6, _$createComponent(Show, {
          get when() {
            return reports().length > MAX_SIDEBAR_ITEMS;
          },
          get children() {
            var _el$11 = _$createElement("box"), _el$12 = _$createElement("text");
            _$insertNode(_el$11, _el$12);
            _$setProp(_el$11, "height", 1);
            _$setProp(_el$11, "flexShrink", 0);
            _$setProp(_el$11, "onMouseUp", () => void openList(props.sessionID).catch(showError));
            _$insert(_el$12, () => `\u2026 ${reports().length - MAX_SIDEBAR_ITEMS} more (/results)`);
            _$effect((_$p) => _$setProp(_el$12, "fg", theme().text.muted, _$p));
            return _el$11;
          }
        }), null);
        _$effect((_p$) => {
          var _v$ = theme().text.base, _v$2 = theme().text.muted;
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$8, "fg", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$10, "fg", _v$2, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$6;
      }
    });
  }
  function ImageBlock(props) {
    const info = () => props.report.images.find((image) => image.file === props.file);
    const local = createMemo(() => {
      if (!info())
        return;
      const file = path.join(props.report.dir, props.file);
      return existsSync(file) ? file : undefined;
    });
    const owner = context.renderer.nativeScene.resourceContext;
    const image = asyncValue(() => ({
      report: props.report,
      file: props.file,
      local: local()
    }), async (input) => {
      if (input.local)
        return NativeImage.load(input.local, {
          owner
        });
      const {
        data
      } = await api.image({
        sessionID: input.report.sessionID,
        reportID: input.report.id,
        file: input.file
      });
      return data ? NativeImage.load(new Uint8Array(Buffer.from(data, "base64")), {
        owner
      }) : undefined;
    }, undefined, {
      discard: (late) => late?.dispose()
    });
    let previous;
    createEffect(() => {
      const current = image();
      if (previous && previous !== current)
        previous.dispose();
      previous = current;
    });
    const size = createMemo(() => {
      const meta = info();
      const maxHeight = Math.max(4, props.maxHeight);
      if (!meta?.width || !meta.height)
        return {
          width: props.width,
          height: Math.min(maxHeight, 12)
        };
      let width = Math.min(props.width, Math.ceil(meta.width / 8));
      let height = Math.round(width * meta.height / meta.width / 2);
      if (height > maxHeight) {
        height = maxHeight;
        width = Math.round(height * 2 * meta.width / meta.height);
      }
      return {
        width: Math.max(4, width),
        height: Math.max(2, height)
      };
    });
    let box;
    let crop;
    const view = createMemo(() => {
      const source = image();
      if (!source)
        return;
      const height = size().height;
      const visible = props.visible(box, height);
      crop?.dispose();
      crop = undefined;
      if (visible === "moving" || visible.to <= visible.from)
        return {
          source,
          protocol: "blocks",
          from: 0,
          rows: height
        };
      if (visible.from === 0 && visible.to === height)
        return {
          source,
          protocol: "auto",
          from: 0,
          rows: height
        };
      const top = Math.round(source.height * visible.from / height);
      const bottom = Math.max(top + 1, Math.round(source.height * visible.to / height));
      crop = source.extract({
        left: 0,
        top,
        width: source.width,
        height: Math.min(source.height, bottom) - top
      });
      return {
        source: crop,
        protocol: "auto",
        from: visible.from,
        rows: visible.to - visible.from
      };
    });
    onCleanup(() => {
      crop?.dispose();
      previous?.dispose();
    });
    return (() => {
      var _el$13 = _$createElement("box"), _el$14 = _$createElement("box");
      _$insertNode(_el$13, _el$14);
      _$setProp(_el$13, "flexDirection", "column");
      _$setProp(_el$13, "flexShrink", 0);
      _$use((element) => box = element, _el$14);
      _$setProp(_el$14, "flexShrink", 0);
      _$setProp(_el$14, "onMouseUp", (event) => {
        const file = local();
        if (event.button === 0 && file)
          openExternal(file, showError);
      });
      _$insert(_el$14, _$createComponent(Show, {
        get when() {
          return view();
        },
        get fallback() {
          return (() => {
            var _el$17 = _$createElement("text");
            _$insertNode(_el$17, _$createTextNode(`Loading image\u2026`));
            _$effect((_$p) => _$setProp(_el$17, "fg", theme().text.muted, _$p));
            return _el$17;
          })();
        },
        children: (current) => (() => {
          var _el$19 = _$createElement("image");
          _$setProp(_el$19, "fit", "fill");
          _$effect((_p$) => {
            var _v$5 = current().source, _v$6 = current().protocol, _v$7 = size().width, _v$8 = current().rows, _v$9 = current().from;
            _v$5 !== _p$.e && (_p$.e = _$setProp(_el$19, "source", _v$5, _p$.e));
            _v$6 !== _p$.t && (_p$.t = _$setProp(_el$19, "protocol", _v$6, _p$.t));
            _v$7 !== _p$.a && (_p$.a = _$setProp(_el$19, "width", _v$7, _p$.a));
            _v$8 !== _p$.o && (_p$.o = _$setProp(_el$19, "height", _v$8, _p$.o));
            _v$9 !== _p$.i && (_p$.i = _$setProp(_el$19, "marginTop", _v$9, _p$.i));
            return _p$;
          }, {
            e: undefined,
            t: undefined,
            a: undefined,
            o: undefined,
            i: undefined
          });
          return _el$19;
        })()
      }));
      _$insert(_el$13, _$createComponent(Show, {
        get when() {
          return props.alt;
        },
        get children() {
          var _el$15 = _$createElement("text"), _el$16 = _$createElement("i");
          _$insertNode(_el$15, _el$16);
          _$insert(_el$16, () => props.alt);
          _$effect((_$p) => _$setProp(_el$15, "fg", theme().text.muted, _$p));
          return _el$15;
        }
      }), null);
      _$effect((_p$) => {
        var _v$3 = size().width, _v$4 = size().height;
        _v$3 !== _p$.e && (_p$.e = _$setProp(_el$14, "width", _v$3, _p$.e));
        _v$4 !== _p$.t && (_p$.t = _$setProp(_el$14, "height", _v$4, _p$.t));
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$13;
    })();
  }
  function ReportDialog(props) {
    const dimensions = useTerminalDimensions();
    const width = () => Math.min(MAX_WIDTH, dimensions().width - 8);
    const height = () => Math.max(12, dimensions().height - 6);
    const contentWidth = () => Math.max(20, width() - LEGEND_WIDTH - 3);
    const report = asyncValue(() => ({
      target: props.target,
      version: version()
    }), ({
      target
    }) => fetchReport(target), undefined, {
      onError: showError
    });
    const sections = createMemo(() => splitSections(report()?.markdown ?? ""));
    const outline = createMemo(() => sections().map((section, index) => ({
      section,
      index
    })).filter(({
      section
    }) => section.type === "image" || section.heading));
    let scroll;
    const blocks = [];
    const offsetOf = (index) => {
      const block = blocks[index];
      if (!scroll || !block || block.isDestroyed)
        return;
      return block.screenY - scroll.content.screenY;
    };
    const [scrolling, setScrolling] = createSignal(true);
    const [layoutTick, setLayoutTick] = createSignal(0);
    const [activeIndex, setActiveIndex] = createSignal(-1);
    let lastTop = -1;
    let lastHeight = -1;
    let settleTimer;
    const poll = setInterval(() => {
      if (!scroll || scroll.isDestroyed)
        return;
      const top = scroll.scrollTop;
      const viewport = scroll.viewport.height;
      if (top === lastTop && viewport === lastHeight)
        return;
      lastTop = top;
      lastHeight = viewport;
      setScrolling(true);
      let active = -1;
      for (const {
        index
      } of outline()) {
        const offset = offsetOf(index);
        if (offset !== undefined && offset <= top + 1)
          active = index;
      }
      setActiveIndex(active);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        setLayoutTick((value) => value + 1);
        setScrolling(false);
      }, SCROLL_SETTLE_MS);
    }, 30);
    onCleanup(() => {
      clearInterval(poll);
      clearTimeout(settleTimer);
    });
    createEffect(on(scrolling, repaint, {
      defer: true
    }));
    const visible = (box, rows) => {
      layoutTick();
      if (scrolling() || !box || !scroll || box.isDestroyed)
        return "moving";
      const viewport = scroll.viewport;
      const from = Math.max(0, viewport.screenY - box.screenY);
      const to = Math.min(rows, viewport.screenY + viewport.height - box.screenY);
      return {
        from,
        to: Math.max(from, to)
      };
    };
    const jumpTo = (index) => {
      const offset = offsetOf(index);
      if (offset !== undefined)
        scroll?.scrollTo(offset);
    };
    const jumpSection = (delta) => {
      const list = outline().map(({
        index
      }) => index);
      const top = scroll?.scrollTop ?? 0;
      const target = delta > 0 ? list.find((index) => (offsetOf(index) ?? 0) > top + 1) : list.findLast((index) => (offsetOf(index) ?? 0) < top - 1);
      if (target !== undefined)
        jumpTo(target);
      else if (delta < 0)
        scroll?.scrollTo(0);
    };
    const page = () => Math.max(1, (scroll?.viewport.height ?? 10) - 3);
    context.keymap.layer(() => ({
      mode: "modal",
      priority: 50,
      commands: [{
        title: props.fromList ? "Back to results" : "Close result",
        group: "Results",
        bind: "escape,q",
        run: close
      }, {
        title: "Scroll up",
        group: "Results",
        bind: "up,k",
        run: () => scroll?.scrollBy(-SCROLL_STEP)
      }, {
        title: "Scroll down",
        group: "Results",
        bind: "down,j",
        run: () => scroll?.scrollBy(SCROLL_STEP)
      }, {
        title: "Page up",
        group: "Results",
        bind: "pageup,b",
        run: () => scroll?.scrollBy(-page())
      }, {
        title: "Page down",
        group: "Results",
        bind: "pagedown,space",
        run: () => scroll?.scrollBy(page())
      }, {
        title: "Top",
        group: "Results",
        bind: "home,g",
        run: () => scroll?.scrollTo(0)
      }, {
        title: "Bottom",
        group: "Results",
        bind: "end,shift+g",
        run: () => scroll?.scrollTo(scroll.scrollHeight)
      }, {
        title: "Next section",
        group: "Results",
        bind: "n,right,l",
        run: () => jumpSection(1)
      }, {
        title: "Previous section",
        group: "Results",
        bind: "p,left,h",
        run: () => jumpSection(-1)
      }, {
        title: "Open report folder",
        group: "Results",
        bind: "o",
        run: () => {
          const dir = report()?.dir;
          if (dir && existsSync(dir))
            openExternal(dir, showError);
        }
      }]
    }));
    const legendLabel = (section) => section.type === "image" ? "\u25A3 " + (section.alt || "image") : "  ".repeat(Math.max(0, (section.heading?.level ?? 2) - 2)) + (section.heading?.text ?? "");
    return (() => {
      var _el$20 = _$createElement("box"), _el$21 = _$createElement("box"), _el$22 = _$createElement("box"), _el$23 = _$createElement("box"), _el$24 = _$createElement("box"), _el$25 = _$createElement("scrollbox"), _el$26 = _$createElement("text"), _el$28 = _$createElement("text");
      _$insertNode(_el$20, _el$21);
      _$insertNode(_el$20, _el$22);
      _$insertNode(_el$20, _el$28);
      _$setProp(_el$20, "flexDirection", "column");
      _$setProp(_el$21, "flexDirection", "row");
      _$setProp(_el$21, "flexShrink", 0);
      _$insert(_el$21, _$createComponent(Show, {
        get when() {
          return report();
        },
        get fallback() {
          return (() => {
            var _el$29 = _$createElement("text"), _el$30 = _$createElement("b");
            _$insertNode(_el$29, _el$30);
            _$insertNode(_el$30, _$createTextNode(`Result`));
            _$effect((_$p) => _$setProp(_el$29, "fg", theme().text.base, _$p));
            return _el$29;
          })();
        },
        children: (loaded) => [(() => {
          var _el$32 = _$createElement("text");
          _$insert(_el$32, () => statusMark(loaded().status).char + " ");
          _$effect((_$p) => _$setProp(_el$32, "fg", statusMark(loaded().status).color, _$p));
          return _el$32;
        })(), (() => {
          var _el$33 = _$createElement("text"), _el$34 = _$createElement("b");
          _$insertNode(_el$33, _el$34);
          _$insert(_el$34, () => truncate(loaded().title, contentWidth() - 2));
          _$effect((_$p) => _$setProp(_el$33, "fg", theme().text.base, _$p));
          return _el$33;
        })(), (() => {
          var _el$35 = _$createElement("box");
          _$setProp(_el$35, "flexGrow", 1);
          return _el$35;
        })(), (() => {
          var _el$36 = _$createElement("text");
          _$insert(_el$36, () => `${loaded().status} \xB7 ${formatTime(loaded().createdAt)}` + (loaded().imageCount ? ` \xB7 \u25A3${loaded().imageCount}` : ""));
          _$effect((_$p) => _$setProp(_el$36, "fg", theme().text.muted, _$p));
          return _el$36;
        })()]
      }));
      _$insertNode(_el$22, _el$23);
      _$insertNode(_el$22, _el$24);
      _$setProp(_el$22, "flexDirection", "row");
      _$setProp(_el$22, "flexGrow", 1);
      _$setProp(_el$22, "minHeight", 0);
      _$setProp(_el$22, "marginTop", 1);
      _$insert(_el$22, _$createComponent(Show, {
        get when() {
          return report();
        },
        get fallback() {
          return (() => {
            var _el$37 = _$createElement("text");
            _$insertNode(_el$37, _$createTextNode(`Loading result\u2026`));
            _$effect((_$p) => _$setProp(_el$37, "fg", theme().text.muted, _$p));
            return _el$37;
          })();
        },
        children: (loaded) => (() => {
          var _el$39 = _$createElement("scrollbox"), _el$40 = _$createElement("box");
          _$insertNode(_el$39, _el$40);
          _$use((element) => scroll = element, _el$39);
          _$setProp(_el$39, "flexShrink", 0);
          _$setProp(_el$39, "minHeight", 0);
          _$setProp(_el$39, "scrollAcceleration", new MacOSScrollAccel);
          _$setProp(_el$40, "flexDirection", "column");
          _$setProp(_el$40, "flexShrink", 0);
          _$setProp(_el$40, "gap", 1);
          _$setProp(_el$40, "paddingRight", 1);
          _$insert(_el$40, _$createComponent(For, {
            get each() {
              return sections();
            },
            children: (section, index) => (() => {
              var _el$41 = _$createElement("box");
              _$use((element) => blocks[index()] = element, _el$41);
              _$setProp(_el$41, "flexShrink", 0);
              _$insert(_el$41, _$createComponent(Switch, {
                get children() {
                  return [_$createComponent(Match, {
                    get when() {
                      return section.type === "markdown" && section;
                    },
                    children: (text) => (() => {
                      var _el$42 = _$createElement("markdown");
                      _$setProp(_el$42, "syntaxStyle", syntax);
                      _$setProp(_el$42, "conceal", true);
                      _$setProp(_el$42, "flexShrink", 0);
                      _$effect((_p$) => {
                        var _v$13 = text().text, _v$14 = contentWidth() - 2;
                        _v$13 !== _p$.e && (_p$.e = _$setProp(_el$42, "content", _v$13, _p$.e));
                        _v$14 !== _p$.t && (_p$.t = _$setProp(_el$42, "width", _v$14, _p$.t));
                        return _p$;
                      }, {
                        e: undefined,
                        t: undefined
                      });
                      return _el$42;
                    })()
                  }), _$createComponent(Match, {
                    get when() {
                      return section.type === "image" && section;
                    },
                    children: (image) => _$createComponent(ImageBlock, {
                      get report() {
                        return loaded();
                      },
                      get file() {
                        return image().src;
                      },
                      get alt() {
                        return image().alt;
                      },
                      get width() {
                        return contentWidth() - 2;
                      },
                      get maxHeight() {
                        return height() - 8;
                      },
                      visible
                    })
                  })];
                }
              }));
              return _el$41;
            })()
          }));
          _$effect((_$p) => _$setProp(_el$39, "width", contentWidth(), _$p));
          return _el$39;
        })()
      }), _el$23);
      _$setProp(_el$23, "flexGrow", 1);
      _$insertNode(_el$24, _el$25);
      _$setProp(_el$24, "width", 34);
      _$setProp(_el$24, "flexShrink", 0);
      _$setProp(_el$24, "flexDirection", "column");
      _$setProp(_el$24, "border", ["left"]);
      _$setProp(_el$24, "paddingLeft", 1);
      _$insertNode(_el$25, _el$26);
      _$setProp(_el$25, "flexGrow", 1);
      _$setProp(_el$25, "minHeight", 0);
      _$insertNode(_el$26, _$createTextNode(`CONTENTS`));
      _$insert(_el$25, _$createComponent(Show, {
        get when() {
          return outline().length > 0;
        },
        get fallback() {
          return (() => {
            var _el$43 = _$createElement("text");
            _$insertNode(_el$43, _$createTextNode(`No sections`));
            _$effect((_$p) => _$setProp(_el$43, "fg", theme().text.muted, _$p));
            return _el$43;
          })();
        },
        get children() {
          return _$createComponent(For, {
            get each() {
              return outline();
            },
            children: (entry) => _$createComponent(Row, {
              width: LEGEND_WIDTH - 3,
              get active() {
                return activeIndex() === entry.index;
              },
              onSelect: () => jumpTo(entry.index),
              children: (rowWidth) => (() => {
                var _el$45 = _$createElement("text");
                _$setProp(_el$45, "selectable", false);
                _$insert(_el$45, () => truncate(legendLabel(entry.section), rowWidth));
                _$effect((_$p) => _$setProp(_el$45, "fg", entry.section.type === "image" ? theme().text.muted : theme().text.base, _$p));
                return _el$45;
              })()
            })
          });
        }
      }), null);
      _$setProp(_el$28, "marginTop", 1);
      _$insert(_el$28, () => `\u2191\u2193 scroll \xB7 space page \xB7 n/p section \xB7 o folder \xB7 click image to open \xB7 esc ${props.fromList ? "back" : "close"}`);
      _$effect((_p$) => {
        var _v$0 = width(), _v$1 = height(), _v$10 = theme().border?.base ?? theme().text.muted, _v$11 = theme().text.muted, _v$12 = theme().text.muted;
        _v$0 !== _p$.e && (_p$.e = _$setProp(_el$20, "width", _v$0, _p$.e));
        _v$1 !== _p$.t && (_p$.t = _$setProp(_el$20, "height", _v$1, _p$.t));
        _v$10 !== _p$.a && (_p$.a = _$setProp(_el$24, "borderColor", _v$10, _p$.a));
        _v$11 !== _p$.o && (_p$.o = _$setProp(_el$26, "fg", _v$11, _p$.o));
        _v$12 !== _p$.i && (_p$.i = _$setProp(_el$28, "fg", _v$12, _p$.i));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined
      });
      return _el$20;
    })();
  }
  function Overlay() {
    const dimensions = useTerminalDimensions();
    createEffect(() => {
      if (!shown())
        return;
      const focused = context.renderer.currentFocusedRenderable;
      focused?.blur();
      const pop = context.keymap.mode.push("modal");
      onCleanup(() => {
        pop();
        if (focused && !focused.isDestroyed)
          focused.focus();
      });
    });
    const stop = (event) => event.stopPropagation();
    return _$createComponent(Show, {
      get when() {
        return shown();
      },
      keyed: true,
      children: (current) => _$createComponent(Portal, {
        get mount() {
          return context.renderer.root;
        },
        ref: (element) => {
          const container = element;
          container.position = "absolute";
          container.left = 0;
          container.top = 0;
          container.zIndex = 1000;
        },
        get children() {
          var _el$46 = _$createElement("box"), _el$47 = _$createElement("box");
          _$insertNode(_el$46, _el$47);
          _$setProp(_el$46, "position", "absolute");
          _$setProp(_el$46, "left", 0);
          _$setProp(_el$46, "top", 0);
          _$setProp(_el$46, "zIndex", 1000);
          _$setProp(_el$46, "justifyContent", "center");
          _$setProp(_el$46, "alignItems", "center");
          _$setProp(_el$46, "onMouseDown", stop);
          _$setProp(_el$46, "onMouseUp", (event) => {
            stop(event);
            if (event.target === event.currentTarget)
              close();
          });
          _$setProp(_el$46, "onMouseScroll", stop);
          _$setProp(_el$47, "border", true);
          _$setProp(_el$47, "borderStyle", "rounded");
          _$setProp(_el$47, "paddingLeft", 2);
          _$setProp(_el$47, "paddingRight", 2);
          _$setProp(_el$47, "paddingTop", 1);
          _$setProp(_el$47, "onMouseUp", stop);
          _$insert(_el$47, _$createComponent(ReportDialog, {
            get target() {
              return current.ref;
            },
            get fromList() {
              return current.fromList;
            }
          }));
          _$effect((_p$) => {
            var _v$15 = dimensions().width, _v$16 = dimensions().height, _v$17 = RGBA.fromValues(0, 0, 0, 0.55), _v$18 = theme().background.raised.base, _v$19 = theme().text.muted;
            _v$15 !== _p$.e && (_p$.e = _$setProp(_el$46, "width", _v$15, _p$.e));
            _v$16 !== _p$.t && (_p$.t = _$setProp(_el$46, "height", _v$16, _p$.t));
            _v$17 !== _p$.a && (_p$.a = _$setProp(_el$46, "backgroundColor", _v$17, _p$.a));
            _v$18 !== _p$.o && (_p$.o = _$setProp(_el$47, "backgroundColor", _v$18, _p$.o));
            _v$19 !== _p$.i && (_p$.i = _$setProp(_el$47, "borderColor", _v$19, _p$.i));
            return _p$;
          }, {
            e: undefined,
            t: undefined,
            a: undefined,
            o: undefined,
            i: undefined
          });
          return _el$46;
        }
      })
    });
  }
  return {
    Sidebar,
    Overlay,
    open,
    openCurrent,
    stopEvents
  };
}
var tui_default = Plugin.define({
  id: "result.tui",
  setup(context) {
    const syntax = markdownSyntax(context.theme, context.renderer.nativeScene);
    const ui = createUI(context, syntax);
    const stopOverlay = context.ui.slot({
      append: "app",
      render: () => _$createComponent(ui.Overlay, {})
    });
    const stopSidebar = context.ui.slot({
      append: "sidebar.content",
      render: (input) => _$createComponent(ui.Sidebar, {
        get sessionID() {
          return input.sessionID;
        }
      })
    });
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "result.open",
        title: "Show results",
        group: "Results",
        palette: true,
        slash: {
          name: "results"
        },
        run: ui.openCurrent
      }]
    }));
    return () => {
      ui.stopEvents();
      stopSidebar();
      stopOverlay();
      context.renderer.idle().then(() => syntax.destroy());
    };
  }
});
export {
  tui_default as default
};
