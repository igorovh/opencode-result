export type Block = { type: "markdown"; text: string } | { type: "image"; alt: string; src: string }

// `![alt](src)` or `![alt](<src>)` with an optional "title". Unlike CommonMark, bare sources may
// contain spaces, because agents write Windows paths like that.
const IMAGE = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^()<>"]+?))(?:\s+"[^"]*")?\s*\)/g
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/** Splits markdown into text and image blocks. Images inside fenced code stay text. */
export function splitMarkdown(markdown: string): Block[] {
  const blocks: Block[] = []
  let text = ""
  let fence: string | undefined
  const flush = () => {
    if (text.trim()) blocks.push({ type: "markdown", text: text.replace(/^\n+|\s+$/g, "") })
    text = ""
  }

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const marker = FENCE.exec(line)?.[1]
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? undefined : marker
      text += line + "\n"
      continue
    }
    if (fence) {
      text += line + "\n"
      continue
    }

    let last = 0
    for (const match of line.matchAll(IMAGE)) {
      text += line.slice(last, match.index)
      flush()
      blocks.push({ type: "image", alt: match[1]!.trim(), src: (match[2] ?? match[3])!.trim() })
      last = match.index! + match[0].length
    }
    text += line.slice(last) + "\n"
  }
  flush()
  return blocks
}

export function joinMarkdown(blocks: readonly Block[]) {
  return blocks
    .map((block) => (block.type === "markdown" ? block.text : `![${block.alt}](<${block.src}>)`))
    .join("\n\n")
}
