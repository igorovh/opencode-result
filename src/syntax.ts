import type { ResolvedThemeTokens } from "@opencode/theme/tui"
import { SyntaxStyle, type ColorInput } from "@opentui/core"

type Owner = Parameters<typeof SyntaxStyle.fromTheme>[1]
type Style = { bold?: boolean; italic?: boolean; underline?: boolean; background?: ColorInput }

const rule = (scope: string[], foreground: ColorInput, style: Style = {}) => ({ scope, style: { foreground, ...style } })

// Trimmed copy of generateSyntax from @opencode/theme, which the host does not provide to plugins.
export function markdownSyntax(theme: ResolvedThemeTokens, owner: Owner) {
  const { syntax, markdown } = theme
  const feedback = theme.text.feedback
  return SyntaxStyle.fromTheme(
    [
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
      rule(
        ["markup.heading", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"],
        markdown.heading,
        { bold: true },
      ),
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
      rule(["diff.minus"], theme.diff.text.removed, { background: theme.diff.background.removed }),
    ],
    owner,
  )
}
