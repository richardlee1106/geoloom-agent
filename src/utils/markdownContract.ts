const KNOWN_SECTION_TITLES = [
  '配套现状',
  '热门业态',
  '明显缺口',
  '附近可选地点',
  '还可以继续',
  '先看结论',
  '结论',
  '建议'
] as const

function splitHeadingAndBody(level: string, headingText = ''): string {
  const normalized = String(headingText || '').trim()
  if (!normalized) return `${level}`

  for (const title of KNOWN_SECTION_TITLES) {
    if (!normalized.startsWith(title)) continue

    const remainder = normalized.slice(title.length).trim()
    if (!remainder) {
      return `${level} ${title}`
    }

    return `${level} ${title}\n${remainder}`
  }

  return `${level} ${normalized}`
}

function normalizeHeadingLine(line = ''): string {
  const raw = String(line || '')
  if (!raw.trim()) return ''

  const pureAsteriskHeadingMatch = raw.match(/^\s*\*{3,}\s*(.+?)\s*\*{0,}\s*$/)
  if (pureAsteriskHeadingMatch) {
    const title = String(pureAsteriskHeadingMatch[1] || '').replace(/^\*+|\*+$/g, '').trim()
    return title ? splitHeadingAndBody('###', title) : ''
  }

  const markdownHeadingMatch = raw.match(/^(\s*#{1,6})\s*(.+)$/)
  if (!markdownHeadingMatch) return raw

  const level = markdownHeadingMatch[1].trim()
  const cleanedTitle = String(markdownHeadingMatch[2] || '')
    .replace(/^\*+/, '')
    .replace(/\*+$/, '')
    .trim()

  return cleanedTitle ? splitHeadingAndBody(level, cleanedTitle) : `${level}`
}

/** 将内联的 ## 标题和 - 列表项前插入换行，使 marked 能正确解析 */
function insertBreaksBeforeInlineMarkdown(text: string): string {
  // 内联 ## / ### 标题前插入换行（前面不是换行符的情况）
  let out = text.replace(/([^\n])\s*(#{2,6}\s)/g, '$1\n\n$2')
  // 内联 - 列表项前插入换行（- 前面不是换行符，且 - 后面有空格或中文）
  out = out.replace(/([^\n\s])\s*([-*])\s+(?=[\u4e00-\u9fff\w])/g, '$1\n$2 ')
  return out
}

export function normalizeMarkdownForRender(markdown = ''): string {
  const withBreaks = insertBreaksBeforeInlineMarkdown(String(markdown || ''))
  const lines = withBreaks.split(/\r?\n/)
  return lines
    .map((line) => normalizeHeadingLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}
