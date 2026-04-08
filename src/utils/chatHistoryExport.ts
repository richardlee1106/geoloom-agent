const CIRCLED_NUMERALS = [
  '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'
] as const

type ChatHistoryMessage = {
  role?: unknown
  content?: unknown
  timestamp?: unknown
  thinkingMessage?: unknown
  reasoningContent?: unknown
}

type BuildChatHistoryExportOptions = {
  poiCount?: number
  exportedAt?: unknown
  sanitizeAssistantText?: (text: string) => unknown
  formatNow?: (value: unknown) => string
  formatTimestamp?: (value: unknown) => string
}

function formatDialogueIndex(index: unknown): string {
  const numeric = Number(index)
  if (!Number.isFinite(numeric) || numeric <= 0) return ''
  return CIRCLED_NUMERALS[numeric - 1] || `(${numeric})`
}

export function buildChatHistoryExportContent(
  messages: ChatHistoryMessage[] = [],
  {
    poiCount = 0,
    exportedAt = new Date(),
    sanitizeAssistantText = (text) => text,
    formatNow = (value) => new Date(value as string | number | Date).toLocaleString(),
    formatTimestamp = (value) => new Date(value as string | number | Date).toLocaleTimeString()
  }: BuildChatHistoryExportOptions = {}
): string {
  let content = '===== 标签云智能助手对话记录 =====\n\n'
  content += `导出时间: ${formatNow(exportedAt)}\n`
  content += `选中POI数量: ${poiCount}\n\n`
  content += '-----------------------------------\n\n'

  const safeMessages = Array.isArray(messages) ? messages : []
  let dialogueIndex = 0
  safeMessages.forEach((msg) => {
    if (msg?.role === 'user') {
      dialogueIndex += 1
    } else if (dialogueIndex === 0) {
      dialogueIndex = 1
    }

    const dialogueMarker = formatDialogueIndex(dialogueIndex)
    const role = msg?.role === 'user' ? '用户' : '智能助手'
    const time = formatTimestamp(msg?.timestamp ?? exportedAt)
    const rawContent = String(msg?.content || '')
    const safeContent = msg?.role === 'assistant'
      ? String(sanitizeAssistantText(rawContent) || '')
      : rawContent

    content += `${dialogueMarker} [${role}] ${time}:\n${safeContent}\n\n`

    if (msg?.role === 'assistant') {
      const thinkingMessage = String(msg?.thinkingMessage || '').trim()
      const reasoningContent = String(msg?.reasoningContent || '').trim()
      if (thinkingMessage || reasoningContent) {
        content += `${dialogueMarker} [空间推理] ${time}:\n`
        if (thinkingMessage) {
          content += `状态: ${thinkingMessage}\n`
        }
        if (reasoningContent) {
          content += `${reasoningContent}\n`
        }
        content += '\n'
      }
    }

    content += '-----------------------------------\n\n'
  })

  return content
}

export default {
  buildChatHistoryExportContent
}
