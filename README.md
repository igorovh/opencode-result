# opencode-result

Result reports for OpenCode 2 sessions. At the end of a task the agent publishes a report with markdown, links,
notes and images. The TUI lists the session's reports in the sidebar and shows them, images included, in a side panel.

## Install

Add the plugin directory (or package) to `plugins` in your global `opencode.json(c)`:

```jsonc
{
  "plugins": ["E:/Projekty/WebstormProjects/opencode-result"],
}
```

Options:

```jsonc
{
  "plugins": [{ "package": "opencode-result", "options": { "remind": true, "dir": "D:/reports" } }],
}
```

- `remind` (default `true`) adds a short system instruction asking the agent to publish a report when it finishes.
- `dir` changes where reports are stored. The default is `~/.local/share/opencode/result/<sessionID>/<reportID>/`.

## Agent tools

| Tool            | What it does                                                         |
| --------------- | -------------------------------------------------------------------- |
| `result_create` | New report: `title`, `markdown`, optional `status` (`success`, `partial`, `failed`, `info`) |
| `result_append` | Adds markdown and images to an earlier report, or changes its title or status |
| `result_list`   | Lists the reports in the current session                             |

Images use normal markdown, one per line: `![caption](path)`. Paths can be absolute, relative to the session directory,
`file:` / `http(s):` / `data:` URLs. PNG, JPEG, GIF and WebP are accepted. Each image is copied into the report, so
temporary screenshots can be deleted afterwards. A missing or invalid image fails the call with a clear error.

## TUI

- **Sidebar:** a `Results` list under the other sidebar sections. Click a report to open it in a large window
  (nearly the whole terminal, up to 220 columns);
  `Esc` closes it and you are back in the session.
- **`/results`** (or the command palette, or the `Results` heading) first lists the session's reports. Pick one to open
  it; `Esc` in the report goes back to the list, and `Esc` in the list closes it.
- **Report dialog:** content on the left, a clickable table of contents (headings and images) on the right.
  `↑`/`↓`, `Space`/`b`, `PgUp`/`PgDn` and the accelerated mouse wheel scroll; `n`/`p` jump between sections; `o` opens
  the report folder. Click an image to open it in the system viewer.
- Images are always drawn in full quality (Kitty or Sixel) once scrolling stops. Terminal graphics cannot be clipped,
  so an image that is partly scrolled out is cropped to its visible rows. While scrolling, images use colored blocks,
  which clip cleanly.
- A toast appears when the agent publishes a new report.

Images render with OpenTUI's `<image>`: Kitty graphics, then Sixel, then colored Unicode blocks. Force a protocol with
`OPENTUI_IMAGE_PROTOCOL=kitty|sixel|blocks`.

## Develop

```bash
bun install
bun test
bun run typecheck
```
