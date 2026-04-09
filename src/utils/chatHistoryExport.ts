import { buildAgentRunSnapshot } from './agentRunTimeline'

type ChatHistoryMessage = {
  role?: unknown
  content?: unknown
  timestamp?: unknown
  thinkingMessage?: unknown
  reasoningContent?: unknown
  agentEvents?: unknown[]
  toolCalls?: unknown[]
  toolCallsRecordedAt?: unknown
  pipelineCompleted?: boolean
  runStartedAt?: unknown
  runCompletedAt?: unknown
  error?: boolean
  schemaWarning?: Record<string, unknown> | null
}

type PanelMetaItem = {
  key?: unknown
  label?: unknown
  value?: unknown
}

type BuildChatHistoryExportOptions = {
  poiCount?: number
  exportedAt?: unknown
  panelMetaItems?: PanelMetaItem[]
  sanitizeAssistantText?: (text: string) => unknown
  formatNow?: (value: unknown) => string
  formatTimestamp?: (value: unknown) => string
  formatTimelineTimestamp?: (value: unknown) => string
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

function pushSection(lines: string[], title: string, content: string[] = []) {
  lines.push(title, '')
  if (content.length > 0) {
    lines.push(...content)
    lines.push('')
  }
}

function pushPanelMeta(lines: string[], items: PanelMetaItem[] = [], poiCount = 0) {
  const safeItems = Array.isArray(items) ? items : []
  const normalizedItems = safeItems
    .map((item) => {
      const label = normalizeText(item?.label)
      const value = normalizeText(item?.value)
      return label && value ? `- ${label}: ${value}` : ''
    })
    .filter(Boolean)

  if (normalizedItems.length > 0) {
    lines.push(...normalizedItems)
    return
  }

  lines.push(`- 选中 POI 数量: ${Number.isFinite(Number(poiCount)) ? Number(poiCount) : 0}`)
}

function buildReasoningSection(message: ChatHistoryMessage) {
  const thinkingMessage = normalizeText(message?.thinkingMessage)
  const reasoningContent = normalizeText(message?.reasoningContent)
  if (!thinkingMessage && !reasoningContent) return []

  const lines: string[] = []
  if (thinkingMessage) {
    lines.push(`状态: ${thinkingMessage}`)
  }
  if (reasoningContent) {
    if (thinkingMessage) lines.push('')
    lines.push(reasoningContent)
  }
  return lines
}

function buildTimelineSection(message: ChatHistoryMessage, formatTimelineTimestamp: (value: unknown) => string) {
  const snapshot = buildAgentRunSnapshot(message)
  const lines: string[] = []

  const statusParts = [snapshot.summary.label]
  if (snapshot.summary.elapsedLabel) {
    statusParts.push(snapshot.summary.elapsedLabel)
  }

  lines.push(`- 状态: ${statusParts.join(' · ')}`)
  if (snapshot.summary.detail) {
    lines.push(`- 摘要: ${snapshot.summary.detail}`)
  }

  if (snapshot.timeline.length > 0) {
    lines.push('', '### 过程时间线', '')
    snapshot.timeline.forEach((item, index) => {
      lines.push(`${index + 1}. [${formatTimelineTimestamp(item.timestamp)}] ${item.title}`)
      if (item.detail) {
        lines.push(`   ${item.detail}`)
      }
    })
  }

  return lines
}

export function buildChatHistoryExportContent(
  messages: ChatHistoryMessage[] = [],
  {
    poiCount = 0,
    exportedAt = new Date(),
    panelMetaItems = [],
    sanitizeAssistantText = (text) => text,
    formatNow = (value) => new Date(value as string | number | Date).toLocaleString(),
    formatTimestamp = (value) => new Date(value as string | number | Date).toLocaleTimeString(),
    formatTimelineTimestamp = (value) => new Date(value as string | number | Date).toLocaleTimeString(),
  }: BuildChatHistoryExportOptions = {},
): string {
  const lines: string[] = [
    '# GeoLoom AI 对话记录',
    '',
    `- 导出时间: ${formatNow(exportedAt)}`,
  ]

  pushPanelMeta(lines, panelMetaItems, poiCount)
  lines.push('')

  const safeMessages = Array.isArray(messages) ? messages : []
  let roundIndex = 0

  safeMessages.forEach((message) => {
    const role = normalizeText(message?.role)
    if (!role) return

    if (role === 'user') {
      roundIndex += 1
      pushSection(lines, `## 第 ${roundIndex} 轮`, [
        '### 用户',
        '',
        `> ${formatTimestamp(message?.timestamp ?? exportedAt)}`,
        '',
        normalizeText(message?.content) || '_空消息_',
      ])
      return
    }

    if (roundIndex === 0) {
      roundIndex = 1
      lines.push(`## 第 ${roundIndex} 轮`, '')
    }

    const visibleAnswer = normalizeText(sanitizeAssistantText(String(message?.content || '')))
    pushSection(lines, '### 助手', [
      `> ${formatTimestamp(message?.timestamp ?? exportedAt)}`,
      '',
      visibleAnswer || '_当前还没有可见回答_',
    ])

    const reasoningLines = buildReasoningSection(message)
    if (reasoningLines.length > 0) {
      pushSection(lines, '### 推理过程', reasoningLines)
    }

    const summaryAndTimeline = buildTimelineSection(message, formatTimelineTimestamp)
    if (summaryAndTimeline.length > 0) {
      pushSection(lines, '### 运行摘要', summaryAndTimeline)
    }
  })

  return `${lines.join('\n').trim()}\n`
}

export default {
  buildChatHistoryExportContent,
}
