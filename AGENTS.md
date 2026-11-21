# Agent notes

## Checks

- Run `bun run typecheck`, `bun test`, `bun run compile` and `bun run check:dist` before you push. CI fails when
  `dist/` does not match `src/`, so commit the rebuilt `dist/tui.js` with every change to `src/tui.tsx`.

## Demo recordings

- `bun run record -- --out demo.gif --step "click Sidebar and viewer" --step "expect CONTENTS"` records the real
  OpenCode TUI with this checkout's plugin, through
  [opencode-tui-recorder](https://github.com/igorovh/opencode-tui-recorder) and `recorder.config.ts`. It needs
  `opencode` (V2), `ttyd` and `ffmpeg` on `PATH` (or `OPENCODE_BIN` and `TTYD_BIN`) and Playwright's Chromium. Run
  it without steps to see the step list. An `--out` ending in `.png` saves a screenshot.
- `bun run tui serve` keeps a recording open, and `bun run tui begin`, `bun run tui <step>`, `bun run tui screen`,
  `bun run tui rec-start` and `bun run tui rec-stop --out demo.gif` drive it one step at a time; every step
  prints the screen. tidy's review uses this to try steps before it records.
- `recorder.config.ts` opens one session and writes two reports with the plugin's `Store` before the TUI starts:
  "Sidebar and viewer" (success, two images from `docs/`, a table) and "Flaky checkout test" (partial, text
  only). They show in the sidebar's Results section, in `/results` and in the report window, without a model run.
- Open a report by clicking its title in the sidebar, or with `type /results`, `key Enter`, `key Enter`. Inside,
  `key n` jumps to the next heading or image, `key End` goes to the bottom and `key Escape` closes.
- A report written to disk during a recording shows in `/results` but not in the sidebar, and the "New result"
  toast needs a real `result_create` call, which needs a model run. Do not pass the `dir` option: the seed writes to
  the default directory.
- Never click an image or press `o` in a recording: they open the system image viewer or file manager.
- `expect` and `expect-not` steps fail the recording when the screen does not match, so a recording doubles as a
  test. Put them after every action, for example `click Flaky checkout test`, `expect Next steps`. A failed check
  stops the steps but still writes the file, then exits with 1. A broken recording, such as an unknown step or a
  timeout, exits with 2.
- A check in a before-and-after recording should pass on the PR branch and fail on the base branch. A check that
  passes on both, such as `expect Results`, proves nothing about the change.
- In Git Bash, run `tui` steps that start with `/` with `MSYS_NO_PATHCONV=1`, or `type /results` arrives as a
  Windows path.
- Every PR that changes what the sidebar, `/results` or the report window shows must include a screenshot or GIF
  of the change, before and after.
