export interface AgentStageStep {
  key: string
  label: string
  hint: string
  helper: string
}

export interface RunStatusCopy {
  label: string
  detail: string
  tone: 'done' | 'running' | 'idle'
}

const V4_STAGE_STEPS: AgentStageStep[] = [
  {
    key: 'intent',
    label: '识别问题',
    hint: '正在识别问题类型与锚点...',
    helper: '判断这是附近检索、最近地铁站、双地点比较，还是需要你补充地点。'
  },
  {
    key: 'memory',
    label: '读取上下文',
    hint: '正在读取地图范围与会话上下文...',
    helper: '把当前视野、已选区域、类别过滤和会话记忆一起带进本轮分析。'
  },
  {
    key: 'tool_select',
    label: '规划工具',
    hint: '正在规划本轮要调用的空间能力...',
    helper: '决定接下来该调 postgis、route_distance 还是其他空间工具。'
  },
  {
    key: 'tool_run',
    label: '执行检索',
    hint: '正在执行锚点解析、空间检索与距离计算...',
    helper: '真正去查锚点、跑空间 SQL、补步行距离或做确定性兜底。'
  },
  {
    key: 'evidence',
    label: '汇总证据',
    hint: '正在整理结构化空间证据...',
    helper: '把出口、POI、热点或边界结果整理成前端可展示的证据。'
  },
  {
    key: 'answer',
    label: '组织回答',
    hint: '正在生成最终回答...',
    helper: '把证据转成自然语言结论，并把结果同步到地图与标签云。'
  }
]

const LEGACY_STAGE_ALIASES = new Map<string, string>([
  ['intent', 'intent'],
  ['planner', 'intent'],
  ['memory', 'memory'],
  ['tool_select', 'tool_select'],
  ['query', 'tool_run'],
  ['tool_run', 'tool_run'],
  ['spatial', 'tool_run'],
  ['evidence', 'evidence'],
  ['writer', 'answer'],
  ['answer', 'answer']
])

export function getAgentStageSteps({ backendVersion = 'v4' }: { backendVersion?: unknown } = {}): AgentStageStep[] {
  if (String(backendVersion || '').toLowerCase() === 'v4') {
    return V4_STAGE_STEPS.slice()
  }
  return V4_STAGE_STEPS.slice()
}

export function normalizeAgentStage(stageName: unknown = ''): string {
  const normalized = String(stageName || '').trim().toLowerCase()
  if (!normalized) return ''
  return LEGACY_STAGE_ALIASES.get(normalized) || normalized
}

export function getRunStatusCopy({
  pipelineCompleted = false,
  isThinking = false,
  activeStageKey = '',
  stageSteps = V4_STAGE_STEPS
}: {
  pipelineCompleted?: boolean
  isThinking?: boolean
  activeStageKey?: unknown
  stageSteps?: AgentStageStep[]
} = {}): RunStatusCopy {
  if (pipelineCompleted) {
    return {
      label: '分析已经完成',
      detail: '本轮空间检索、证据整理和回答生成都已经结束。',
      tone: 'done'
    }
  }

  const normalizedStage = normalizeAgentStage(activeStageKey)
  const currentStage = stageSteps.find((step) => step.key === normalizedStage) || stageSteps[0] || null

  if (!currentStage) {
    return {
      label: isThinking ? '正在处理中...' : '等待开始',
      detail: '准备进入本轮空间分析。',
      tone: isThinking ? 'running' : 'idle'
    }
  }

  return {
    label: currentStage.hint,
    detail: currentStage.helper,
    tone: isThinking ? 'running' : 'idle'
  }
}
